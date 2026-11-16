import "dotenv/config";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/db.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.resolve(process.argv[2] || path.join(repositoryRoot, "db/hit-tracker.sqlite"));
const requiredTables = ["users", "missions", "telemetry", "calibration", "reference_readings", "rejected_packets", "alerts"];
const destinationTables = ["users", "missions", "telemetry", "calibration", "reference_readings", "rejected_packets", "alerts", "soldiers", "teams", "mission_soldiers"];
const skipped = [];
const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "hit-tracker-sqlite-import-"));
const snapshotPath = path.join(tempDirectory, "snapshot.sqlite");
let source;
let snapshot;
const pool = createDatabase();

try {
  await fs.access(sourcePath);
  // A read-only SQLite connection sees committed WAL pages. The backup API copies that
  // consistent logical snapshot to a separate temporary file without changing the source.
  source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await source.backup(snapshotPath);
  snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  const fingerprint = createHash("sha256").update(await fs.readFile(snapshotPath)).digest("hex");
  const tableNames = new Set(snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const table of requiredTables) {
    if (!tableNames.has(table)) throw new Error(`Source snapshot is missing required table: ${table}`);
  }

  const sourceCounts = Object.fromEntries(requiredTables.map((table) => [table, snapshot.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const rows = Object.fromEntries(requiredTables.map((table) => [table, snapshot.prepare(`SELECT * FROM ${table} ORDER BY ${table === "missions" ? "id" : "id"}`).all()]));
  const missionsById = new Map(rows.missions.map((row) => [row.id, row]));

  const filterValid = (table, predicate, explain) => rows[table].filter((row) => {
    const reason = predicate(row);
    if (!reason) return true;
    skipped.push({ table, id: row.id, reason: explain(row, reason) });
    return false;
  });
  const validRows = {};
  validRows.users = filterValid("users", (r) => !Number.isSafeInteger(r.id) || !r.username || !r.password_hash || !["commander", "viewer"].includes(r.role) || !Number.isSafeInteger(r.created_at), () => "missing/invalid user ID or data, invalid role, or invalid created_at");
  validRows.missions = filterValid("missions", (r) => !r.id || !r.name || !["active", "completed"].includes(r.status) || !Number.isSafeInteger(r.started_at) || !Number.isSafeInteger(r.created_at) || (r.ended_at != null && !Number.isSafeInteger(r.ended_at)), () => "missing required mission data, invalid status, or invalid timestamp");
  const validMissionIds = new Set(validRows.missions.map((r) => r.id));
  validRows.telemetry = filterValid("telemetry", (r) => {
    if (!r.mission_id) return "mission_id is NULL; importer will not invent a mission";
    if (!validMissionIds.has(r.mission_id)) return `mission_id ${r.mission_id} does not exist or was invalid`;
    if (!r.soldier_id || !r.team_id) return "soldier_id or team_id is NULL/empty";
    if (![r.id, r.seq, r.ts, r.received_at].every(Number.isSafeInteger)) return "id, sequence, or timestamp is not a safe integer";
    if (![r.x, r.y, r.pressure_hpa].every(Number.isFinite)) return "coordinate or pressure is not finite";
    if (!Number.isInteger(r.battery_pct) || r.battery_pct < 0 || r.battery_pct > 100 || !Number.isInteger(r.signal)) return "battery or signal value is invalid";
    if (r.altitude != null && !Number.isFinite(r.altitude)) return "altitude is not finite";
    return null;
  }, (_r, reason) => reason);
  const validTelemetry = validRows.telemetry;
  validRows.calibration = filterValid("calibration", (r) => !r.id || !Number.isSafeInteger(r.updated_at) || ![r.translation_x,r.translation_y,r.translation_z,r.rotation_x,r.rotation_y,r.rotation_z,r.scale_x,r.scale_y,r.scale_z].every(Number.isFinite), () => "missing calibration ID or invalid transform/timestamp value");
  validRows.reference_readings = filterValid("reference_readings", (r) => !Number.isSafeInteger(r.id) || !r.station_id || !Number.isSafeInteger(r.timestamp) || !Number.isFinite(r.pressure_hpa) || (r.temperature_c != null && !Number.isFinite(r.temperature_c)), () => "missing reference reading ID/station or invalid sensor/timestamp value");
  validRows.rejected_packets = filterValid("rejected_packets", (r) => !Number.isSafeInteger(r.id) || !r.reason || !Number.isSafeInteger(r.timestamp), () => "missing rejected-packet ID/reason or invalid timestamp");
  validRows.alerts = filterValid("alerts", (r) => !r.id || !r.type || !["info", "warning", "critical"].includes(r.severity) || !r.soldier_id || !r.team_id || !r.message || !Number.isSafeInteger(r.ts) || (r.acknowledged_at != null && !Number.isSafeInteger(r.acknowledged_at)), () => "missing required alert data, invalid severity, or invalid timestamp");
  const teams = new Map();
  const soldiers = new Map();
  const assignments = new Map();
  for (const row of validTelemetry) {
    teams.set(row.team_id, { id: row.team_id, name: null });
    soldiers.set(row.soldier_id, { id: row.soldier_id, name: null });
    assignments.set(`${row.mission_id}\0${row.soldier_id}\0${row.team_id}`, {
      mission_id: row.mission_id, soldier_id: row.soldier_id, team_id: row.team_id,
    });
  }
  for (const row of validRows.alerts) {
    teams.set(row.team_id, { id: row.team_id, name: null });
    soldiers.set(row.soldier_id, { id: row.soldier_id, name: null });
  }
  validRows.teams = [...teams.values()];
  validRows.soldiers = [...soldiers.values()];
  validRows.mission_soldiers = [...assignments.values()];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [fingerprint]);
    const alreadyImported = await client.query("SELECT counts FROM import_runs WHERE source_fingerprint=$1", [fingerprint]);
    if (alreadyImported.rowCount) throw new Error(`Source snapshot was already imported (fingerprint ${fingerprint.slice(0, 12)}).`);
    const migration = await client.query("SELECT 1 FROM schema_migrations WHERE version='001_initial_postgresql.sql'");
    if (!migration.rowCount) throw new Error("PostgreSQL schema migration 001 is not applied; run the documented migration command first.");

    for (const table of destinationTables) {
      const { rows: [row] } = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${table}`);
      if (Number(row.count) !== 0) throw new Error(`Destination table ${table} is not empty; refusing import to prevent data collision.`);
    }

    await insertBatch(client, "teams", ["id", "name"], validRows.teams, (r) => [r.id, r.name]);
    await insertBatch(client, "soldiers", ["id", "name"], validRows.soldiers, (r) => [r.id, r.name]);
    await insertBatch(client, "users", ["id", "username", "password_hash", "role", "created_at"], validRows.users,
      (r) => [r.id, r.username, r.password_hash, r.role, dateFromMs(r.created_at)]);
    await insertBatch(client, "missions", ["id", "name", "started_at", "ended_at", "status", "created_at"], validRows.missions,
      (r) => [r.id, r.name, dateFromMs(r.started_at), dateFromMs(r.ended_at), r.status, dateFromMs(r.created_at)]);
    await insertBatch(client, "calibration", ["id", "translation_x", "translation_y", "translation_z", "rotation_x", "rotation_y", "rotation_z", "scale_x", "scale_y", "scale_z", "updated_at"], validRows.calibration,
      (r) => [r.id, r.translation_x, r.translation_y, r.translation_z, r.rotation_x, r.rotation_y, r.rotation_z, r.scale_x, r.scale_y, r.scale_z, dateFromMs(r.updated_at)]);
    await insertBatch(client, "mission_soldiers", ["mission_id", "soldier_id", "team_id"], validRows.mission_soldiers,
      (r) => [r.mission_id, r.soldier_id, r.team_id]);
    await insertBatch(client, "telemetry", ["id", "mission_id", "soldier_id", "team_id", "seq", "timestamp", "x", "y", "altitude", "floor", "pressure_hpa", "battery_pct", "signal_strength", "sensor_metadata", "received_at"], validTelemetry,
      (r) => [r.id, r.mission_id, r.soldier_id, r.team_id, r.seq, dateFromMs(r.ts), r.x, r.y, r.altitude, r.floor, r.pressure_hpa, r.battery_pct, r.signal, JSON.stringify({ accelMagnitude: r.accel_magnitude }), dateFromMs(r.received_at)]);
    await insertBatch(client, "reference_readings", ["id", "station_id", "pressure_hpa", "temperature_c", "timestamp"], validRows.reference_readings,
      (r) => [r.id, r.station_id, r.pressure_hpa, r.temperature_c, dateFromMs(r.timestamp)]);
    await insertBatch(client, "rejected_packets", ["id", "soldier_id", "reason", "raw_payload", "timestamp"], validRows.rejected_packets,
      // SQLite exposed raw_payload as text. Store it as a JSON string so node-postgres
      // and the API continue returning a string instead of a parsed object.
      (r) => [r.id, r.soldier_id, r.reason, JSON.stringify(String(r.raw_payload)), dateFromMs(r.timestamp)], "::jsonb");
    await insertBatch(client, "alerts", ["id", "type", "severity", "soldier_id", "team_id", "message", "ts", "acknowledged", "acknowledged_by", "acknowledged_at"], validRows.alerts,
      (r) => [r.id, r.type, r.severity, r.soldier_id, r.team_id, r.message, dateFromMs(r.ts), Boolean(r.acknowledged), r.acknowledged_by, dateFromMs(r.acknowledged_at)]);

    await setIdentity(client, "users");
    for (const table of ["telemetry", "reference_readings", "rejected_packets"]) await setIdentity(client, table);
    const importedCounts = {};
    for (const table of requiredTables) {
      importedCounts[table] = validRows[table].length;
      const { rows: [actual] } = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${table}`);
      if (Number(actual.count) !== importedCounts[table]) {
        throw new Error(`${table} count mismatch: expected ${importedCounts[table]}, found ${actual.count}`);
      }
    }
    await client.query("INSERT INTO import_runs(source_fingerprint,source_path,counts) VALUES($1,$2,$3::jsonb)",
      [fingerprint, sourcePath, JSON.stringify({ source: sourceCounts, imported: importedCounts, skipped: skipped.length })]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ sourcePath, fingerprint, sourceCounts, importedCounts, skipped }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  snapshot?.close();
  source?.close();
  await pool.end();
  await fs.rm(tempDirectory, { recursive: true, force: true });
}

function dateFromMs(value) {
  return value == null ? null : new Date(Number(value));
}

async function insertBatch(client, table, columns, records, mapRecord, cast = "") {
  const batchSize = 400;
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    const values = [];
    const groups = batch.map((record, rowIndex) => {
      const rowValues = mapRecord(record);
      const slots = rowValues.map((value, columnIndex) => {
        values.push(value);
        const parameter = `$${rowIndex * columns.length + columnIndex + 1}`;
        return cast && columns[columnIndex] === "raw_payload" ? `${parameter}${cast}` : parameter;
      });
      return `(${slots.join(",")})`;
    });
    await client.query(`INSERT INTO ${table}(${columns.join(",")}) VALUES ${groups.join(",")}`, values);
  }
}

async function setIdentity(client, table) {
  await client.query(`SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE((SELECT MAX(id) FROM ${table}),1),EXISTS(SELECT 1 FROM ${table}))`, [table]);
}
