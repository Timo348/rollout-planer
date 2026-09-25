import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  Appointment,
  AppointmentHistoryEntry,
  AppUser,
  ChangeNotice,
  ChangeNoticeLists,
  OldDeviceHostname,
} from "../shared/contracts.js";

export type Database = pg.Pool;
export type Queryable = Pick<pg.Pool, "query">;

export interface ArchiveRecord {
  appointment: Appointment;
  assignee: AppUser | null;
  reason: string;
  archivedAt: string;
}

export async function openDatabase(connectionString: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString, max: 4 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      avatar_key TEXT,
      avatar_mime_type TEXT,
      avatar_updated_at TEXT,
      is_preparer BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  // Bestand aus Version 3.0: alte Quellen-Einschränkung ohne 'local' entfernen.
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_source_check");
  // Bestand älterer Versionen: optionale Mail-Einstellung der Profile nachrüsten.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS agenda_mails_enabled BOOLEAN");
  // Bestand älterer Versionen: optionale Mail-Einstellung für Änderungsmeldungen nachrüsten.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS change_notice_mails_enabled BOOLEAN");
  // Bestand älterer Versionen: manuellen Statistik-Korrekturwert nachrüsten.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stats_adjustment INTEGER");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignment_stats_adjustments (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      adjusted_at TEXT NOT NULL
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS assignment_stats_adjustments_adjusted_at_idx ON assignment_stats_adjustments (adjusted_at)",
  );
  // Bestand älterer Versionen: Vorbereitungsrolle nachrüsten.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      name TEXT NOT NULL,
      assignee_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL,
      is_prepared BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  // Bestand älterer Versionen: Vorbereitungsstatus nachrüsten.
  await pool.query(
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_prepared BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS change_notices (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      content TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_by_name TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS change_notice_reads (
      user_id TEXT PRIMARY KEY,
      last_seen_change_id BIGINT NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS old_device_hostnames (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hostname TEXT NOT NULL,
      name TEXT,
      submitted_by TEXT NOT NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      is_processed BOOLEAN NOT NULL DEFAULT FALSE,
      processed_at TEXT,
      processed_by TEXT,
      processed_by_name TEXT
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS old_device_hostnames_hostname_idx
    ON old_device_hostnames (LOWER(hostname))
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public_dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      appointment_scope TEXT NOT NULL DEFAULT 'all',
      trend_days INTEGER NOT NULL DEFAULT 7,
      show_appointment_names BOOLEAN NOT NULL DEFAULT FALSE,
      show_assignee_names BOOLEAN NOT NULL DEFAULT FALSE,
      show_quick_overview BOOLEAN NOT NULL DEFAULT TRUE,
      show_podium BOOLEAN NOT NULL DEFAULT FALSE,
      show_preparation_status BOOLEAN NOT NULL DEFAULT TRUE,
      refresh_seconds INTEGER NOT NULL DEFAULT 60,
      default_theme TEXT NOT NULL DEFAULT 'light',
      zoom_percent INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    ALTER TABLE public_dashboards
    ADD COLUMN IF NOT EXISTS default_theme TEXT NOT NULL DEFAULT 'light'
  `);
  await pool.query(`
    ALTER TABLE public_dashboards
    ADD COLUMN IF NOT EXISTS zoom_percent INTEGER NOT NULL DEFAULT 100
  `);
  await pool.query(`
    ALTER TABLE public_dashboards
    ADD COLUMN IF NOT EXISTS show_podium BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS public_dashboards_single_default
    ON public_dashboards (is_default)
    WHERE is_default = TRUE
  `);
  const dashboardCount = await pool.query("SELECT COUNT(*) AS count FROM public_dashboards");
  if (Number(dashboardCount.rows[0]?.count ?? 0) === 0) {
    const timestamp = new Date().toISOString();
    await pool.query(
      `INSERT INTO public_dashboards (
        id, name, slug, title, subtitle, is_default, is_enabled,
        appointment_scope, trend_days, show_appointment_names,
        show_assignee_names, show_quick_overview, show_podium, show_preparation_status,
        refresh_seconds, default_theme, zoom_percent, created_at, updated_at
      ) VALUES ($1, 'Dashboard 1', 'standard', 'Öffentliche Terminübersicht', '', TRUE, TRUE,
        'all', 7, FALSE, FALSE, TRUE, FALSE, TRUE, 60, 'light', 100, $2, $2)`,
      [randomUUID(), timestamp],
    );
  }
  return pool;
}

function mapChangeNotice(row: Record<string, unknown>): ChangeNotice {
  return {
    id: String(row.id),
    content: String(row.content),
    publishedAt: String(row.published_at),
    publishedBy: String(row.published_by),
    publishedByName: String(row.published_by_name),
  };
}

function mapOldDeviceHostname(row: Record<string, unknown>): OldDeviceHostname {
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    name: row.name != null ? String(row.name) : null,
    submittedBy: String(row.submitted_by),
    submittedByName: String(row.submitted_by_name),
    submittedAt: String(row.submitted_at),
    isProcessed: Boolean(row.is_processed),
    processedAt: row.processed_at != null ? String(row.processed_at) : null,
    processedBy: row.processed_by != null ? String(row.processed_by) : null,
    processedByName: row.processed_by_name != null ? String(row.processed_by_name) : null,
  };
}

export async function insertOldDeviceHostname(
  db: Queryable,
  hostname: string,
  name: string | null,
  author: AppUser,
  submittedAt: string,
): Promise<OldDeviceHostname> {
  const result = await db.query(
    `INSERT INTO old_device_hostnames (
       hostname, name, submitted_by, submitted_by_name, submitted_at
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [hostname, name, author.id, author.displayName, submittedAt],
  );
  return mapOldDeviceHostname(result.rows[0]!);
}

export async function readOldDeviceHostnames(
  db: Queryable,
): Promise<OldDeviceHostname[]> {
  const result = await db.query(
    `SELECT *
     FROM old_device_hostnames
     ORDER BY is_processed ASC, submitted_at DESC, id DESC`,
  );
  return result.rows.map((row) => mapOldDeviceHostname(row));
}

export async function updateOldDeviceHostnameProcessed(
  db: Queryable,
  id: string,
  isProcessed: boolean,
  actor: AppUser,
  processedAt: string,
): Promise<OldDeviceHostname | null> {
  const result = await db.query(
    `UPDATE old_device_hostnames
     SET is_processed = $2,
         processed_at = CASE WHEN $2 THEN $3 ELSE NULL END,
         processed_by = CASE WHEN $2 THEN $4 ELSE NULL END,
         processed_by_name = CASE WHEN $2 THEN $5 ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [id, isProcessed, processedAt, actor.id, actor.displayName],
  );
  return result.rows[0] ? mapOldDeviceHostname(result.rows[0]) : null;
}

export async function hasUnreadChangeNotices(
  db: Queryable,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM change_notices notice
       WHERE notice.id > COALESCE(
         (SELECT last_seen_change_id FROM change_notice_reads WHERE user_id = $1),
         0
       )
     ) AS has_unread`,
    [userId],
  );
  return Boolean(result.rows[0]?.has_unread);
}

export async function readChangeNotices(
  db: Queryable,
  userId: string,
  now: Date,
): Promise<ChangeNoticeLists> {
  const result = await db.query(
    "SELECT * FROM change_notices ORDER BY id DESC",
  );
  const entries = result.rows.map((row) => mapChangeNotice(row));
  const newestId = entries[0]?.id;
  if (newestId) {
    await db.query(
      `INSERT INTO change_notice_reads (user_id, last_seen_change_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET last_seen_change_id = GREATEST(
         change_notice_reads.last_seen_change_id,
         EXCLUDED.last_seen_change_id
       )`,
      [userId, newestId],
    );
  }

  const cutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();
  return {
    current: entries.filter((entry) => entry.publishedAt > cutoff),
    general: entries.filter((entry) => entry.publishedAt <= cutoff),
  };
}

export async function insertChangeNotice(
  db: Queryable,
  content: string,
  author: AppUser,
  publishedAt: string,
): Promise<ChangeNotice> {
  const result = await db.query(
    `INSERT INTO change_notices (
       content, published_at, published_by, published_by_name
     ) VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [content, publishedAt, author.id, author.displayName],
  );
  const notice = mapChangeNotice(result.rows[0]!);
  await db.query(
    `INSERT INTO change_notice_reads (user_id, last_seen_change_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
     SET last_seen_change_id = GREATEST(
       change_notice_reads.last_seen_change_id,
       EXCLUDED.last_seen_change_id
     )`,
    [author.id, notice.id],
  );
  return notice;
}

export async function removeChangeNotice(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query("DELETE FROM change_notices WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function removeChangeNoticeRead(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM change_notice_reads WHERE user_id = $1", [userId]);
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function historyTableName(date: string): string {
  if (!dayPattern.test(date)) {
    throw new Error(`Ungültiges Datum für die Historie: ${date}`);
  }
  return `history_${date.replaceAll("-", "_")}`;
}

async function ensureHistoryTable(db: Queryable, date: string): Promise<string> {
  const table = historyTableName(date);
  await db.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      name TEXT NOT NULL,
      assignee_id TEXT,
      assignee_username TEXT,
      assignee_display_name TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL,
      archived_at TEXT NOT NULL,
      reason TEXT NOT NULL
    )
  `);
  return table;
}

export async function archiveAppointments(
  db: Queryable,
  records: ArchiveRecord[],
): Promise<void> {
  const tables = new Map<string, string>();
  for (const record of records) {
    let table = tables.get(record.appointment.date);
    if (!table) {
      table = await ensureHistoryTable(db, record.appointment.date);
      tables.set(record.appointment.date, table);
    }
    await db.query(
      `INSERT INTO "${table}" (
        appointment_id, appointment_date, start_time, end_time, name,
        assignee_id, assignee_username, assignee_display_name,
        created_by, created_at, updated_at, version, archived_at, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        record.appointment.id,
        record.appointment.date,
        record.appointment.startTime,
        record.appointment.endTime,
        record.appointment.name,
        record.appointment.assigneeId,
        record.assignee?.username ?? null,
        record.assignee?.displayName ?? null,
        record.appointment.createdBy,
        record.appointment.createdAt,
        record.appointment.updatedAt,
        record.appointment.version,
        record.archivedAt,
        record.reason,
      ],
    );
  }
}

export interface AssignmentCount {
  count: number;
  displayName: string | null;
}

/** Zählt zeitlich zuordenbare manuelle Statistik-Korrekturen pro Profil. */
export async function countStatsAdjustments(
  db: Queryable,
  from: string | null,
  to: string | null,
): Promise<Map<string, number>> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (from) {
    values.push(`${from}T00:00:00.000Z`);
    conditions.push(`adjusted_at >= $${values.length}`);
  }
  if (to) {
    values.push(`${to}T23:59:59.999Z`);
    conditions.push(`adjusted_at <= $${values.length}`);
  }
  const result = await db.query(
    `SELECT user_id, COALESCE(SUM(delta), 0) AS total
     FROM assignment_stats_adjustments
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     GROUP BY user_id`,
    values,
  );
  return new Map(result.rows.map((row) => [String(row.user_id), Number(row.total)]));
}

/**
 * Zählt tatsächlich durchgeführte Termine (Grund "abgelaufen") pro Profil
 * aus den Tages-Archivtabellen. from/to sind einschließlich, null = unbegrenzt.
 */
export async function countAssignmentsByAssignee(
  db: Queryable,
  from: string | null,
  to: string | null,
): Promise<Map<string, AssignmentCount>> {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '^history_[0-9]{4}_[0-9]{2}_[0-9]{2}$'",
  );
  const totals = new Map<string, AssignmentCount>();
  for (const row of tables.rows) {
    const table = String(row.tablename);
    const date = table.replace("history_", "").replaceAll("_", "-");
    if (from && date < from) continue;
    if (to && date > to) continue;
    const result = await db.query(
      `SELECT assignee_id, COUNT(*) AS count, MAX(assignee_display_name) AS display_name
       FROM "${table}"
       WHERE assignee_id IS NOT NULL AND reason = 'abgelaufen'
       GROUP BY assignee_id`,
    );
    for (const entry of result.rows) {
      const id = String(entry.assignee_id);
      const current = totals.get(id) ?? { count: 0, displayName: null };
      current.count += Number(entry.count);
      current.displayName ??= entry.display_name != null ? String(entry.display_name) : null;
      totals.set(id, current);
    }
  }
  return totals;
}

/** Zählt regulär abgeschlossene Termine pro Tag für einen inklusiven Zeitraum. */
export async function countCompletedAppointmentsByDay(
  db: Queryable,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '^history_[0-9]{4}_[0-9]{2}_[0-9]{2}$'",
  );
  const totals = new Map<string, number>();
  for (const row of tables.rows) {
    const table = String(row.tablename);
    const date = table.replace("history_", "").replaceAll("_", "-");
    if (date < from || date > to) continue;
    const result = await db.query(
      `SELECT COUNT(*) AS count FROM "${table}" WHERE reason = 'abgelaufen'`,
    );
    totals.set(date, Number(result.rows[0]?.count ?? 0));
  }
  return totals;
}

export async function readHistory(
  db: Queryable,
  date: string,
): Promise<AppointmentHistoryEntry[]> {
  const table = historyTableName(date);
  const exists = await db.query("SELECT to_regclass($1) AS table_name", [table]);
  if (!exists.rows[0]?.table_name) return [];
  const result = await db.query(
    `SELECT * FROM "${table}" ORDER BY start_time, name, id`,
  );
  return result.rows.map((row) => ({
    appointmentId: String(row.appointment_id),
    date: String(row.appointment_date),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    name: String(row.name),
    assigneeId: row.assignee_id != null ? String(row.assignee_id) : null,
    assigneeUsername: row.assignee_username != null ? String(row.assignee_username) : null,
    assigneeDisplayName:
      row.assignee_display_name != null ? String(row.assignee_display_name) : null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
    archivedAt: String(row.archived_at),
    reason: String(row.reason),
  }));
}
