import BetterSqlite3 from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, "../../db");
const DB_PATH = path.join(DB_DIR, "hit-tracker.sqlite");

export function createDatabase() {
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

    CREATE TABLE IF NOT EXISTS calibration (
      id            TEXT PRIMARY KEY,
      translation_x REAL NOT NULL DEFAULT 0,
      translation_y REAL NOT NULL DEFAULT 0,
      translation_z REAL NOT NULL DEFAULT 0,
      rotation_x    REAL NOT NULL DEFAULT 0,
      rotation_y    REAL NOT NULL DEFAULT 0,
      rotation_z    REAL NOT NULL DEFAULT 0,
      scale_x       REAL NOT NULL DEFAULT 1,
      scale_y       REAL NOT NULL DEFAULT 1,
      scale_z       REAL NOT NULL DEFAULT 1,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS missions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      status     TEXT NOT NULL CHECK(status IN ('active', 'completed')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS rejected_packets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      soldier_id  TEXT NOT NULL,
      reason      TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_rejected_soldier ON rejected_packets(soldier_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS reference_readings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id    TEXT NOT NULL,
      pressure_hpa  REAL NOT NULL,
      temperature_c REAL,
      timestamp     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_ref_ts ON reference_readings(timestamp DESC);
  `);

  try {
    db.exec("ALTER TABLE telemetry ADD COLUMN floor TEXT");
  } catch {
    // Column already exists or table was just created with the column
  }

  try {
    db.exec("ALTER TABLE telemetry ADD COLUMN mission_id TEXT");
  } catch {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE telemetry ADD COLUMN altitude REAL");
  } catch {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE telemetry ADD COLUMN accel_magnitude REAL");
  } catch {
    // Column already exists
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_mission_soldier_ts
    ON telemetry(mission_id, soldier_id, ts)
  `);

  // Seed default calibration if not present
  const existingCalib = db.prepare("SELECT id FROM calibration WHERE id = 'default'").get();
  if (!existingCalib) {
    db.prepare(`
      INSERT INTO calibration (id, translation_x, translation_y, translation_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z)
      VALUES ('default', 0, 0, 0, 0, 0, 0, 1, 1, 1)
    `).run();
  }

  // Seed default active mission if none exist
  const existingMission = db.prepare("SELECT id FROM missions WHERE status = 'active' LIMIT 1").get();
  if (!existingMission) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO missions (id, name, started_at, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run("mission-live", "Operation Black Tornado (Live ICP)", now, now);
  }

  return db;
}

export function seedUsers(db) {
  const existing = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
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
