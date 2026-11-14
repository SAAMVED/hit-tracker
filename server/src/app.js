import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { loginHandler } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();

  // ── Middleware ───────────────────────────────────────────────────────────────
  app.use(express.json());

  // Static samples (e.g. procedural GLB model)
  app.use("/samples", express.static(path.resolve(__dirname, "../samples")));

  // Basic CORS for local dev (client on :5173, server on :3000)
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

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

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
