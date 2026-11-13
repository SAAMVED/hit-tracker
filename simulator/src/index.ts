/**
 * HIT-Tracker Simulator
 *
 * Connects to the server's ingest WebSocket endpoint and sends
 * telemetry packets for 16 soldiers at 1 Hz.
 *
 * Usage:
 *   SERVER_URL=ws://localhost:3000 tsx src/index.ts
 */

import { WebSocket } from "ws";
import { SOLDIERS } from "./soldiers.js";
import { initialState, tick } from "./state.js";

const SERVER_URL = process.env.SERVER_URL ?? "ws://localhost:3000";
const INGEST_URL = `${SERVER_URL}/ws/ingest`;
const TICK_MS = parseInt(process.env.TICK_MS ?? "1000", 10);

const states = SOLDIERS.map(initialState);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

function connect() {
  console.log(`[simulator] Connecting to ${INGEST_URL}`);
  ws = new WebSocket(INGEST_URL);

  ws.on("open", () => {
    console.log(`[simulator] Connected. Sending telemetry for ${states.length} soldiers at ${TICK_MS}ms intervals.`);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    tickInterval = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      for (const state of states) {
        const packet = tick(state);
        ws.send(JSON.stringify({ type: "telemetry", payload: packet }));
      }
    }, TICK_MS);
  });

  ws.on("close", () => {
    console.warn("[simulator] Connection closed – reconnecting in 3s…");
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    reconnectTimer = setTimeout(connect, 3_000);
  });

  ws.on("error", (err) => {
    console.error("[simulator] WebSocket error:", err.message);
  });
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[simulator] Shutting down…");
  if (tickInterval) clearInterval(tickInterval);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  process.exit(0);
});

connect();
