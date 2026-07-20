import pg from "pg";

export async function createTestDatabase(name: string): Promise<string> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      "TEST_DATABASE_URL ist nicht gesetzt. Die Tests benötigen eine PostgreSQL-Instanz.",
    );
  }
  const admin = new pg.Pool({ connectionString: adminUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function resetTestDatabase(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  } finally {
    await pool.end();
  }
}
