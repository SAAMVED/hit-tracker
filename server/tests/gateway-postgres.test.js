import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createWebSocketGateway } from "../src/gateway.js";
import { createIsolatedTestSchema } from "./helpers/postgres.js";

const schemaSql = `
  CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE soldiers(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE missions(id TEXT PRIMARY KEY,name TEXT NOT NULL,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,status TEXT NOT NULL);
  CREATE TABLE mission_soldiers(mission_id TEXT REFERENCES missions(id),soldier_id TEXT REFERENCES soldiers(id),team_id TEXT REFERENCES teams(id),assigned_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(mission_id,soldier_id,team_id));
  CREATE TABLE telemetry(id BIGSERIAL PRIMARY KEY,mission_id TEXT REFERENCES missions(id),soldier_id TEXT REFERENCES soldiers(id),team_id TEXT REFERENCES teams(id),seq BIGINT NOT NULL,timestamp TIMESTAMPTZ NOT NULL,x DOUBLE PRECISION NOT NULL,y DOUBLE PRECISION NOT NULL,altitude DOUBLE PRECISION,floor TEXT,pressure_hpa DOUBLE PRECISION NOT NULL,battery_pct SMALLINT NOT NULL,signal_strength SMALLINT NOT NULL,sensor_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,received_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE reference_readings(id BIGSERIAL PRIMARY KEY,station_id TEXT NOT NULL,pressure_hpa DOUBLE PRECISION NOT NULL,temperature_c DOUBLE PRECISION,timestamp TIMESTAMPTZ NOT NULL,metadata JSONB DEFAULT '{}'::jsonb);
  CREATE TABLE rejected_packets(id BIGSERIAL PRIMARY KEY,soldier_id TEXT,reason TEXT NOT NULL,raw_payload JSONB NOT NULL,timestamp TIMESTAMPTZ NOT NULL);
  CREATE TABLE alerts(id TEXT PRIMARY KEY,type TEXT NOT NULL,severity TEXT NOT NULL,soldier_id TEXT REFERENCES soldiers(id),team_id TEXT REFERENCES teams(id),mission_id TEXT REFERENCES missions(id),message TEXT NOT NULL,ts TIMESTAMPTZ NOT NULL,acknowledged BOOLEAN DEFAULT false,acknowledged_by TEXT,acknowledged_at TIMESTAMPTZ,resolved BOOLEAN DEFAULT false,resolved_by TEXT,resolved_at TIMESTAMPTZ,payload JSONB DEFAULT '{}'::jsonb);
`;

let db;
let isolated;
let httpServer;
let gateway;
let baseUrl;

before(async () => {
  isolated = await createIsolatedTestSchema("gateway_test", schemaSql);
  db = isolated.pool;
  await db.query("INSERT INTO missions(id,name,started_at,status) VALUES('gateway-mission','Gateway Test',to_timestamp(1000),'active')");
  httpServer = createServer();
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `ws://127.0.0.1:${httpServer.address().port}`;
  gateway = await createWebSocketGateway(httpServer, db);
});

after(async () => {
  gateway?.close();
  if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  await isolated?.close();
});

function connect(url) {
  const socket = new WebSocket(url);
  const queued = [];
  const waiters = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queued.push(message);
  });
  socket.on("error", (error) => waiters.splice(0).forEach((waiter) => waiter.reject(error)));
  return {
    socket,
    waitFor(predicate, timeoutMs = 3000) {
      const found = queued.findIndex(predicate);
      if (found >= 0) return Promise.resolve(queued.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), timeoutMs);
        waiters.push({
          predicate,
          resolve(value) { clearTimeout(timer); resolve(value); },
          reject(error) { clearTimeout(timer); reject(error); },
        });
      });
    },
  };
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Condition did not become true before timeout");
}

test("gateway persists reference readings, assignments and telemetry; audits rejected packets and restores reference state", async () => {
  const dashboard = connect(`${baseUrl}/ws/dashboard?token=${jwt.sign({ sub: "viewer", role: "viewer" }, process.env.JWT_SECRET || "dev_secret")}`);
  const ingest = connect(`${baseUrl}/ws/ingest`);
  await Promise.all([
    new Promise((resolve, reject) => { dashboard.socket.once("open", resolve); dashboard.socket.once("error", reject); }),
    new Promise((resolve, reject) => { ingest.socket.once("open", resolve); ingest.socket.once("error", reject); }),
  ]);
  await dashboard.waitFor((message) => message.type === "connected");

  const reference = { type: "reference_station", payload: { stationId: "ICP-TEST", pressureHpa: 1007.5, temperatureC: 22, timestamp: 10_000 } };
  const savedReference = dashboard.waitFor((message) => message.type === "reference_station" && message.payload?.stationId === "ICP-TEST");
  ingest.socket.send(JSON.stringify(reference));
  await savedReference;
  const readings = await db.query("SELECT station_id,pressure_hpa,temperature_c FROM reference_readings");
  assert.deepEqual(readings.rows[0], { station_id: "ICP-TEST", pressure_hpa: 1007.5, temperature_c: 22 });

  const packet = (overrides = {}) => ({
    type: "telemetry",
    payload: { soldierId: "GW-A1", teamId: "Alpha", seq: 1, timestamp: 20_000, x: 1, y: 2, pressureHpa: 1000, batteryPct: 80, signal: -45, ...overrides },
  });
  const live = dashboard.waitFor((message) => message.type === "telemetry");
  ingest.socket.send(JSON.stringify(packet()));
  const liveMessage = await live;
  assert.equal(liveMessage.payload.soldierId, "GW-A1");

  const telemetry = await db.query("SELECT mission_id,soldier_id,team_id,seq,x,y FROM telemetry");
  assert.deepEqual(telemetry.rows[0], { mission_id: "gateway-mission", soldier_id: "GW-A1", team_id: "Alpha", seq: "1", x: 1, y: 2 });
  assert.equal((await db.query("SELECT count(*)::int AS count FROM mission_soldiers WHERE mission_id='gateway-mission'")).rows[0].count, 1);

  ingest.socket.send(JSON.stringify(packet({ seq: 2, timestamp: 21_000, x: 80 })));
  await waitUntil(async () => (await db.query("SELECT count(*)::int AS count FROM rejected_packets")).rows[0].count === 1);
  const rejected = await db.query("SELECT soldier_id,reason,raw_payload FROM rejected_packets");
  assert.equal(rejected.rows[0].soldier_id, "GW-A1");
  assert.equal(rejected.rows[0].reason, "IMPOSSIBLE_HORIZONTAL_SPEED");
  assert.equal(rejected.rows[0].raw_payload.payload.seq, 2);

  dashboard.socket.close();
  ingest.socket.close();
  await Promise.all([
    new Promise((resolve) => dashboard.socket.once("close", resolve)),
    new Promise((resolve) => ingest.socket.once("close", resolve)),
  ]);
  gateway.close();
  gateway = await createWebSocketGateway(httpServer, db);
  const restoredDashboard = connect(`${baseUrl}/ws/dashboard?token=${jwt.sign({ sub: "viewer", role: "viewer" }, process.env.JWT_SECRET || "dev_secret")}`);
  await new Promise((resolve, reject) => { restoredDashboard.socket.once("open", resolve); restoredDashboard.socket.once("error", reject); });
  const restored = await restoredDashboard.waitFor((message) => message.type === "reference_station");
  assert.equal(restored.payload.stationId, "ICP-TEST");
  assert.equal(restored.pressureHpa, 1007.5);
  restoredDashboard.socket.close();
});
