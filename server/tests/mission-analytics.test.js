import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";

let db;
let app;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      soldier_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      x REAL,
      y REAL,
      floor TEXT,
      mission_id TEXT
    );
    CREATE INDEX idx_telemetry_mission_soldier_ts
    ON telemetry(mission_id, soldier_id, ts);
  `);

  app = createApp(db);
});

after(() => db.close());

function invokeAnalyticsRoute(id) {
  const routeLayer = app._router.stack.find((layer) =>
    layer.route?.path === "/api/missions/:id/analytics" && layer.route.methods.get
  );
  assert.ok(routeLayer, "mission analytics GET route is registered");

  const handler = routeLayer.route.stack[0].handle;
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handler({ params: { id } }, response);
  return response;
}

function insertMission({ id, name = id, startedAt = 1_000, endedAt = null, status = "active" }) {
  db.prepare(`
    INSERT INTO missions (id, name, started_at, ended_at, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, startedAt, endedAt, status);
}

function insertTelemetry({ missionId, soldierId = "A1", teamId = "Alpha", timestamp, x = 0, y = 0, floor = "G" }) {
  db.prepare(`
    INSERT INTO telemetry (mission_id, soldier_id, team_id, ts, x, y, floor)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(missionId, soldierId, teamId, timestamp, x, y, floor);
}

test("returns analytics for only the requested mission and uses one deterministic asOf", () => {
  insertMission({ id: "mission-a", name: "Alpha Operation" });
  insertMission({ id: "mission-b", name: "Other Operation" });
  insertTelemetry({ missionId: "mission-a", timestamp: 1_000 });
  insertTelemetry({ missionId: "mission-a", timestamp: 2_000, x: 3, y: 4 });
  insertTelemetry({ missionId: "mission-b", timestamp: 3_000, x: 100, y: 100 });

  const originalNow = Date.now;
  let nowCallCount = 0;
  Date.now = () => {
    nowCallCount++;
    return 25_000;
  };

  try {
    const response = invokeAnalyticsRoute("mission-a");
    const body = response.body;

    assert.equal(response.statusCode, 200);
    assert.equal(body.generatedAt, 25_000);
    assert.equal(body.mission.id, "mission-a");
    assert.equal(body.mission.name, "Alpha Operation");
    assert.deepEqual(body.soldiers.map((item) => item.soldierId), ["A1"]);
    assert.equal(body.soldiers[0].distanceMeters, 5);
    assert.equal(nowCallCount, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("returns 404 for an unknown mission", () => {
  const response = invokeAnalyticsRoute("missing");
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Mission not found" });
});

test("uses asOf for active mission analytics", () => {
  insertMission({ id: "active-mission", startedAt: 1_000 });
  insertTelemetry({ missionId: "active-mission", timestamp: 1_000 });

  const originalNow = Date.now;
  Date.now = () => 25_000;
  try {
    const response = invokeAnalyticsRoute("active-mission");
    const body = response.body;
    assert.equal(response.statusCode, 200);
    assert.equal(body.generatedAt, 25_000);
    assert.equal(body.soldiers[0].longestSignalLostMs, 14_000);
  } finally {
    Date.now = originalNow;
  }
});

test("uses endedAt as the analytics boundary for completed missions", () => {
  insertMission({ id: "completed-mission", startedAt: 1_000, endedAt: 18_000, status: "completed" });
  insertTelemetry({ missionId: "completed-mission", timestamp: 1_000 });

  const originalNow = Date.now;
  Date.now = () => 25_000;
  try {
    const response = invokeAnalyticsRoute("completed-mission");
    const body = response.body;
    assert.equal(response.statusCode, 200);
    assert.equal(body.generatedAt, 25_000);
    assert.equal(body.soldiers[0].longestSignalLostMs, 7_000);
    assert.equal(body.soldiers[0].signalLostIntervals[0].endedAt, 18_000);
  } finally {
    Date.now = originalNow;
  }
});
