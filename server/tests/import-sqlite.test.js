import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runMigrations } from "../src/db.js";
import { createIsolatedTestSchema } from "./helpers/postgres.js";

const execFileAsync = promisify(execFile);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerPath = path.join(serverRoot, "scripts/import-sqlite.js");

function testDatabaseUrl(schema) {
  const value = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Configure TEST_DATABASE_URL or DATABASE_URL for PostgreSQL importer tests.");
  const url = new URL(value);
  if (!process.env.TEST_DATABASE_URL) url.pathname = "/hit_tracker_test";
  if (decodeURIComponent(url.pathname.slice(1)) !== "hit_tracker_test") {
    throw new Error("Importer integration tests are restricted to hit_tracker_test.");
  }
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

async function makeSourceDatabase(filePath) {
  const sqlite = new Database(filePath);
  sqlite.exec(`
    CREATE TABLE users(id INTEGER,username TEXT,password_hash TEXT,role TEXT,created_at INTEGER);
    CREATE TABLE missions(id TEXT,name TEXT,started_at INTEGER,ended_at INTEGER,status TEXT,created_at INTEGER);
    CREATE TABLE telemetry(id INTEGER,mission_id TEXT,soldier_id TEXT,team_id TEXT,seq INTEGER,ts INTEGER,received_at INTEGER,x REAL,y REAL,altitude REAL,floor TEXT,pressure_hpa REAL,battery_pct INTEGER,signal INTEGER,accel_magnitude REAL);
    CREATE TABLE calibration(id TEXT,translation_x REAL,translation_y REAL,translation_z REAL,rotation_x REAL,rotation_y REAL,rotation_z REAL,scale_x REAL,scale_y REAL,scale_z REAL,updated_at INTEGER);
    CREATE TABLE reference_readings(id INTEGER,station_id TEXT,pressure_hpa REAL,temperature_c REAL,timestamp INTEGER);
    CREATE TABLE rejected_packets(id INTEGER,soldier_id TEXT,reason TEXT,raw_payload TEXT,timestamp INTEGER);
    CREATE TABLE alerts(id TEXT,type TEXT,severity TEXT,soldier_id TEXT,team_id TEXT,message TEXT,ts INTEGER,acknowledged INTEGER,acknowledged_by TEXT,acknowledged_at INTEGER);
    INSERT INTO users VALUES(7,'imported-user','bcrypt-hash','viewer',1700000000000);
    INSERT INTO missions VALUES('import-mission','Imported Mission',1700000000000,NULL,'completed',1700000000000);
    INSERT INTO telemetry VALUES(11,'import-mission','I-A1','Alpha',1,1700000001000,1700000001100,1.5,2.5,3,'G',1000,80,-45,1.1);
    INSERT INTO telemetry VALUES(12,'missing-mission','I-A1','Alpha',2,1700000002000,1700000002100,2.5,3.5,3,'G',1000,80,-45,1.1);
    INSERT INTO reference_readings VALUES(13,'ICP-OLD',1008.5,21.5,1700000003000);
    INSERT INTO rejected_packets VALUES(14,'I-A1','TEST_REJECTION','{"raw":true}',1700000004000);
  `);
  sqlite.close();
}

test("SQLite importer preserves valid source rows, reports invalid records, and rejects duplicate imports", async (t) => {
  const isolated = await createIsolatedTestSchema("import_test", "");
  t.after(() => isolated.close());
  await runMigrations(isolated.pool);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hit-tracker-import-test-"));
  const sourcePath = path.join(directory, "source.sqlite");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await makeSourceDatabase(sourcePath);

  const env = { ...process.env, DATABASE_URL: testDatabaseUrl(isolated.schema) };
  delete env.TEST_DATABASE_URL;
  const first = await execFileAsync(process.execPath, [importerPath, sourcePath], { cwd: serverRoot, env, maxBuffer: 2_000_000 });
  const report = JSON.parse(first.stdout);
  assert.equal(report.sourceCounts.telemetry, 2);
  assert.equal(report.importedCounts.telemetry, 1);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /missing-mission/);

  const user = await isolated.pool.query("SELECT id,username FROM users");
  assert.deepEqual(user.rows[0], { id: "7", username: "imported-user" });
  const packet = await isolated.pool.query("SELECT id,mission_id,soldier_id,team_id,seq,(extract(epoch FROM timestamp)*1000)::bigint AS ts,sensor_metadata FROM telemetry");
  assert.equal(packet.rows[0].id, "11");
  assert.equal(packet.rows[0].mission_id, "import-mission");
  assert.equal(packet.rows[0].soldier_id, "I-A1");
  assert.equal(Number(packet.rows[0].ts), 1700000001000);
  assert.equal(packet.rows[0].sensor_metadata.accelMagnitude, 1.1);
  const rejected = await isolated.pool.query("SELECT raw_payload FROM rejected_packets WHERE id=14");
  assert.equal(rejected.rows[0].raw_payload, '{"raw":true}');
  const reference = await isolated.pool.query("SELECT station_id,pressure_hpa FROM reference_readings WHERE id=13");
  assert.deepEqual(reference.rows[0], { station_id: "ICP-OLD", pressure_hpa: 1008.5 });

  await assert.rejects(
    execFileAsync(process.execPath, [importerPath, sourcePath], { cwd: serverRoot, env, maxBuffer: 2_000_000 }),
    (error) => error.code === 1 && /already imported/.test(error.stderr),
  );
  assert.equal((await isolated.pool.query("SELECT count(*)::int AS count FROM telemetry")).rows[0].count, 1);
});
