/**
 * HIT-Tracker Simulator
 *
 * Connects to the server's ingest WebSocket endpoint and sends
 * telemetry packets for 16 soldiers at 1 Hz.
 *
 * Usage:
 *   SERVER_URL=ws://localhost:3000 node src/index.js
 */

import { WebSocket } from "ws";
import { SEA_LEVEL_HPA } from "@hit-tracker/shared";
import { SOLDIERS } from "./soldiers.js";
import { initialState, tick } from "./state.js";

const SERVER_URL = process.env.SERVER_URL ?? "ws://localhost:3000";
const INGEST_URL = `${SERVER_URL}/ws/ingest`;
const TICK_MS = parseInt(process.env.TICK_MS ?? "1000", 10);

const states = SOLDIERS.map(initialState);
const simStartMs = Date.now();

let ws = null;
let reconnectTimer = null;
let tickInterval = null;

function connect() {
  console.log(`[simulator] Connecting to ${INGEST_URL}`);
  ws = new WebSocket(INGEST_URL);

  ws.on("open", () => {
    console.log(`[simulator] Connected. Sending telemetry for ${states.length} soldiers at ${TICK_MS}ms intervals.`);
    if (process.env.SIM_MANDOWN === "1") {
      console.log("[simulator] SIM_MANDOWN=1 active: Soldier C2 will trigger man-down in 10s");
    }
    if (process.env.SIM_SPOOF === "1") {
      console.log("[simulator] SIM_SPOOF=1 active: Soldier A4 will inject invalid/spoofed packets every 12s");
    }
    if (process.env.SIM_DRIFT === "1") {
      console.log("[simulator] SIM_DRIFT=1 active: Injecting slow ambient weather drift into barometric readings");
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    tickInterval = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const nowMs = Date.now();

      // Ambient weather drift calculation: slow drift over time (a few hPa over the mission)
      let driftHpa = 0;
      if (process.env.SIM_DRIFT === "1") {
        const elapsedSec = (nowMs - simStartMs) / 1000;
        // Gradual drift: rises by ~0.8 hPa every 30 seconds (~2.4 hPa by 90s)
        driftHpa = (elapsedSec / 30) * 0.8;
      }

      // 1. Emit reference station feed from ICP at ground level
      const refNoise = (Math.random() - 0.5) * 0.04;
      const referencePressure = SEA_LEVEL_HPA + driftHpa + refNoise;
      ws.send(
        JSON.stringify({
          type: "reference_station",
          payload: {
            stationId: "ICP-BARO-1",
            pressureHpa: Math.round(referencePressure * 100) / 100,
            timestamp: nowMs,
            temperatureC: 15.0,
          },
        })
      );

      // 2. Emit telemetry for all 16 soldiers with identical ambient drift applied
      for (const state of states) {
        const packet = tick(state, TICK_MS / 1000, nowMs, driftHpa);
        if (packet) {
          ws.send(JSON.stringify({ type: "telemetry", payload: packet }));
        }
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
