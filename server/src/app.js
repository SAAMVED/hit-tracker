import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loginHandler, verifyToken } from "./auth.js";
import { CalibrationSchema } from "@hit-tracker/shared";

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

  // ── Routes ───────────────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      version: "0.1.0",
    });
  });

  app.post("/api/login", (req, res) => {
    loginHandler(req, res, db);
  });

  // ── Model Calibration ───────────────────────────────────────────────────────

  app.get("/api/calibration", (_req, res) => {
    const row = db.prepare("SELECT * FROM calibration WHERE id = 'default'").get();
    if (!row) {
      return res.json({
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    }
    res.json({
      translation: { x: row.translation_x, y: row.translation_y, z: row.translation_z },
      rotation: { x: row.rotation_x, y: row.rotation_y, z: row.rotation_z },
      scale: { x: row.scale_x, y: row.scale_y, z: row.scale_z },
      updatedAt: row.updated_at,
    });
  });

  app.post("/api/calibration", authenticate, requireCommander, (req, res) => {
    const parsed = CalibrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid calibration data", details: parsed.error.flatten() });
    }

    const { translation, rotation, scale } = parsed.data;
    const now = Date.now();

    db.prepare(`
      INSERT INTO calibration (id, translation_x, translation_y, translation_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, updated_at)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        translation_x=excluded.translation_x,
        translation_y=excluded.translation_y,
        translation_z=excluded.translation_z,
        rotation_x=excluded.rotation_x,
        rotation_y=excluded.rotation_y,
        rotation_z=excluded.rotation_z,
        scale_x=excluded.scale_x,
        scale_y=excluded.scale_y,
        scale_z=excluded.scale_z,
        updated_at=excluded.updated_at
    `).run(
      translation.x, translation.y, translation.z,
      rotation.x, rotation.y, rotation.z,
      scale.x, scale.y, scale.z,
      now
    );

    res.json({ translation, rotation, scale, updatedAt: now });
  });

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

  app.get("/api/missions", (_req, res) => {
    const rows = db.prepare(`
      SELECT m.id, m.name, m.started_at as startedAt, m.ended_at as endedAt, m.status, m.created_at as createdAt,
             COUNT(t.id) as packetCount,
             MIN(t.ts) as minTs,
             MAX(t.ts) as maxTs
      FROM missions m
      LEFT JOIN telemetry t ON t.mission_id = m.id
      GROUP BY m.id
      ORDER BY m.started_at DESC
    `).all();
    res.json(rows);
  });

  app.post("/api/missions", authenticate, requireCommander, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Mission name is required" });
    }

    const now = Date.now();
    const id = `mission-${now}`;

    // End previous active mission
    db.prepare("UPDATE missions SET status = 'completed', ended_at = ? WHERE status = 'active'").run(now);

    // Insert new mission
    db.prepare(`
      INSERT INTO missions (id, name, started_at, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, name.trim(), now, now);

    res.json({ id, name: name.trim(), startedAt: now, status: "active" });
  });

  app.post("/api/missions/:id/end", authenticate, requireCommander, (req, res) => {
    const { id } = req.params;
    const now = Date.now();
    const result = db.prepare("UPDATE missions SET status = 'completed', ended_at = ? WHERE id = ?").run(now, id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Mission not found" });
    }
    res.json({ ok: true, id, endedAt: now });
  });

  app.get("/api/missions/:id/telemetry", (req, res) => {
    const { id } = req.params;
    const { from, to, limit } = req.query;

    let query = "SELECT soldier_id, team_id, seq, ts, x, y, pressure_hpa, battery_pct, signal, floor, altitude, accel_magnitude FROM telemetry WHERE mission_id = ?";
    const params = [id];

    if (from) {
      query += " AND ts >= ?";
      params.push(Number(from));
    }
    if (to) {
      query += " AND ts <= ?";
      params.push(Number(to));
    }
    query += " ORDER BY ts ASC";
    if (limit) {
      query += " LIMIT ?";
      params.push(Number(limit));
    }

    const rows = db.prepare(query).all(...params);
    const packets = rows.map((r) => ({
      soldierId: r.soldier_id,
      teamId: r.team_id,
      seq: r.seq,
      timestamp: r.ts,
      x: r.x,
      y: r.y,
      pressureHpa: r.pressure_hpa,
      batteryPct: r.battery_pct,
      signal: r.signal,
      estimatedFloor: r.floor,
      altitude: r.altitude,
      accelMagnitude: r.accel_magnitude,
    }));

    res.json(packets);
  });

  // ── Security Audit (Rejected Packets) ───────────────────────────────────────

  app.get("/api/audit/rejected", authenticate, requireCommander, (_req, res) => {
    const rows = db.prepare(`
      SELECT id, soldier_id, reason, raw_payload, timestamp
      FROM rejected_packets
      ORDER BY timestamp DESC
      LIMIT 100
    `).all();

    const auditEntries = rows.map((r) => ({
      id: r.id,
      soldierId: r.soldier_id,
      reason: r.reason,
      rawPayload: r.raw_payload,
      timestamp: r.timestamp,
    }));

    res.json(auditEntries);
  });

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
