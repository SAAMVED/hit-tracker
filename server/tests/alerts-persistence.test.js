import assert from "node:assert/strict";
import "dotenv/config";
import pg from "pg";
import { after, before, test } from "node:test";
import { AlertsEngine } from "@hit-tracker/shared";
import { acknowledgePersistedAlert, loadActiveAlerts, persistAlerts, resolvePersistedAlert } from "../src/alert-store.js";

const { Pool } = pg;
const configuredUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!configuredUrl) throw new Error("Configure TEST_DATABASE_URL or DATABASE_URL for PostgreSQL alert integration tests.");
const parsedUrl = new URL(configuredUrl);
if (!process.env.TEST_DATABASE_URL) parsedUrl.pathname = "/hit_tracker_test";
if (decodeURIComponent(parsedUrl.pathname.slice(1)) !== "hit_tracker_test") {
  throw new Error("Alert persistence integration tests are restricted to hit_tracker_test.");
}
const testUrl = parsedUrl.toString();
const schema = `alert_test_${process.pid}_${Date.now()}`;
let adminPool;
let testPool;

before(async () => {
  adminPool = new Pool({ connectionString: testUrl });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  testPool = new Pool({ connectionString: testUrl, options: `-c search_path=${schema}` });
  await testPool.query(`
    CREATE TABLE teams(id TEXT PRIMARY KEY);
    CREATE TABLE soldiers(id TEXT PRIMARY KEY);
    CREATE TABLE missions(id TEXT PRIMARY KEY);
    CREATE TABLE alerts(
      id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL,
      soldier_id TEXT NOT NULL REFERENCES soldiers(id), team_id TEXT NOT NULL REFERENCES teams(id),
      mission_id TEXT REFERENCES missions(id), message TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL,
      acknowledged BOOLEAN NOT NULL DEFAULT false, acknowledged_by TEXT, acknowledged_at TIMESTAMPTZ,
      resolved BOOLEAN NOT NULL DEFAULT false, resolved_by TEXT, resolved_at TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO teams(id) VALUES('Alpha');
    INSERT INTO soldiers(id) VALUES('A1');
    INSERT INTO missions(id) VALUES('mission-test');
  `);
});

after(async () => {
  await testPool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
});

const alertFixture = {
  id: "alert-test-1", type: "signal_lost", severity: "critical",
  soldierId: "A1", teamId: "Alpha", message: "[A1] Signal lost",
  timestamp: 1_800_000_000_000, acknowledged: false,
};

test("persists generated alerts and retrieves the same active alert payload", async () => {
  await persistAlerts(testPool, [alertFixture], "mission-test");
  await persistAlerts(testPool, [alertFixture], "mission-test");
  const alerts = await loadActiveAlerts(testPool);
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0], alertFixture);
});

test("acknowledges and resolves alerts durably", async () => {
  const at = alertFixture.timestamp + 250;
  const acknowledged = await acknowledgePersistedAlert(testPool, alertFixture.id, "commander", at);
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(acknowledged.acknowledgedBy, "commander");
  assert.equal(acknowledged.acknowledgedAt, at);
  assert.equal(await resolvePersistedAlert(testPool, alertFixture.id, "commander", at + 500), true);
  assert.deepEqual(await loadActiveAlerts(testPool), []);
});

test("restores unresolved acknowledged alerts into a fresh engine after restart", async () => {
  const id = "alert-test-restore";
  const alert = { ...alertFixture, id, timestamp: alertFixture.timestamp + 1000 };
  await persistAlerts(testPool, [alert], "mission-test");
  await acknowledgePersistedAlert(testPool, id, "viewer", alert.timestamp + 50);

  const freshEngine = new AlertsEngine();
  freshEngine.restoreActiveAlerts(await loadActiveAlerts(testPool));
  const restored = freshEngine.getActiveAlerts().find((entry) => entry.id === id);
  assert.equal(restored.acknowledged, true);
  assert.equal(restored.acknowledgedBy, "viewer");
  assert.equal(restored.timestamp, alert.timestamp);
});
