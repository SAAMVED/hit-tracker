import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loginHandler, verifyToken } from "./auth.js";
import { CalibrationSchema, calculateMissionAnalytics } from "@hit-tracker/shared";
import { alertsEngine } from "./alerts-state.js";
import { acknowledgePersistedAlert, resolvePersistedAlert } from "./alert-store.js";
import { getCalibrationResponse, setCurrentCalibration } from "./calibration-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();

  // ── Middleware ───────────────────────────────────────────────────────────────
  app.use(express.json({ limit: "50mb" }));

  // Static samples (e.g. procedural GLB model)
  app.use("/samples", express.static(path.resolve(__dirname, "../samples")));

  // Basic CORS for local dev (client on :5173, server on :3000)
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // ── Auth Middleware ─────────────────────────────────────────────────────────

  function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Missing authorization header" });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  function requireCommander(req, res, next) {
    if (!req.user || req.user.role !== "commander") {
      return res.status(403).json({ error: "Forbidden: Commander role required" });
    }
    next();
  }
  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  // ── Routes ───────────────────────────────────────────────────────────────────

  const alertRoute = (handler) => (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    console.error("[api] Alert persistence error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  });

  app.post("/api/alerts/:id/acknowledge", authenticate, alertRoute(async (req, res) => {
    const at = Date.now();
    const alert = await acknowledgePersistedAlert(db, req.params.id, req.user.role, at);
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    alertsEngine.acknowledgeAlert(req.params.id, req.user.role, at);
    res.json(alert);
  }));

  app.delete("/api/alerts/:id", authenticate, alertRoute(async (req, res) => {
    const resolved = await resolvePersistedAlert(db, req.params.id, req.user.role);
    if (!resolved) return res.status(404).json({ error: "Alert not found" });
    alertsEngine.clearAlert(req.params.id);
    res.json({ ok: true, id: req.params.id });
  }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      version: "0.1.0",
    });
  });

  app.post("/api/login", asyncRoute(async (req, res) => {
    await loginHandler(req, res, db);
  }));

  // ── Model Calibration ───────────────────────────────────────────────────────

  app.get("/api/calibration", authenticate, asyncRoute(async (_req, res) => {
    res.json(getCalibrationResponse());
  }));

  app.post("/api/calibration", authenticate, requireCommander, asyncRoute(async (req, res) => {
    const parsed = CalibrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid calibration data", details: parsed.error.flatten() });
    }

    const { translation, rotation, scale } = parsed.data;
    const now = Date.now();

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO calibration
          (id,translation_x,translation_y,translation_z,rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z,updated_at,calibrated_by)
        VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10/1000.0),$11)
        ON CONFLICT(id) DO UPDATE SET
          translation_x=excluded.translation_x,translation_y=excluded.translation_y,translation_z=excluded.translation_z,
          rotation_x=excluded.rotation_x,rotation_y=excluded.rotation_y,rotation_z=excluded.rotation_z,
          scale_x=excluded.scale_x,scale_y=excluded.scale_y,scale_z=excluded.scale_z,
          updated_at=excluded.updated_at,calibrated_by=excluded.calibrated_by
      `, [
        translation.x, translation.y, translation.z,
        rotation.x, rotation.y, rotation.z,
        scale.x, scale.y, scale.z,
        now, req.user.sub,
      ]);
      await client.query(`
        INSERT INTO calibration_history
          (calibration_id,translation_x,translation_y,translation_z,rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z,changed_at,changed_by)
        VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10/1000.0),$11)
      `, [
        translation.x, translation.y, translation.z,
        rotation.x, rotation.y, rotation.z,
        scale.x, scale.y, scale.z,
        now, req.user.sub,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    setCurrentCalibration({ translation, rotation, scale }, now);
    res.json({ translation, rotation, scale, updatedAt: now });
  }));

  // ── Model Upload (Commander Only) ──────────────────────────────────────────

  app.post("/api/model/upload", authenticate, requireCommander, (req, res) => {
    const { filename, fileBase64 } = req.body || {};
    if (!fileBase64) {
      return res.status(400).json({ error: "Missing fileBase64 in request body" });
    }

    const targetDir = path.resolve(__dirname, "../samples");
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, filename || "custom-building.glb");

    try {
      const buffer = Buffer.from(fileBase64, "base64");
      fs.writeFileSync(targetFile, buffer);
      res.json({ ok: true, url: `/samples/${path.basename(targetFile)}` });
    } catch (err) {
      console.error("[model-upload] Failed to write model file:", err);
      res.status(500).json({ error: "Failed to save model" });
    }
  });

  // ── Missions & Replay ───────────────────────────────────────────────────────

  const missionSummariesQuery = `
    SELECT m.id,m.name,(extract(epoch from m.started_at)*1000)::bigint AS "startedAt",
      (extract(epoch from m.ended_at)*1000)::bigint AS "endedAt",m.status,
      (extract(epoch from m.created_at)*1000)::bigint AS "createdAt",COUNT(t.id)::int AS "packetCount",
      (extract(epoch from MIN(t.timestamp))*1000)::bigint AS "minTs",
      (extract(epoch from MAX(t.timestamp))*1000)::bigint AS "maxTs"
    FROM missions m LEFT JOIN telemetry t ON t.mission_id=m.id
  `;
  const toMissionSummary = (row) => ({
    ...row,
    startedAt: Number(row.startedAt),
    endedAt: row.endedAt == null ? null : Number(row.endedAt),
    createdAt: Number(row.createdAt),
    packetCount: Number(row.packetCount),
    minTs: row.minTs == null ? null : Number(row.minTs),
    maxTs: row.maxTs == null ? null : Number(row.maxTs),
  });

  app.get("/api/missions", authenticate, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      ${missionSummariesQuery}
      GROUP BY m.id ORDER BY m.started_at DESC,m.id
    `);
    res.json(rows.map(toMissionSummary));
  }));

  app.get("/api/missions/:id", authenticate, asyncRoute(async (req, res) => {
    const { rows: [row] } = await db.query(`
      ${missionSummariesQuery} WHERE m.id=$1 GROUP BY m.id
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Mission not found" });
    res.json(toMissionSummary(row));
  }));

  app.post("/api/missions", authenticate, requireCommander, asyncRoute(async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Mission name is required" });
    }

    const now = Date.now();
    const id = `mission-${now}`;

    // End previous active mission
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE missions IN EXCLUSIVE MODE");
      await client.query("UPDATE missions SET status='completed',ended_at=to_timestamp($1/1000.0) WHERE status='active'", [now]);
      await client.query("INSERT INTO missions(id,name,started_at,status,created_at) VALUES($1,$2,to_timestamp($3/1000.0),'active',to_timestamp($3/1000.0))", [id,name.trim(),now]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ id, name: name.trim(), startedAt: now, status: "active" });
  }));

  app.post("/api/missions/:id/end", authenticate, requireCommander, asyncRoute(async (req, res) => {
    const { id } = req.params;
    const now = Date.now();
    const result = await db.query("UPDATE missions SET status='completed',ended_at=to_timestamp($1/1000.0) WHERE id=$2 RETURNING id", [now,id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Mission not found" });
    }
    res.json({ ok: true, id, endedAt: now });
  }));

  app.get("/api/missions/:id/analytics", authenticate, asyncRoute(async (req, res) => {
    const asOf = Date.now();
    const { rows: [row] } = await db.query(`
      SELECT id, name, (extract(epoch from started_at)*1000)::bigint as started_at, (extract(epoch from ended_at)*1000)::bigint as ended_at, status
      FROM missions
      WHERE id = $1
    `, [req.params.id]);

    if (!row) {
      return res.status(404).json({ error: "Mission not found" });
    }

    const { rows: telemetryRows } = await db.query(`
      SELECT soldier_id, team_id, (extract(epoch from timestamp)*1000)::bigint as ts, x, y, floor
      FROM telemetry
      WHERE mission_id = $1
      ORDER BY soldier_id ASC, timestamp ASC, id ASC
    `, [req.params.id]);

    const mission = {
      id: row.id,
      name: row.name,
      startedAt: Number(row.started_at),
      endedAt: row.ended_at == null ? null : Number(row.ended_at),
      status: row.status,
    };
    const telemetry = telemetryRows.map((telemetryRow) => ({
      soldierId: telemetryRow.soldier_id,
      teamId: telemetryRow.team_id,
      timestamp: Number(telemetryRow.ts),
      x: telemetryRow.x,
      y: telemetryRow.y,
      estimatedFloor: telemetryRow.floor,
    }));

    res.json(calculateMissionAnalytics({ mission, telemetry, asOf }));
  }));

  app.get("/api/missions/:id/telemetry", authenticate, asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { from, to, limit, soldierId } = req.query;

    const { rowCount: missionCount } = await db.query("SELECT 1 FROM missions WHERE id=$1", [id]);
    if (missionCount === 0) return res.status(404).json({ error: "Mission not found" });

    const timeBounds = {};
    for (const [key, value] of [["from", from], ["to", to]]) {
      if (value === undefined) continue;
      const milliseconds = Number(value);
      if (!Number.isFinite(milliseconds)) return res.status(400).json({ error: `Invalid ${key} timestamp` });
      timeBounds[key] = new Date(milliseconds);
    }
    if (timeBounds.from && timeBounds.to && timeBounds.from > timeBounds.to) {
      return res.status(400).json({ error: "from must not be later than to" });
    }
    let parsedLimit;
    if (limit !== undefined) {
      parsedLimit = Number(limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 0 || parsedLimit > 100000) {
        return res.status(400).json({ error: "Invalid limit" });
      }
    }

    let query = `SELECT soldier_id,team_id,seq,(extract(epoch from timestamp)*1000)::bigint AS ts,
      x,y,pressure_hpa,battery_pct,signal_strength AS signal,floor,altitude,
      sensor_metadata->>'accelMagnitude' AS accel_magnitude
      FROM telemetry WHERE mission_id=$1`;
    const params = [id];

    if (soldierId !== undefined) {
      if (typeof soldierId !== "string" || !soldierId) return res.status(400).json({ error: "Invalid soldierId" });
      params.push(soldierId);
      query += ` AND soldier_id=$${params.length}`;
    }

    if (timeBounds.from) {
      params.push(timeBounds.from);
      query += ` AND timestamp >= $${params.length}`;
    }
    if (timeBounds.to) {
      params.push(timeBounds.to);
      query += ` AND timestamp <= $${params.length}`;
    }
    query += " ORDER BY timestamp ASC,id ASC";
    if (parsedLimit !== undefined) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(parsedLimit);
    }

    const { rows } = await db.query(query, params);
    const packets = rows.map((r) => ({
      soldierId: r.soldier_id,
      teamId: r.team_id,
      seq: Number(r.seq),
      timestamp: Number(r.ts),
      x: r.x,
      y: r.y,
      pressureHpa: r.pressure_hpa,
      batteryPct: r.battery_pct,
      signal: r.signal,
      estimatedFloor: r.floor,
      altitude: r.altitude,
      accelMagnitude: r.accel_magnitude != null && Number.isFinite(Number(r.accel_magnitude))
        ? Number(r.accel_magnitude)
        : 1.0,
    }));

    res.json(packets);
  }));

  // ── Security Audit (Rejected Packets) ───────────────────────────────────────

  app.get("/api/audit/rejected", authenticate, requireCommander, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT id, soldier_id, reason, raw_payload, timestamp
      FROM rejected_packets
      ORDER BY timestamp DESC
      LIMIT 100
    `);

    const auditEntries = rows.map((r) => ({
      id: r.id,
      soldierId: r.soldier_id,
      reason: r.reason,
      rawPayload: r.raw_payload,
      timestamp: new Date(r.timestamp).getTime(),
    }));

    res.json(auditEntries);
  }));

  app.use((error, _req, res, _next) => {
    console.error("[api] Database/request error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
