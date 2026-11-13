import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type { Database } from "better-sqlite3";
import {
  AlertsEngine,
  FloorEstimator,
  IngestMessageSchema,
  type FloorLabel,
  type TelemetryPacket,
} from "@hit-tracker/shared";
import { verifyToken } from "./auth.js";

/** Dashboard client set – receives broadcast updates */
const dashboardClients = new Set<WebSocket>();

/** Per-soldier barometric floor estimators with Kalman filtering and hysteresis */
const soldierEstimators = new Map<string, FloorEstimator>();

/** Centralized alerts engine */
const alertsEngine = new AlertsEngine();

/** Cache of the latest live state for each soldier to serve snapshots */
export interface SoldierLiveSnapshot {
  soldierId: string;
  teamId: string;
  x: number;
  y: number;
  altitude: number;
  estimatedFloor: FloorLabel;
  batteryPct: number;
  timestamp: number;
  signal?: number;
  seq?: number;
}
const latestSoldierStates = new Map<string, SoldierLiveSnapshot>();

/**
 * Retrieves or initializes a FloorEstimator for a soldier.
 * P0 reference pressure is taken from that soldier's very first reading.
 */
function getOrCreateEstimator(soldierId: string, initialPressureHpa: number): FloorEstimator {
  let estimator = soldierEstimators.get(soldierId);
  if (!estimator) {
    estimator = new FloorEstimator({
      p0Hpa: initialPressureHpa, // Requirement: P0 taken from that soldier's first reading
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 2000,
    });
    soldierEstimators.set(soldierId, estimator);
  }
  return estimator;
}

export function createWebSocketGateway(httpServer: Server, db: Database) {
  // ── Ingest gateway (devices / simulator → server) ─────────────────────────
  const ingestWss = new WebSocketServer({ noServer: true });

  // ── Dashboard gateway (server → commander UI) ─────────────────────────────
  const dashboardWss = new WebSocketServer({ noServer: true });

  // Route upgrade requests to the correct WSS based on path
  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "/";

    if (url.startsWith("/ws/ingest")) {
      ingestWss.handleUpgrade(req, socket, head, (ws) => {
        ingestWss.emit("connection", ws, req);
      });
    } else if (url.startsWith("/ws/dashboard")) {
      // Require JWT via ?token= query param
      const token = new URL(url, "http://localhost").searchParams.get("token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      try {
        verifyToken(token);
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      dashboardWss.handleUpgrade(req, socket, head, (ws) => {
        dashboardWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // ── Throughput Tracker ────────────────────────────────────────────────────
  let packetsProcessedThisSec = 0;

  // Log once per second throughput and connected dashboard clients
  setInterval(() => {
    console.log(
      `[gateway] Processed ${packetsProcessedThisSec} packets/s | Dashboard clients: ${dashboardClients.size}`
    );
    packetsProcessedThisSec = 0;

    // Scan for stale soldiers (> 10s without packets -> SIGNAL LOST)
    const now = Date.now();
    const staleAlerts = alertsEngine.checkStaleSoldiers(now);
    for (const alert of staleAlerts) {
      broadcastToDashboard({
        type: "alert",
        payload: alert,
      });
    }
  }, 1000);

  // ── Ingest connection handler ──────────────────────────────────────────────
  ingestWss.on("connection", (ws: WebSocket) => {
    console.log("[gateway] Simulator/device connected to /ws/ingest");

    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return;
      }

      // 1. Validate with the shared Zod schema
      const parsed = IngestMessageSchema.safeParse(raw);
      if (!parsed.success) return;

      packetsProcessedThisSec++;
      const pkt = parsed.data.payload;

      // 1. Run barometric floor estimation per soldier (P0 from first reading)
      const estimator = getOrCreateEstimator(pkt.soldierId, pkt.pressureHpa);
      const estimation = estimator.update(pkt.pressureHpa, pkt.timestamp);

      // Construct live soldier state
      const soldierState: SoldierLiveSnapshot = {
        soldierId: pkt.soldierId,
        teamId: pkt.teamId,
        x: pkt.x,
        y: pkt.y,
        altitude: Math.round(estimation.smoothedAltitude * 100) / 100,
        estimatedFloor: estimation.floor,
        batteryPct: pkt.batteryPct,
        timestamp: pkt.timestamp,
        signal: pkt.signal,
        seq: pkt.seq,
      };
      latestSoldierStates.set(pkt.soldierId, soldierState);

      // Store in SQLite
      pkt.estimatedFloor = estimation.floor;
      pkt.altitude = soldierState.altitude;
      storeTelemetry(db, pkt);

      // 2. Broadcast resulting soldier state as {"type":"telemetry", ...}
      // Provide both wrapped and top-level properties for versatile client consumption
      const telemetryMessage = {
        type: "telemetry",
        payload: soldierState,
        ...soldierState,
      };
      broadcastToDashboard(telemetryMessage);

      // Run alerts check (floor transition, low battery)
      const alerts = alertsEngine.processTelemetry(
        {
          soldierId: pkt.soldierId,
          teamId: pkt.teamId,
          batteryPct: pkt.batteryPct,
          lastSeenAt: pkt.timestamp,
          floor: estimation.floor,
        },
        pkt.timestamp
      );
      for (const alert of alerts) {
        broadcastToDashboard({
          type: "alert",
          payload: alert,
        });
      }
    });

    ws.on("close", () => console.log("[gateway] Simulator/device disconnected from /ws/ingest"));
    ws.on("error", (e) => console.error("[gateway] Ingest error", e));
  });

  // ── Dashboard connection handler ───────────────────────────────────────────
  dashboardWss.on("connection", (ws: WebSocket) => {
    console.log(`[gateway] Dashboard client connected (${dashboardClients.size + 1} active)`);
    dashboardClients.add(ws);

    // Send {"type":"connected"} immediately upon connection
    safeSend(ws, {
      type: "connected",
      serverTime: Date.now(),
    });

    // 3. Send a {"type":"snapshot"} with all known soldiers when a dashboard client connects
    const allSoldiers = Array.from(latestSoldierStates.values());
    safeSend(ws, {
      type: "snapshot",
      payload: allSoldiers,
      soldiers: allSoldiers,
    });

    // Also send currently active alerts to the new dashboard
    for (const alert of alertsEngine.getActiveAlerts()) {
      safeSend(ws, {
        type: "alert",
        payload: alert,
      });
    }

    ws.on("close", () => {
      dashboardClients.delete(ws);
      console.log(`[gateway] Dashboard client disconnected (${dashboardClients.size} active)`);
    });
    ws.on("error", (e) => {
      console.error("[gateway] Dashboard error", e);
      dashboardClients.delete(ws);
    });
  });

  // ── Ping heartbeat every 30 s ─────────────────────────────────────────────
  setInterval(() => {
    broadcastToDashboard({ type: "ping", payload: { serverTime: Date.now() } });
  }, 30_000);

  console.log("[gateway] WebSocket gateway ready (ingest: /ws/ingest, dashboard: /ws/dashboard)");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function storeTelemetry(db: Database, pkt: TelemetryPacket) {
  try {
    db.prepare(`
      INSERT INTO telemetry
        (soldier_id, team_id, seq, ts, x, y, pressure_hpa, battery_pct, signal, floor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pkt.soldierId,
      pkt.teamId,
      pkt.seq,
      pkt.timestamp,
      pkt.x,
      pkt.y,
      pkt.pressureHpa,
      pkt.batteryPct,
      pkt.signal,
      pkt.estimatedFloor ?? null
    );
  } catch (err) {
    console.error("[gateway] SQLite insert error:", err);
  }
}

function broadcastToDashboard(msg: object) {
  const text = JSON.stringify(msg);
  for (const client of dashboardClients) {
    safeSend(client, msg, text);
  }
}

function safeSend(ws: WebSocket, msg: object, cached?: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(cached ?? JSON.stringify(msg));
  }
}
