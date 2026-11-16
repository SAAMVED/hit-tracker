import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDatabase({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error("DATABASE_URL must be configured; SQLite fallback is disabled.");
  return new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10), connectionTimeoutMillis: 5000 });
}

export async function runMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const directory = path.resolve(__dirname, "../migrations");
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (exists.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await fs.readFile(path.join(directory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function initializeDatabase(pool) {
  await runMigrations(pool);
}

export async function seedUsers(pool) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM users");
  if (rows[0].cnt > 0) return;
  const values = [
    ["commander", process.env.COMMANDER_PASSWORD ?? "Commander@NSG1", "commander"],
    ["viewer", process.env.VIEWER_PASSWORD ?? "Viewer@NSG1", "viewer"],
  ];
  for (const [username, password, role] of values) {
    await pool.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING", [username, bcrypt.hashSync(password, 10), role]);
  }
}

export function toEpochMs(value) {
  return value == null ? null : new Date(value).getTime();
}
