import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { z } from "zod";
import type {
  Appointment,
  AppointmentHistoryEntry,
  AppUser,
  AssignmentStatsEntry,
  AvatarMimeType,
  BootstrapResponse,
} from "../shared/contracts.js";
import {
  archiveAppointments,
  countAssignmentsByAssignee,
  openDatabase,
  readHistory,
  type ArchiveRecord,
  type Database,
} from "./db.js";
import { FIXED_SLOTS, MAX_APPOINTMENTS_PER_SLOT } from "./constants.js";
import { scheduleDates } from "./dates.js";

const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().optional(),
  source: z.enum(["oidc", "dev", "local"]),
  lastSeenAt: z.string(),
  avatar: z.object({
    key: z.string().regex(/^[0-9a-f-]+\.img$/),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    updatedAt: z.string(),
  }).optional(),
  agendaMailsEnabled: z.boolean().optional(),
  statsAdjustment: z.number().int().optional(),
});

const appointmentSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  name: z.string().min(1),
  assigneeId: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
});

const monthlyCountsSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}$/),
  z.record(z.string().min(1), z.number().int().positive()),
);

const legacyStateSchema = z.object({
  schemaVersion: z.literal(1),
  users: z.array(userSchema),
  appointments: z.array(appointmentSchema),
});

const provisionalStateSchema = z.object({
  schemaVersion: z.literal(2),
  users: z.array(userSchema),
  appointments: z.array(appointmentSchema),
  monthlyAssignments: monthlyCountsSchema,
});

const recognitionStateSchema = z.object({
  schemaVersion: z.literal(3),
  users: z.array(userSchema),
  appointments: z.array(appointmentSchema),
  monthlyCompletions: monthlyCountsSchema,
});

const currentStateSchema = z.object({
  schemaVersion: z.literal(4),
  users: z.array(userSchema),
  appointments: z.array(appointmentSchema),
});

const stateSchema = z.discriminatedUnion("schemaVersion", [
  legacyStateSchema,
  provisionalStateSchema,
  recognitionStateSchema,
  currentStateSchema,
]);

interface StoredState {
  schemaVersion: 4;
  users: AppUser[];
  appointments: Appointment[];
}

export interface CreateSlotInput {
  startTime: string;
  endTime: string;
  names: string[];
}

export interface AppointmentPatch {
  name?: string;
  startTime?: string;
  endTime?: string;
  assigneeId?: string | null;
}

export interface DailyAssignment {
  appointment: Appointment;
  assignee: AppUser;
}

export class ConflictError extends Error {
  constructor(public readonly current: Appointment) {
    super("Der Termin wurde zwischenzeitlich geändert.");
  }
}

export class NotFoundError extends Error {
  constructor(message = "Der Termin wurde nicht gefunden.") {
    super(message);
  }
}

export class StateValidationError extends Error {}

function emptyState(): StoredState {
  return { schemaVersion: 4, users: [], appointments: [] };
}

function migrateState(
  legacy:
    | z.infer<typeof legacyStateSchema>
    | z.infer<typeof provisionalStateSchema>
    | z.infer<typeof recognitionStateSchema>,
): StoredState {
  return {
    schemaVersion: 4,
    users: legacy.users,
    appointments: legacy.appointments,
  };
}

export class StateStore {
  private state: StoredState = emptyState();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private db: Database | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly allowDevUsers = false,
    private readonly legacyDataFile?: string,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.db = await openDatabase(this.databaseUrl);
    const imported = await this.importLegacyState();
    if (!imported) {
      this.state = await this.readState();
    }
    await this.applyCleanup();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.db.end();
    this.db = null;
    this.initialized = false;
  }

  async upsertUser(user: AppUser): Promise<AppUser> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const index = this.state.users.findIndex((entry) => entry.id === user.id);
      if (index >= 0) {
        const existing = this.state.users[index]!;
        this.state.users[index] = {
          ...user,
          ...(existing.avatar ? { avatar: existing.avatar } : {}),
          ...(existing.agendaMailsEnabled !== undefined
            ? { agendaMailsEnabled: existing.agendaMailsEnabled }
            : {}),
          ...(existing.statsAdjustment !== undefined
            ? { statsAdjustment: existing.statsAdjustment }
            : {}),
        };
      }
      else this.state.users.push(user);
      await this.persist();
      return structuredClone(this.state.users.find((entry) => entry.id === user.id)!);
    });
  }

  async getUser(id: string): Promise<AppUser> {
    return this.enqueue(async () => {
      const user = this.state.users.find((entry) => entry.id === id);
      if (!user) throw new NotFoundError("Der Benutzer wurde nicht gefunden.");
      return structuredClone(user);
    });
  }

  async setUserAvatar(id: string, avatar: AppUser["avatar"] | null): Promise<AppUser> {
    return this.enqueue(async () => {
      const index = this.state.users.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError("Der Benutzer wurde nicht gefunden.");
      const existing = this.state.users[index]!;
      const updated = avatar
        ? { ...existing, avatar }
        : Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "avatar")) as AppUser;
      this.state.users[index] = updated;
      await this.persist();
      return structuredClone(updated);
    });
  }

  async setAgendaMailsEnabled(id: string, enabled: boolean): Promise<AppUser> {
    return this.enqueue(async () => {
      const index = this.state.users.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError("Der Benutzer wurde nicht gefunden.");
      const updated = { ...this.state.users[index]!, agendaMailsEnabled: enabled };
      this.state.users[index] = updated;
      await this.persist();
      return structuredClone(updated);
    });
  }

  async adjustStatsAdjustment(id: string, delta: number): Promise<AppUser> {
    return this.enqueue(async () => {
      const index = this.state.users.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError("Der Benutzer wurde nicht gefunden.");
      const updated = {
        ...this.state.users[index]!,
        statsAdjustment: (this.state.users[index]!.statsAdjustment ?? 0) + delta,
      };
      this.state.users[index] = updated;
      await this.persist();
      return structuredClone(updated);
    });
  }

  async getAssignmentStats(from: string | null, to: string | null): Promise<AssignmentStatsEntry[]> {
    return this.enqueue(async () => {
      const counts = await countAssignmentsByAssignee(this.database(), from, to);
      const entries = new Map<string, AssignmentStatsEntry>();
      for (const user of this.state.users) {
        const appointments = counts.get(user.id)?.count ?? 0;
        const adjustment = user.statsAdjustment ?? 0;
        entries.set(user.id, {
          userId: user.id,
          displayName: user.displayName,
          username: user.username,
          appointments,
          adjustment,
          total: appointments + adjustment,
        });
      }
      for (const [userId, info] of counts) {
        if (entries.has(userId)) continue;
        entries.set(userId, {
          userId,
          displayName: info.displayName ?? userId,
          username: null,
          appointments: info.count,
          adjustment: 0,
          total: info.count,
        });
      }
      return [...entries.values()].sort(
        (a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName, "de"),
      );
    });
  }

  async deleteUser(id: string): Promise<AppUser> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const index = this.state.users.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError("Der Benutzer wurde nicht gefunden.");

      const removed = this.state.users[index]!;
      const timestamp = this.now().toISOString();
      this.state.users.splice(index, 1);

      this.state.appointments = this.state.appointments.map((appointment) =>
        appointment.assigneeId === id
          ? {
              ...appointment,
              assigneeId: null,
              updatedAt: timestamp,
              version: appointment.version + 1,
            }
          : appointment,
      );

      await this.persist();
      return structuredClone(removed);
    });
  }

  async getBootstrap(currentUserId: string): Promise<Omit<BootstrapResponse, "permissions">> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const currentUser = this.state.users.find((user) => user.id === currentUserId);
      if (!currentUser) throw new NotFoundError("Der angemeldete Benutzer ist nicht bekannt.");
      const dates = scheduleDates(this.now());
      const users = [...this.state.users].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, "de", { sensitivity: "base" }),
      );
      return {
        currentUser: structuredClone(currentUser),
        users: structuredClone(users),
        appointments: structuredClone(
          [...this.state.appointments].sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              a.startTime.localeCompare(b.startTime) ||
              a.name.localeCompare(b.name, "de"),
          ),
        ),
        dates,
        fixedSlots: FIXED_SLOTS,
        limits: { maxAppointmentsPerSlot: MAX_APPOINTMENTS_PER_SLOT },
      };
    });
  }

  async getHistory(date: string): Promise<AppointmentHistoryEntry[]> {
    return this.enqueue(async () => readHistory(this.database(), date));
  }

  async getDailyAssignments(date: string): Promise<DailyAssignment[]> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const usersById = new Map(this.state.users.map((user) => [user.id, user]));
      return this.state.appointments
        .filter((appointment) => appointment.date === date && appointment.assigneeId !== null)
        .flatMap((appointment) => {
          const assignee = usersById.get(appointment.assigneeId!);
          return assignee
            ? [{ appointment: structuredClone(appointment), assignee: structuredClone(assignee) }]
            : [];
        })
        .sort((a, b) => a.appointment.startTime.localeCompare(b.appointment.startTime));
    });
  }

  async createBatch(
    date: string,
    slots: CreateSlotInput[],
    actorId: string,
  ): Promise<Appointment[]> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const dates = scheduleDates(this.now());
      if (!dates.planningDays.includes(date)) {
        throw new StateValidationError("Termine können nur für die fünf angezeigten Planungstage erstellt werden.");
      }
      if (!this.state.users.some((user) => user.id === actorId)) {
        throw new StateValidationError("Der angemeldete Benutzer ist nicht bekannt.");
      }

      const timestamp = this.now().toISOString();
      const created = slots.flatMap((slot) =>
        slot.names.map<Appointment>((name) => ({
          id: randomUUID(),
          date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          name: name.trim(),
          assigneeId: null,
          createdBy: actorId,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        })),
      );

      this.state.appointments.push(...created);
      await this.persist();
      return structuredClone(created);
    });
  }

  async updateAppointment(
    id: string,
    expectedVersion: number,
    patch: AppointmentPatch,
  ): Promise<Appointment> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const index = this.state.appointments.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError();
      const existing = this.state.appointments[index]!;
      if (existing.version !== expectedVersion) throw new ConflictError(structuredClone(existing));

      if (
        patch.assigneeId !== undefined &&
        patch.assigneeId !== null &&
        !this.state.users.some((user) => user.id === patch.assigneeId)
      ) {
        throw new StateValidationError("Die ausgewählte Person ist nicht bekannt.");
      }

      const updated: Appointment = {
        ...existing,
        ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
        ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
        ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
        name: patch.name?.trim() ?? existing.name,
        updatedAt: this.now().toISOString(),
        version: existing.version + 1,
      };
      this.state.appointments[index] = updated;
      await this.persist();
      return structuredClone(updated);
    });
  }

  async deleteAppointment(id: string, expectedVersion: number): Promise<void> {
    return this.enqueue(async () => {
      await this.applyCleanup();
      const index = this.state.appointments.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError();
      const existing = this.state.appointments[index]!;
      if (existing.version !== expectedVersion) throw new ConflictError(structuredClone(existing));
      this.state.appointments.splice(index, 1);
      await this.persist([this.archiveRecord(existing, "gelöscht")]);
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private database(): Database {
    if (!this.db) throw new Error("Der Datenspeicher wurde noch nicht initialisiert.");
    return this.db;
  }

  private archiveRecord(
    appointment: Appointment,
    reason: string,
    users: AppUser[] = this.state.users,
  ): ArchiveRecord {
    return {
      appointment: structuredClone(appointment),
      assignee: appointment.assigneeId
        ? structuredClone(users.find((user) => user.id === appointment.assigneeId) ?? null)
        : null,
      reason,
      archivedAt: this.now().toISOString(),
    };
  }

  private cleanupState(): {
    changed: boolean;
    removed: Array<{ appointment: Appointment; reason: string }>;
  } {
    const dates = scheduleDates(this.now());
    const allowedDates = new Set(dates.planningDays);
    const allowedUsers = this.allowDevUsers
      ? this.state.users
      : this.state.users.filter((user) => user.source !== "dev");
    const allowedUserIds = new Set(allowedUsers.map((user) => user.id));
    let changed = allowedUsers.length !== this.state.users.length;
    const removed: Array<{ appointment: Appointment; reason: string }> = [];

    const appointments: Appointment[] = [];
    for (const appointment of this.state.appointments) {
      if (!this.allowDevUsers && appointment.createdBy.startsWith("dev:")) {
        removed.push({ appointment, reason: "dev-bereinigung" });
        changed = true;
        continue;
      }
      if (appointment.date < dates.today) {
        removed.push({ appointment, reason: "abgelaufen" });
        changed = true;
        continue;
      }
      if (!allowedDates.has(appointment.date)) {
        removed.push({ appointment, reason: "planungsfenster" });
        changed = true;
        continue;
      }
      if (appointment.assigneeId && !allowedUserIds.has(appointment.assigneeId)) {
        appointments.push({
          ...appointment,
          assigneeId: null,
          updatedAt: this.now().toISOString(),
          version: appointment.version + 1,
        });
        changed = true;
        continue;
      }
      appointments.push(appointment);
    }

    if (changed) {
      this.state = { ...this.state, users: allowedUsers, appointments };
    }
    return { changed, removed };
  }

  private async applyCleanup(): Promise<void> {
    const usersBefore = this.state.users;
    const { changed, removed } = this.cleanupState();
    if (changed) {
      await this.persist(
        removed.map(({ appointment, reason }) =>
          this.archiveRecord(appointment, reason, usersBefore),
        ),
      );
    }
  }

  private async readState(): Promise<StoredState> {
    const db = this.database();
    const userRows = await db.query("SELECT * FROM users");
    const appointmentRows = await db.query("SELECT * FROM appointments");
    const users: AppUser[] = userRows.rows.map((row) => ({
      id: String(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      ...(row.email != null ? { email: String(row.email) } : {}),
      source: row.source === "dev" ? "dev" : "oidc",
      lastSeenAt: String(row.last_seen_at),
      ...(row.avatar_key != null
        ? {
            avatar: {
              key: String(row.avatar_key),
              mimeType: String(row.avatar_mime_type) as AvatarMimeType,
              updatedAt: String(row.avatar_updated_at),
            },
          }
        : {}),
      ...(row.agenda_mails_enabled != null
        ? { agendaMailsEnabled: Boolean(row.agenda_mails_enabled) }
        : {}),
      ...(row.stats_adjustment != null
        ? { statsAdjustment: Number(row.stats_adjustment) }
        : {}),
    }));
    const appointments: Appointment[] = appointmentRows.rows.map((row) => ({
      id: String(row.id),
      date: String(row.date),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      name: String(row.name),
      assigneeId: row.assignee_id != null ? String(row.assignee_id) : null,
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      version: Number(row.version),
    }));
    return { schemaVersion: 4, users, appointments };
  }

  private async hasStoredData(): Promise<boolean> {
    const result = await this.database().query(
      "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM appointments) AS appointments",
    );
    return Number(result.rows[0]?.users ?? 0) + Number(result.rows[0]?.appointments ?? 0) > 0;
  }

  private async importLegacyState(): Promise<boolean> {
    if (!this.legacyDataFile) return false;
    if (await this.hasStoredData()) return false;

    let raw: string;
    try {
      raw = await readFile(this.legacyDataFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new StateValidationError(
        "Die Zustandsdatei enthält ungültiges JSON und wurde nicht überschrieben.",
      );
    }
    const parsed = stateSchema.safeParse(json);
    if (!parsed.success) {
      throw new StateValidationError(
        `Die Zustandsdatei ist ungültig: ${parsed.error.issues[0]?.message ?? "unbekannter Fehler"}`,
      );
    }

    this.state = parsed.data.schemaVersion === 4 ? parsed.data : migrateState(parsed.data);
    await this.persist();
    await rename(this.legacyDataFile, `${this.legacyDataFile}.migrated`);
    return true;
  }

  private async persist(archive: ArchiveRecord[] = []): Promise<void> {
    const db = this.database();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await archiveAppointments(client, archive);
      await client.query("DELETE FROM appointments");
      await client.query("DELETE FROM users");
      for (const user of this.state.users) {
        await client.query(
          `INSERT INTO users (
            id, username, display_name, email, source, last_seen_at,
            avatar_key, avatar_mime_type, avatar_updated_at, agenda_mails_enabled,
            stats_adjustment
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            user.id,
            user.username,
            user.displayName,
            user.email ?? null,
            user.source,
            user.lastSeenAt,
            user.avatar?.key ?? null,
            user.avatar?.mimeType ?? null,
            user.avatar?.updatedAt ?? null,
            user.agendaMailsEnabled ?? null,
            user.statsAdjustment ?? null,
          ],
        );
      }
      for (const appointment of this.state.appointments) {
        await client.query(
          `INSERT INTO appointments (
            id, date, start_time, end_time, name,
            assignee_id, created_by, created_at, updated_at, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            appointment.id,
            appointment.date,
            appointment.startTime,
            appointment.endTime,
            appointment.name,
            appointment.assigneeId,
            appointment.createdBy,
            appointment.createdAt,
            appointment.updatedAt,
            appointment.version,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
