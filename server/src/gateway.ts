import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type { Database } from "better-sqlite3";
import { IngestMessageSchema, TelemetryPacketSchema } from "@hit-tracker/shared";
import { verifyToken } from "./auth.js";

/** Dashboard client set – receives broadcast updates */
const dashboardClients = new Set<WebSocket>();

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
      storeTelemetry(db, pkt);
      broadcastToDashboard({ type: "telemetry", payload: pkt });
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

function storeTelemetry(db: Database, pkt: ReturnType<typeof TelemetryPacketSchema.parse>) {
  db.prepare(`
    INSERT INTO telemetry
      (soldier_id, team_id, seq, ts, x, y, pressure_hpa, battery_pct, signal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pkt.soldierId,
    pkt.teamId,
    pkt.seq,
    pkt.timestamp,
    pkt.x,
    pkt.y,
    pkt.pressureHpa,
    pkt.batteryPct,
    pkt.signal
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
