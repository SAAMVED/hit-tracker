import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { loginHandler } from "./auth.js";
import type { Database } from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: Database) {
  const app = express();

  // ── Middleware ───────────────────────────────────────────────────────────────
  app.use(express.json());

  // Static samples (e.g. procedural GLB model)
  app.use("/samples", express.static(path.resolve(__dirname, "../samples")));

  // Basic CORS for local dev (client on :5173, server on :3000)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // ── Routes ───────────────────────────────────────────────────────────────────

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      version: "0.1.0",
    });
  });

  app.post("/api/login", (req: Request, res: Response) => {
    loginHandler(req, res, db);
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
