import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type { Database } from "better-sqlite3";
import {
  FloorEstimator,
  IngestMessageSchema,
  type TelemetryPacket,
} from "@hit-tracker/shared";
import { verifyToken } from "./auth.js";

/** Dashboard client set – receives broadcast updates */
const dashboardClients = new Set<WebSocket>();

/** Per-soldier barometric floor estimators with Kalman filtering and hysteresis */
const soldierEstimators = new Map<string, FloorEstimator>();

function getEstimatorForSoldier(soldierId: string): FloorEstimator {
  let estimator = soldierEstimators.get(soldierId);
  if (!estimator) {
    estimator = new FloorEstimator({
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

  // ── Ingest connection handler ──────────────────────────────────────────────
  ingestWss.on("connection", (ws: WebSocket) => {
    console.log("[gateway] Simulator/device connected");

    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return;
      }

      const parsed = IngestMessageSchema.safeParse(raw);
      if (!parsed.success) return;

      const pkt = parsed.data.payload;
      const estimator = getEstimatorForSoldier(pkt.soldierId);
      const estimation = estimator.update(pkt.pressureHpa, pkt.timestamp);

      // Attach estimated floor label to packet
      pkt.estimatedFloor = estimation.floor;

      storeTelemetry(db, pkt);

      // Broadcast telemetry to dashboard clients
      broadcastToDashboard({ type: "telemetry", payload: pkt });

      // Broadcast soldier state update with estimated floor
      broadcastToDashboard({
        type: "soldier_update",
        payload: {
          id: pkt.soldierId,
          name: pkt.soldierId,
          teamId: pkt.teamId,
          floor: estimation.floorNumber,
          floorLabel: estimation.floor,
          lastPacket: pkt,
          lastSeenAt: Date.now(),
          status: "active",
        },
      });
    });

    ws.on("close", () => console.log("[gateway] Simulator/device disconnected"));
    ws.on("error", (e) => console.error("[gateway] Ingest error", e));
  });

  // ── Dashboard connection handler ───────────────────────────────────────────
  dashboardWss.on("connection", (ws: WebSocket) => {
    console.log("[gateway] Dashboard client connected");
    dashboardClients.add(ws);

    // Send a ping immediately so the client knows it's alive
    safeSend(ws, { type: "ping", payload: { serverTime: Date.now() } });

    ws.on("close", () => {
      dashboardClients.delete(ws);
      console.log("[gateway] Dashboard client disconnected");
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
