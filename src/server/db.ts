import pg from "pg";
import type {
  Appointment,
  AppointmentHistoryEntry,
  AppUser,
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
      avatar_updated_at TEXT
    )
  `);
  // Bestand aus Version 3.0: alte Quellen-Einschränkung ohne 'local' entfernen.
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_source_check");
  // Bestand älterer Versionen: optionale Mail-Einstellung der Benutzer nachrüsten.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS agenda_mails_enabled BOOLEAN");
  // Bestand älterer Versionen: manuellen Statistik-Korrekturwert nachrüsten.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stats_adjustment INTEGER");
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
      version INTEGER NOT NULL
    )
  `);
  return pool;
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

/**
 * Zählt tatsächlich durchgeführte Termine (Grund "abgelaufen") pro Benutzer
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
