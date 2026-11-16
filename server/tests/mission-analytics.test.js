import assert from "node:assert/strict";
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { after, before, beforeEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { restoreCalibration } from "../src/calibration-state.js";
import { createIsolatedTestSchema } from "./helpers/postgres.js";

const schemaSql = `
  CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('commander','viewer')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE soldiers(id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE missions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ, status TEXT NOT NULL CHECK(status IN ('active','completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX missions_started_idx ON missions(started_at DESC);
  CREATE TABLE telemetry (
    id BIGSERIAL PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id),
    soldier_id TEXT NOT NULL REFERENCES soldiers(id), team_id TEXT NOT NULL REFERENCES teams(id),
    seq BIGINT NOT NULL DEFAULT 0, timestamp TIMESTAMPTZ NOT NULL, x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL, altitude DOUBLE PRECISION, floor TEXT, pressure_hpa DOUBLE PRECISION NOT NULL DEFAULT 1000,
    battery_pct SMALLINT NOT NULL DEFAULT 100, signal_strength SMALLINT NOT NULL DEFAULT 100,
    sensor_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE INDEX telemetry_mission_soldier_time_idx ON telemetry(mission_id,soldier_id,timestamp,id);
  CREATE INDEX telemetry_mission_time_idx ON telemetry(mission_id,timestamp,id);
  CREATE TABLE calibration (
    id TEXT PRIMARY KEY, translation_x NUMERIC NOT NULL DEFAULT 0, translation_y NUMERIC NOT NULL DEFAULT 0,
    translation_z NUMERIC NOT NULL DEFAULT 0, rotation_x NUMERIC NOT NULL DEFAULT 0,
    rotation_y NUMERIC NOT NULL DEFAULT 0, rotation_z NUMERIC NOT NULL DEFAULT 0,
    scale_x NUMERIC NOT NULL DEFAULT 1, scale_y NUMERIC NOT NULL DEFAULT 1,
    scale_z NUMERIC NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), calibrated_by TEXT
  );
  CREATE TABLE calibration_history (
    id BIGSERIAL PRIMARY KEY, calibration_id TEXT NOT NULL REFERENCES calibration(id),
    translation_x NUMERIC NOT NULL, translation_y NUMERIC NOT NULL, translation_z NUMERIC NOT NULL,
    rotation_x NUMERIC NOT NULL, rotation_y NUMERIC NOT NULL, rotation_z NUMERIC NOT NULL,
    scale_x NUMERIC NOT NULL, scale_y NUMERIC NOT NULL, scale_z NUMERIC NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(), changed_by TEXT
  );
`;

let db;
let app;
let testDb;
let commanderToken;
let viewerToken;

before(async () => {
  testDb = await createIsolatedTestSchema("api_test", schemaSql);
  db = testDb.pool;
  app = createApp(db);
  const secret = process.env.JWT_SECRET || "dev_secret";
  commanderToken = jwt.sign({ sub: "commander", role: "commander" }, secret);
  viewerToken = jwt.sign({ sub: "viewer", role: "viewer" }, secret);
});

after(async () => testDb?.close());

beforeEach(async () => {
  await db.query("TRUNCATE telemetry,missions,teams,soldiers,calibration_history,calibration,users RESTART IDENTITY CASCADE");
  await restoreCalibration(db);
  await db.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,'commander'),($3,$4,'viewer')", [
    "commander", bcrypt.hashSync("commander-test-password", 4),
    "viewer", bcrypt.hashSync("viewer-test-password", 4),
  ]);
  await db.query("INSERT INTO teams(id,name) VALUES('Alpha','Alpha Team'),('Bravo','Bravo Team')");
  await db.query("INSERT INTO soldiers(id,name) VALUES('A1','Soldier A1'),('B1','Soldier B1')");
});

function invokeRoute(method, path, { token, params = {}, query = {}, body = {} } = {}) {
  const layer = app._router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  const req = {
    method: method.toUpperCase(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params,
    query,
    body,
  };

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let index = 0;
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { resolve({ statusCode, body: value }); return this; },
    };
    const next = (error) => {
      if (error) return reject(error);
      const handler = layer.route.stack[index++]?.handle;
      if (!handler) return resolve({ statusCode, body: undefined });
      try {
        Promise.resolve(handler(req, response, next)).catch(next);
      } catch (handlerError) {
        reject(handlerError);
      }
    };
    next();
  });
}

async function insertMission({ id, startedAt = 1_000, endedAt = null, status = "active", name = id }) {
  await db.query(`INSERT INTO missions(id,name,started_at,ended_at,status)
    VALUES($1,$2,to_timestamp($3/1000.0),CASE WHEN $4::double precision IS NULL THEN NULL ELSE to_timestamp($4/1000.0) END,$5)`,
  [id, name, startedAt, endedAt, status]);
}

async function insertTelemetry({ missionId, soldierId = "A1", teamId = "Alpha", timestamp, x = 0, y = 0, floor = "G", accelMagnitude = 1 }) {
  await db.query(`INSERT INTO telemetry(mission_id,soldier_id,team_id,timestamp,x,y,floor,sensor_metadata)
    VALUES($1,$2,$3,to_timestamp($4/1000.0),$5,$6,$7,$8::jsonb)`,
  [missionId, soldierId, teamId, timestamp, x, y, floor, JSON.stringify({ accelMagnitude })]);
}

test("mission APIs enforce roles, create and retrieve missions, and return 404 for missing IDs", async () => {
  await insertMission({ id: "existing-active" });
  const unauthenticated = await invokeRoute("get", "/api/missions");
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal((await invokeRoute("post", "/api/missions", { token: viewerToken, body: { name: "Denied" } })).statusCode, 403);
  assert.equal((await invokeRoute("post", "/api/missions", { token: commanderToken, body: { name: "  " } })).statusCode, 400);

  const created = await invokeRoute("post", "/api/missions", { token: commanderToken, body: { name: "New Operation" } });
  assert.equal(created.statusCode, 200);
  assert.match(created.body.id, /^mission-\d+$/);
  assert.equal(Number(created.body.id.slice("mission-".length)), created.body.startedAt);
  assert.equal(created.body.name, "New Operation");
  assert.equal(created.body.status, "active");
  assert.equal((await db.query("SELECT status FROM missions WHERE id='existing-active'")).rows[0].status, "completed");

  const retrieved = await invokeRoute("get", "/api/missions/:id", { token: viewerToken, params: { id: created.body.id } });
  assert.equal(retrieved.statusCode, 200);
  assert.equal(retrieved.body.id, created.body.id);
  assert.equal(retrieved.body.packetCount, 0);
  assert.equal((await invokeRoute("get", "/api/missions/:id", { token: commanderToken, params: { id: "missing" } })).statusCode, 404);
  assert.equal((await invokeRoute("post", "/api/missions/:id/end", { token: viewerToken, params: { id: created.body.id } })).statusCode, 403);
  assert.equal((await invokeRoute("post", "/api/missions/:id/end", { token: commanderToken, params: { id: "missing" } })).statusCode, 404);
  const ended = await invokeRoute("post", "/api/missions/:id/end", { token: commanderToken, params: { id: created.body.id } });
  assert.equal(ended.statusCode, 200);
  assert.equal(ended.body.id, created.body.id);

  const listed = await invokeRoute("get", "/api/missions", { token: viewerToken });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.map((mission) => mission.id), [created.body.id, "existing-active"]);
});

test("replay returns only the requested mission and soldier in chronological order", async () => {
  await insertMission({ id: "mission-a" });
  await insertMission({ id: "mission-b" });
  await insertTelemetry({ missionId: "mission-a", timestamp: 3_000, soldierId: "A1", x: 3, floor: "1", accelMagnitude: 1.2 });
  await insertTelemetry({ missionId: "mission-a", timestamp: 1_000, soldierId: "A1", x: 1, floor: "G" });
  await insertTelemetry({ missionId: "mission-a", timestamp: 2_000, soldierId: "B1", teamId: "Bravo", x: 2 });
  await insertTelemetry({ missionId: "mission-b", timestamp: 500, x: 99 });

  const replay = await invokeRoute("get", "/api/missions/:id/telemetry", {
    token: viewerToken,
    params: { id: "mission-a" },
    query: { soldierId: "A1", from: "1000", to: "3000" },
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body.map((packet) => packet.timestamp), [1_000, 3_000]);
  assert.equal(replay.body[0].estimatedFloor, "G");
  assert.equal(replay.body[1].estimatedFloor, "1");
  assert.equal(replay.body[1].accelMagnitude, 1.2);
  assert.equal((await invokeRoute("get", "/api/missions/:id/telemetry", {
    token: viewerToken, params: { id: "mission-a" }, query: { limit: "NaN" },
  })).statusCode, 400);
  assert.equal((await invokeRoute("get", "/api/missions/:id/telemetry", {
    token: viewerToken, params: { id: "missing" },
  })).statusCode, 404);
});

test("analytics uses mission-scoped PostgreSQL data and one asOf timestamp", async () => {
  await insertMission({ id: "mission-a", name: "Alpha Operation" });
  await insertMission({ id: "mission-b", name: "Other Operation" });
  await insertTelemetry({ missionId: "mission-a", timestamp: 1_000 });
  await insertTelemetry({ missionId: "mission-a", timestamp: 2_000, x: 3, y: 4 });
  await insertTelemetry({ missionId: "mission-b", timestamp: 3_000, x: 100, y: 100 });

  const originalNow = Date.now;
  Date.now = () => 25_000;
  try {
    const response = await invokeRoute("get", "/api/missions/:id/analytics", {
      token: viewerToken, params: { id: "mission-a" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.generatedAt, 25_000);
    assert.equal(response.body.mission.name, "Alpha Operation");
    assert.deepEqual(response.body.soldiers.map((soldier) => soldier.soldierId), ["A1"]);
    assert.equal(response.body.soldiers[0].distanceMeters, 5);
  } finally {
    Date.now = originalNow;
  }
  assert.equal((await invokeRoute("get", "/api/missions/:id/analytics", {
    token: viewerToken, params: { id: "missing" },
  })).statusCode, 404);
  assert.equal((await invokeRoute("get", "/api/missions/:id/analytics", {
    params: { id: "mission-a" },
  })).statusCode, 401);
});

test("calibration is restored from PostgreSQL and every Commander update is audited", async () => {
  assert.equal((await invokeRoute("get", "/api/calibration")).statusCode, 401);
  const initial = await invokeRoute("get", "/api/calibration", { token: viewerToken });
  assert.deepEqual(initial.body, {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });

  const values = {
    translation: { x: 1.25, y: -2, z: 3 },
    rotation: { x: 4, y: 5, z: 6 },
    scale: { x: 1.1, y: 1.2, z: 1.3 },
  };
  assert.equal((await invokeRoute("post", "/api/calibration", { token: viewerToken, body: values })).statusCode, 403);
  assert.equal((await invokeRoute("post", "/api/calibration", {
    token: commanderToken, body: { ...values, scale: { x: "invalid", y: 1, z: 1 } },
  })).statusCode, 400);

  const saved = await invokeRoute("post", "/api/calibration", { token: commanderToken, body: values });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.translation, values.translation);
  const restored = await invokeRoute("get", "/api/calibration", { token: viewerToken });
  assert.deepEqual(restored.body.translation, values.translation);
  assert.deepEqual(restored.body.scale, values.scale);
  assert.equal(restored.body.updatedAt, saved.body.updatedAt);

  await invokeRoute("post", "/api/calibration", {
    token: commanderToken,
    body: { ...values, translation: { x: 9, y: 8, z: 7 } },
  });
  const audit = await db.query(`SELECT calibrated_by,updated_at FROM calibration WHERE id='default'`);
  assert.equal(audit.rows[0].calibrated_by, "commander");
  const history = await db.query("SELECT changed_by,changed_at FROM calibration_history ORDER BY id");
  assert.equal(history.rowCount, 2);
  assert.deepEqual(history.rows.map((row) => row.changed_by), ["commander", "commander"]);
  assert.ok(history.rows.every((row) => row.changed_at instanceof Date));
});
