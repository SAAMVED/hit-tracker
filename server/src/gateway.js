import { WebSocketServer, WebSocket } from "ws";
import { FloorEstimator, IngestMessageSchema, validatePacket, hypsometricAltitude } from "@hit-tracker/shared";
import { verifyToken } from "./auth.js";
import { alertsEngine } from "./alerts-state.js";
import { loadActiveAlerts, persistAlerts, resolvePersistedAlerts } from "./alert-store.js";

const dashboardClients = new Set();
const soldierEstimators = new Map();
const latestSoldierStates = new Map();
const lastValidPackets = new Map();
const soldierEntryReferencePressures = new Map();
let latestReferenceStation = { stationId: "ICP-BARO-1", pressureHpa: 1013.25, timestamp: Date.now() };
let initialReferencePressure = null;
let packetsProcessedThisSec = 0;
const pendingAlertWrites = [];
const pendingAlertResolutions = [];
let alertFlushPromise = Promise.resolve();

function getOrCreateEstimator(soldierId, initialPressureHpa) {
  let estimator = soldierEstimators.get(soldierId);
  if (!estimator) {
    estimator = new FloorEstimator({ p0Hpa: initialPressureHpa, floorHeightM: 3.5, thresholdBandM: 0.4, minDwellTimeMs: 2000 });
    soldierEstimators.set(soldierId, estimator);
  }
  return estimator;
}

export async function createWebSocketGateway(httpServer, db) {
  try {
    const { rows: [reading] } = await db.query(`SELECT station_id,pressure_hpa,temperature_c,timestamp
      FROM reference_readings ORDER BY timestamp DESC,id DESC LIMIT 1`);
    if (reading) {
      latestReferenceStation = {
        stationId: reading.station_id,
        pressureHpa: Number(reading.pressure_hpa),
        temperatureC: reading.temperature_c == null ? undefined : Number(reading.temperature_c),
        timestamp: new Date(reading.timestamp).getTime(),
      };
      initialReferencePressure = latestReferenceStation.pressureHpa;
    }
    alertsEngine.restoreActiveAlerts(await loadActiveAlerts(db));
  } catch (error) {
    throw new Error(`Unable to restore reference barometer state from PostgreSQL: ${error.message}`, { cause: error });
  }

  const ingestWss = new WebSocketServer({ noServer: true });
  const dashboardWss = new WebSocketServer({ noServer: true });
  const upgradeHandler = (req, socket, head) => {
    const url = req.url ?? "/";
    if (url.startsWith("/ws/ingest")) {
      ingestWss.handleUpgrade(req, socket, head, (ws) => ingestWss.emit("connection", ws, req));
      return;
    }
    if (url.startsWith("/ws/dashboard")) {
      const token = new URL(url, "http://localhost").searchParams.get("token");
      if (!token) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      try { verifyToken(token); } catch { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      dashboardWss.handleUpgrade(req, socket, head, (ws) => dashboardWss.emit("connection", ws, req));
      return;
    }
    socket.destroy();
  };
  httpServer.on("upgrade", upgradeHandler);

  ingestWss.on("connection", (ws) => {
    console.log("[gateway] Simulator/device connected to /ws/ingest");
    ws.on("message", (data) => {
      void handleIngestMessage(data, db).catch((error) => {
        console.error("[gateway] Failed to process WebSocket message:", error);
      });
    });
    ws.on("close", () => console.log("[gateway] Simulator/device disconnected from /ws/ingest"));
    ws.on("error", (error) => console.error("[gateway] Ingest error", error));
  });

  dashboardWss.on("connection", (ws) => {
    dashboardClients.add(ws);
    safeSend(ws, { type: "connected", serverTime: Date.now() });
    const soldiers = Array.from(latestSoldierStates.values());
    safeSend(ws, { type: "snapshot", payload: soldiers, soldiers });
    for (const alert of alertsEngine.getActiveAlerts()) safeSend(ws, { type: "alert", payload: alert });
    safeSend(ws, { type: "reference_station", payload: latestReferenceStation, pressureHpa: latestReferenceStation.pressureHpa, timestamp: latestReferenceStation.timestamp });
    ws.on("close", () => dashboardClients.delete(ws));
    ws.on("error", (error) => { console.error("[gateway] Dashboard error", error); dashboardClients.delete(ws); });
  });

  const throughputTimer = setInterval(() => {
    console.log(`[gateway] Processed ${packetsProcessedThisSec} packets/s | Dashboard clients: ${dashboardClients.size}`);
    packetsProcessedThisSec = 0;
    void handleStaleAlerts(db).catch((error) => console.error("[gateway] Failed to persist stale-soldier alerts:", error));
  }, 1000);
  const pingTimer = setInterval(() => broadcastToDashboard({ type: "ping", payload: { serverTime: Date.now() } }), 30_000);
  console.log("[gateway] WebSocket gateway ready (ingest: /ws/ingest, dashboard: /ws/dashboard)");
  return {
    close() {
      clearInterval(throughputTimer);
      clearInterval(pingTimer);
      httpServer.off("upgrade", upgradeHandler);
      for (const client of ingestWss.clients) client.close(1001, "Server shutting down");
      for (const client of dashboardWss.clients) client.close(1001, "Server shutting down");
      ingestWss.close();
      dashboardWss.close();
    },
  };
}

async function handleIngestMessage(data, db) {
  let raw;
  try { raw = JSON.parse(data.toString()); } catch { return; }
  const parsed = IngestMessageSchema.safeParse(raw);
  if (!parsed.success) return;

  if (parsed.data.type === "reference_station") {
    const packet = parsed.data.payload;
    await db.query(`INSERT INTO reference_readings(station_id,pressure_hpa,temperature_c,timestamp)
      VALUES($1,$2,$3,to_timestamp($4/1000.0))`, [packet.stationId,packet.pressureHpa,packet.temperatureC ?? null,packet.timestamp]);
    latestReferenceStation = packet;
    if (initialReferencePressure === null) initialReferencePressure = packet.pressureHpa;
    broadcastToDashboard({ type: "reference_station", payload: packet, pressureHpa: packet.pressureHpa, timestamp: packet.timestamp });
    return;
  }

  const packet = parsed.data.payload;
  const validation = validatePacket(lastValidPackets.get(packet.soldierId), packet);
  if (!validation.valid) {
    console.warn(`[gateway] Rejected packet from ${packet.soldierId}: ${validation.reason}`);
    await db.query(`INSERT INTO rejected_packets(soldier_id,reason,raw_payload,timestamp)
      VALUES($1,$2,$3::jsonb,to_timestamp($4/1000.0))`,
    [packet.soldierId || "UNKNOWN",validation.reason || "REJECTED",JSON.stringify(raw),packet.timestamp || Date.now()]);
    return;
  }

  const { rows: [mission] } = await db.query("SELECT id FROM missions WHERE status='active' ORDER BY started_at DESC LIMIT 1");
  if (!mission) throw new Error("No active mission exists; telemetry was not stored.");
  if (!soldierEntryReferencePressures.has(packet.soldierId)) {
    soldierEntryReferencePressures.set(packet.soldierId, latestReferenceStation?.pressureHpa ?? 1013.25);
  }
  const estimator = getOrCreateEstimator(packet.soldierId, packet.pressureHpa);
  const estimate = estimator.update(packet.pressureHpa, packet.timestamp, {
    referenceNow: latestReferenceStation?.pressureHpa ?? 1013.25,
    referenceAtEntry: soldierEntryReferencePressures.get(packet.soldierId),
  });
  const rawAltitude = hypsometricAltitude(packet.pressureHpa, estimator.p0Hpa, estimator.tempC);
  const soldierState = {
    soldierId: packet.soldierId, teamId: packet.teamId, x: packet.x, y: packet.y,
    altitude: Math.round(estimate.smoothedAltitude * 100) / 100,
    rawAltitude: Math.round(rawAltitude * 100) / 100,
    correctedAltitude: Math.round(estimate.smoothedAltitude * 100) / 100,
    estimatedFloor: estimate.floor, batteryPct: packet.batteryPct,
    timestamp: packet.timestamp, signal: packet.signal, seq: packet.seq,
    accelMagnitude: packet.accelMagnitude ?? 1.0,
  };
  const storedPacket = { ...packet, missionId: mission.id, estimatedFloor: estimate.floor, altitude: soldierState.altitude };
  await storeTelemetry(db, storedPacket);
  lastValidPackets.set(packet.soldierId, storedPacket);
  latestSoldierStates.set(packet.soldierId, soldierState);
  packetsProcessedThisSec++;
  broadcastToDashboard({ type: "telemetry", payload: soldierState, ...soldierState });
  const alerts = alertsEngine.processTelemetry({
    soldierId: packet.soldierId, teamId: packet.teamId, x: packet.x, y: packet.y,
    altitude: soldierState.altitude, accelMagnitude: packet.accelMagnitude ?? 1.0,
    batteryPct: packet.batteryPct, lastSeenAt: packet.timestamp, floor: estimate.floor,
  }, packet.timestamp);
  const resolvedIds = alertsEngine.drainResolvedAlertIds();
  pendingAlertResolutions.push(...resolvedIds);
  for (const alert of alerts) {
    pendingAlertWrites.push({ alert, missionId: mission.id });
    broadcastToDashboard({ type: "alert", payload: alert });
  }
  await flushAlertPersistence(db);
}

async function handleStaleAlerts(db) {
  const alerts = alertsEngine.checkStaleSoldiers(Date.now());
  if (alerts.length) {
    const { rows: [mission] } = await db.query("SELECT id FROM missions WHERE status='active' ORDER BY started_at DESC LIMIT 1");
    for (const alert of alerts) {
      pendingAlertWrites.push({ alert, missionId: mission?.id ?? null });
      broadcastToDashboard({ type: "alert", payload: alert });
    }
  }
  await flushAlertPersistence(db);
}

function flushAlertPersistence(db) {
  const flush = alertFlushPromise.then(() => flushPendingAlertPersistence(db));
  alertFlushPromise = flush.catch(() => {});
  return flush;
}

async function flushPendingAlertPersistence(db) {
  if (pendingAlertResolutions.length) {
    await resolvePersistedAlerts(db, pendingAlertResolutions, Date.now());
    pendingAlertResolutions.length = 0;
  }
  while (pendingAlertWrites.length) {
    const item = pendingAlertWrites[0];
    await persistAlerts(db, [item.alert], item.missionId);
    pendingAlertWrites.shift();
  }
}

async function storeTelemetry(db, packet) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO teams(id,name) VALUES($1,$1) ON CONFLICT(id) DO NOTHING", [packet.teamId]);
    await client.query("INSERT INTO soldiers(id,name) VALUES($1,$1) ON CONFLICT(id) DO NOTHING", [packet.soldierId]);
    await client.query(`INSERT INTO mission_soldiers(mission_id,soldier_id,team_id)
      VALUES($1,$2,$3) ON CONFLICT(mission_id,soldier_id) DO NOTHING`, [packet.missionId,packet.soldierId,packet.teamId]);
    await client.query(`INSERT INTO telemetry(mission_id,soldier_id,team_id,seq,timestamp,x,y,altitude,floor,
      pressure_hpa,battery_pct,signal_strength,sensor_metadata)
      VALUES($1,$2,$3,$4,to_timestamp($5/1000.0),$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [packet.missionId,packet.soldierId,packet.teamId,packet.seq,packet.timestamp,packet.x,packet.y,
      packet.altitude ?? null,packet.estimatedFloor ?? null,packet.pressureHpa,packet.batteryPct,packet.signal,
      JSON.stringify({ accelMagnitude: packet.accelMagnitude ?? 1.0 })]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[gateway] PostgreSQL telemetry transaction failed:", error);
    return false;
  } finally {
    client.release();
  }
}

function broadcastToDashboard(message) {
  const text = JSON.stringify(message);
  for (const client of dashboardClients) safeSend(client, message, text);
}

function safeSend(client, message, cached) {
  if (client.readyState === WebSocket.OPEN) client.send(cached ?? JSON.stringify(message));
}
