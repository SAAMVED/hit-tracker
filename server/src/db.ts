import BetterSqlite3, { type Database } from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, "../../db");
const DB_PATH = path.join(DB_DIR, "hit-tracker.sqlite");

export function createDatabase(): Database {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new BetterSqlite3(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ── Schema ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role      TEXT NOT NULL CHECK(role IN ('commander','viewer')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      soldier_id   TEXT NOT NULL,
      team_id      TEXT NOT NULL,
      seq          INTEGER NOT NULL,
      ts           INTEGER NOT NULL,
      x            REAL NOT NULL,
      y            REAL NOT NULL,
      pressure_hpa REAL NOT NULL,
      battery_pct  INTEGER NOT NULL,
      signal       INTEGER NOT NULL,
      floor        TEXT,
      received_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_soldier ON telemetry(soldier_id, ts DESC);

    CREATE TABLE IF NOT EXISTS alerts (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      severity        TEXT NOT NULL,
      soldier_id      TEXT NOT NULL,
      team_id         TEXT NOT NULL,
      message         TEXT NOT NULL,
      ts              INTEGER NOT NULL,
      acknowledged    INTEGER NOT NULL DEFAULT 0,
      acknowledged_by TEXT,
      acknowledged_at INTEGER
    );
  `);

  try {
    db.exec("ALTER TABLE telemetry ADD COLUMN floor TEXT");
  } catch {
    // Column already exists or table was just created with the column
  }

  return db;
}

export function seedUsers(db: Database): void {
  const existing = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (existing.cnt > 0) return;

  const commanderPwd = process.env.COMMANDER_PASSWORD ?? "Commander@NSG1";
  const viewerPwd = process.env.VIEWER_PASSWORD ?? "Viewer@NSG1";

  const insert = db.prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
  );

  const SALT_ROUNDS = 10;
  insert.run("commander", bcrypt.hashSync(commanderPwd, SALT_ROUNDS), "commander");
  insert.run("viewer", bcrypt.hashSync(viewerPwd, SALT_ROUNDS), "viewer");

  console.log("[db] Seeded default users: commander, viewer");
}

export type { Database };
