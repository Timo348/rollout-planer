import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppUser, Appointment, BootstrapResponse } from "../shared/contracts.js";
import { FIXED_SLOTS, MAX_APPOINTMENTS_PER_SLOT } from "./constants.js";
import { scheduleDates } from "./dates.js";

const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().optional(),
  source: z.enum(["oidc", "dev"]),
  lastSeenAt: z.string(),
  avatar: z.object({
    key: z.string().regex(/^[0-9a-f-]+\.img$/),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    updatedAt: z.string(),
  }).optional(),
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

const currentStateSchema = z.object({
  schemaVersion: z.literal(3),
  users: z.array(userSchema),
  appointments: z.array(appointmentSchema),
  monthlyCompletions: monthlyCountsSchema,
});

const stateSchema = z.discriminatedUnion("schemaVersion", [
  legacyStateSchema,
  provisionalStateSchema,
  currentStateSchema,
]);

interface StoredState {
  schemaVersion: 3;
  users: AppUser[];
  appointments: Appointment[];
  monthlyCompletions: Record<string, Record<string, number>>;
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
  return { schemaVersion: 3, users: [], appointments: [], monthlyCompletions: {} };
}

function previousCalendarMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function recordMonthlyCompletion(
  monthlyCompletions: StoredState["monthlyCompletions"],
  date: string,
  userId: string,
): void {
  const month = date.slice(0, 7);
  const monthCounts = monthlyCompletions[month] ?? {};
  monthCounts[userId] = (monthCounts[userId] ?? 0) + 1;
  monthlyCompletions[month] = monthCounts;
}

function migrateState(
  legacy: z.infer<typeof legacyStateSchema> | z.infer<typeof provisionalStateSchema>,
  today: string,
): StoredState {
  const currentMonth = today.slice(0, 7);
  const monthlyCompletions = legacy.schemaVersion === 2
    ? Object.fromEntries(
      Object.entries(legacy.monthlyAssignments)
        .filter(([month]) => month < currentMonth)
        .map(([month, counts]) => [month, { ...counts }]),
    )
    : {};
  const appointments = legacy.schemaVersion === 2
    ? legacy.appointments.filter((appointment) => appointment.date.slice(0, 7) >= currentMonth)
    : legacy.appointments;
  return {
    schemaVersion: 3,
    users: legacy.users,
    appointments,
    monthlyCompletions,
  };
}

export class StateStore {
  private state: StoredState = emptyState();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
    private readonly allowDevUsers = false,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let migrated = false;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = stateSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new StateValidationError(
          `Die Zustandsdatei ist ungültig: ${parsed.error.issues[0]?.message ?? "unbekannter Fehler"}`,
        );
      }
      if (parsed.data.schemaVersion !== 3) {
        this.state = migrateState(parsed.data, scheduleDates(this.now()).today);
        migrated = true;
      } else {
        this.state = parsed.data;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.state = emptyState();
        await this.persist();
      } else if (error instanceof SyntaxError) {
        throw new StateValidationError(
          "Die Zustandsdatei enthält ungültiges JSON und wurde nicht überschrieben.",
        );
      } else {
        throw error;
      }
    }

    const changed = this.cleanupState();
    if (migrated || changed) await this.persist();
    this.initialized = true;
  }

  async upsertUser(user: AppUser): Promise<AppUser> {
    return this.enqueue(async () => {
      this.cleanupState();
      const index = this.state.users.findIndex((entry) => entry.id === user.id);
      if (index >= 0) {
        const existing = this.state.users[index]!;
        this.state.users[index] = existing.avatar ? { ...user, avatar: existing.avatar } : user;
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

  async getBootstrap(currentUserId: string): Promise<BootstrapResponse> {
    return this.enqueue(async () => {
      const changed = this.cleanupState();
      if (changed) await this.persist();
      const currentUser = this.state.users.find((user) => user.id === currentUserId);
      if (!currentUser) throw new NotFoundError("Der angemeldete Benutzer ist nicht bekannt.");
      const dates = scheduleDates(this.now());
      const users = [...this.state.users].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, "de", { sensitivity: "base" }),
      );
      const month = previousCalendarMonth(dates.today);
      const monthCounts = this.state.monthlyCompletions[month] ?? {};
      const completedCount = Math.max(0, ...Object.values(monthCounts));
      const leaders = completedCount === 0
        ? []
        : users.filter((user) => monthCounts[user.id] === completedCount);

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
        employeeOfMonth: {
          month,
          leaders: structuredClone(leaders),
          completedCount,
        },
        fixedSlots: FIXED_SLOTS,
        limits: { maxAppointmentsPerSlot: MAX_APPOINTMENTS_PER_SLOT },
      };
    });
  }

  async createBatch(
    date: string,
    slots: CreateSlotInput[],
    actorId: string,
  ): Promise<Appointment[]> {
    return this.enqueue(async () => {
      if (this.cleanupState()) await this.persist();
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
      if (this.cleanupState()) await this.persist();
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
      if (this.cleanupState()) await this.persist();
      const index = this.state.appointments.findIndex((entry) => entry.id === id);
      if (index < 0) throw new NotFoundError();
      const existing = this.state.appointments[index]!;
      if (existing.version !== expectedVersion) throw new ConflictError(structuredClone(existing));
      this.state.appointments.splice(index, 1);
      await this.persist();
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

  private cleanupState(): boolean {
    const dates = scheduleDates(this.now());
    const allowedDates = new Set(dates.planningDays);
    const allowedUsers = this.allowDevUsers
      ? this.state.users
      : this.state.users.filter((user) => user.source !== "dev");
    const allowedUserIds = new Set(allowedUsers.map((user) => user.id));
    let changed = allowedUsers.length !== this.state.users.length;

    for (const [month, counts] of Object.entries(this.state.monthlyCompletions)) {
      for (const userId of Object.keys(counts)) {
        if (!allowedUserIds.has(userId)) {
          delete counts[userId];
          changed = true;
        }
      }
      if (Object.keys(counts).length === 0) {
        delete this.state.monthlyCompletions[month];
        changed = true;
      }
    }

    const appointments: Appointment[] = [];
    for (const appointment of this.state.appointments) {
      if (!this.allowDevUsers && appointment.createdBy.startsWith("dev:")) {
        changed = true;
        continue;
      }
      if (appointment.date < dates.today) {
        if (appointment.assigneeId && allowedUserIds.has(appointment.assigneeId)) {
          recordMonthlyCompletion(
            this.state.monthlyCompletions,
            appointment.date,
            appointment.assigneeId,
          );
        }
        changed = true;
        continue;
      }
      if (!allowedDates.has(appointment.date)) {
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
    return changed;
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify(this.state, null, 2)}\n`;
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
