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
