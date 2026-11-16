import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, runMigrations } from "../src/db.js";
import { createIsolatedTestSchema } from "./helpers/postgres.js";

test("PostgreSQL pool connects to the isolated test database", async (t) => {
  const isolated = await createIsolatedTestSchema("pool_test", "");
  t.after(() => isolated.close());
  const { rows: [row] } = await isolated.pool.query("SELECT current_database() AS database, current_schema() AS schema");
  assert.equal(row.database, "hit_tracker_test");
  assert.match(row.schema, /^pool_test_/);

  assert.throws(() => createDatabase({ connectionString: "" }), /DATABASE_URL must be configured/);
});

test("migrations are applied once and track every SQL migration", async (t) => {
  const isolated = await createIsolatedTestSchema("migration_test", "");
  t.after(() => isolated.close());
  await runMigrations(isolated.pool);
  const first = await isolated.pool.query("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(first.rows.map((row) => row.version), [
    "001_initial_postgresql.sql",
    "002_alert_resolution.sql",
    "003_calibration_actor.sql",
    "004_active_mission_index.sql",
  ]);
  await runMigrations(isolated.pool);
  const second = await isolated.pool.query("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(second.rows, first.rows);
});

test("migrated schema enforces foreign keys and checks and contains operational indexes", async (t) => {
  const isolated = await createIsolatedTestSchema("constraints_test", "");
  t.after(() => isolated.close());
  await runMigrations(isolated.pool);
  const db = isolated.pool;
  await db.query("INSERT INTO missions(id,name,started_at,status) VALUES('m1','Mission',now(),'active')");
  await db.query("INSERT INTO teams(id,name) VALUES('Alpha','Alpha')");
  await db.query("INSERT INTO soldiers(id,name) VALUES('A1','Soldier')");

  await assert.rejects(
    db.query(`INSERT INTO telemetry(mission_id,soldier_id,team_id,seq,timestamp,x,y,pressure_hpa,battery_pct,signal_strength)
      VALUES('missing','A1','Alpha',1,now(),0,0,1000,50,-50)`),
    (error) => error.code === "23503",
  );
  await assert.rejects(
    db.query(`INSERT INTO telemetry(mission_id,soldier_id,team_id,seq,timestamp,x,y,pressure_hpa,battery_pct,signal_strength)
      VALUES('m1','A1','Alpha',1,now(),0,0,1000,101,-50)`),
    (error) => error.code === "23514",
  );

  const { rows } = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema()");
  const names = new Set(rows.map((row) => row.indexname));
  for (const expected of [
    "telemetry_mission_soldier_time_idx",
    "telemetry_mission_time_idx",
    "mission_soldiers_team_idx",
    "missions_active_started_idx",
    "alerts_unresolved_time_idx",
  ]) assert.ok(names.has(expected), `expected index ${expected}`);
});
