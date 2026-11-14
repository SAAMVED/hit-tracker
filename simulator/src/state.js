import {
  FLOOR_HEIGHT_M,
  SEA_LEVEL_HPA,
  altitudeToPressure,
} from "@hit-tracker/shared";

/** Minimum and maximum allowable floor indices in the simulation */
const MIN_FLOOR = -2; // B2
const MAX_FLOOR = 5;  // Floor 5

/** Building footprint bounds in metres */
const BUILDING_BOUNDS = {
  minX: 2.0,
  maxX: 28.0,
  minY: 2.0,
  maxY: 18.0,
};

/** Central stairwell location on the building grid (metres) */
const STAIRWELL_LOCATION = { x: 15.0, y: 10.0 };

export function initialState(def) {
  const startAltitudeM = def.startFloor * FLOOR_HEIGHT_M;

  // Demo alert: Soldier B2 starts with a lower battery (23%) to demonstrate LOW BATTERY alert
  const initialBattery =
    def.id === "B2" ? 23 : 85 + Math.floor(Math.random() * 15);

  const state = {
    def,
    x: def.startX,
    y: def.startY,
    altitudeM: startAltitudeM,
    floor: def.startFloor,
    stairTransition: null,
    seq: 0,
    battery: initialBattery,
    accelMagnitude: 1.0,
  };

  // Demo alert: Soldier D4 will drop packets for 15s to demonstrate SIGNAL LOST alert
  if (def.id === "D4") {
    state.nextCommLossMs = Date.now() + 15_000; // First drop after 15s
  }

  // Demo: Scripted man-down for Soldier C2 if SIM_MANDOWN=1
  if (process.env.SIM_MANDOWN === "1" && def.id === "C2") {
    state.manDownScriptedAt = Date.now() + 10_000; // Trigger after 10s of simulation
    state.manDownActive = false;
  }

  // Demo: Occasional spoof packet injection for Soldier A4 if SIM_SPOOF=1
  if (process.env.SIM_SPOOF === "1" && def.id === "A4") {
    state.nextSpoofAt = Date.now() + 8_000;
    state.spoofType = 0;
  }

  return state;
}

/** Random walk bounded inside building footprint */
function randomWalk(value, min, max, step = 0.5) {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.max(min, Math.min(max, value + delta));
}

/** Move coordinate smoothly towards a target point */
function moveTowards(current, target, maxStep) {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Advance the soldier's simulation state by 1 second (1 Hz tick).
 * Returns null if the soldier is experiencing temporary signal/comm loss (for demo).
 */
export function tick(state, dtSec = 1.0, nowMs = Date.now(), driftHpa = 0) {
  // ── Demo Alert: Signal Drop for Soldier D4 ──────────────────────────────────
  if (state.def.id === "D4") {
    if (state.commLossUntilMs && nowMs < state.commLossUntilMs) {
      // In silence period: do not send packet (triggers SIGNAL LOST alert after 10s)
      return null;
    } else if (state.commLossUntilMs && nowMs >= state.commLossUntilMs) {
      // Silence period ended: schedule next comm drop in 45s
      state.commLossUntilMs = undefined;
      state.nextCommLossMs = nowMs + 45_000;
    } else if (state.nextCommLossMs && nowMs >= state.nextCommLossMs) {
      // Begin 15-second comm drop
      state.commLossUntilMs = nowMs + 15_000;
      return null;
    }
  }

  // ── Movement & Stair Navigation ────────────────────────────────────
  const isManDownScripted = state.manDownScriptedAt && nowMs >= state.manDownScriptedAt;

  if (isManDownScripted) {
    if (!state.manDownActive) {
      state.manDownActive = true;
      state.accelMagnitude = 3.6; // Impact / fall spike before stillness
      console.log(`[simulator] Soldier ${state.def.id} entered MAN DOWN (fall impact spike: 3.6g)`);
    } else {
      state.accelMagnitude = 1.000; // Zero variance stillness
    }
    // Cancel any stair transition and hold position frozen
    state.stairTransition = null;
  } else if (state.stairTransition) {
    const trans = state.stairTransition;
    const verticalStep = trans.climbSpeedMPerSec * dtSec;
    const diff = trans.targetAltitudeM - state.altitudeM;

    // Soldier converges to and stays within stairwell position while changing floors
    state.x = moveTowards(state.x, STAIRWELL_LOCATION.x, 0.6);
    state.y = moveTowards(state.y, STAIRWELL_LOCATION.y, 0.6);
    state.accelMagnitude = 1.25 + (Math.random() - 0.5) * 0.2;

    if (Math.abs(diff) <= verticalStep) {
      // Reached destination landing
      state.altitudeM = trans.targetAltitudeM;
      state.floor = trans.toFloor;
      state.stairTransition = null;
    } else {
      // Ascending or descending the stairwell
      state.altitudeM += Math.sign(diff) * verticalStep;
      state.floor = Math.round(state.altitudeM / FLOOR_HEIGHT_M);
    }
  } else {
    // Normal room patrol inside building footprint
    state.x = randomWalk(state.x, BUILDING_BOUNDS.minX, BUILDING_BOUNDS.maxX, 0.5);
    state.y = randomWalk(state.y, BUILDING_BOUNDS.minY, BUILDING_BOUNDS.maxY, 0.5);
    state.accelMagnitude = 1.0 + (Math.random() - 0.5) * 0.12;

    // Keep altitude anchored to the floor level
    const nominalFloorAltitude = state.floor * FLOOR_HEIGHT_M;
    state.altitudeM = nominalFloorAltitude + (Math.random() - 0.5) * 0.04;

    // Occasionally initiate a stairwell transition (~3% probability per tick)
    if (Math.random() < 0.03) {
      const canGoUp = state.floor < MAX_FLOOR;
      const canGoDown = state.floor > MIN_FLOOR;

      let direction = 0;
      if (canGoUp && canGoDown) {
        direction = Math.random() < 0.5 ? 1 : -1;
      } else if (canGoUp) {
        direction = 1;
      } else if (canGoDown) {
        direction = -1;
      }

      if (direction !== 0) {
        const toFloor = state.floor + direction;
        state.stairTransition = {
          fromFloor: state.floor,
          toFloor,
          startAltitudeM: state.altitudeM,
          targetAltitudeM: toFloor * FLOOR_HEIGHT_M,
          // Realistic stair climbing speed: 0.7 - 1.1 m/s (takes 3-5 seconds for 3.5m)
          climbSpeedMPerSec: 0.7 + Math.random() * 0.4,
        };
      }
    }
  }

  // ── Battery Simulation ─────────────────────────────────────────────────────
  if (state.def.id === "B2") {
    // Soldier B2 drains quickly to trigger LOW BATTERY alert (< 20%)
    state.battery = Math.max(5, state.battery - 0.3 * dtSec);
  } else {
    // Normal slow battery drain
    state.battery = Math.max(0, state.battery - Math.random() * 0.05 * dtSec);
  }

  // ── Pressure Generation from Altitude ──────────────────────────────────────
  // Use inverse hypsometric formula + small sensor noise (±0.06 hPa) + optional ambient drift
  const sensorNoiseHpa = (Math.random() - 0.5) * 0.08;
  const theoreticalPressure = altitudeToPressure(state.altitudeM, SEA_LEVEL_HPA);
  const pressureHpa = theoreticalPressure + sensorNoiseHpa + driftHpa;

  const packet = {
    soldierId: state.def.id,
    teamId: state.def.teamId,
    seq: state.seq++,
    timestamp: nowMs,
    x: Math.round(state.x * 100) / 100,
    y: Math.round(state.y * 100) / 100,
    pressureHpa: Math.round(pressureHpa * 100) / 100,
    batteryPct: Math.round(state.battery),
    signal: -55 - Math.floor(Math.random() * 40),
    altitude: Math.round(state.altitudeM * 100) / 100,
    accelMagnitude: Math.round((state.accelMagnitude ?? 1.0) * 1000) / 1000,
  };

  // ── Demo Alert: Inject occasional spoof packet for Soldier A4 (SIM_SPOOF=1) ──
  if (state.nextSpoofAt && nowMs >= state.nextSpoofAt) {
    state.nextSpoofAt = nowMs + 12_000;
    const spoofType = (state.spoofType ?? 0) % 5;
    state.spoofType = (state.spoofType ?? 0) + 1;

    switch (spoofType) {
      case 0:
        // Impossible horizontal jump (> 10 m/s)
        packet.x += 35.0;
        console.log(`[simulator] INJECTED SPOOF: impossible horizontal speed for ${state.def.id}`);
        break;
      case 1:
        // Out-of-order timestamp
        packet.timestamp = nowMs - 8_000;
        console.log(`[simulator] INJECTED SPOOF: out-of-order timestamp for ${state.def.id}`);
        break;
      case 2:
        // Non-increasing sequence number
        packet.seq = Math.max(0, state.seq - 2);
        console.log(`[simulator] INJECTED SPOOF: duplicate sequence number for ${state.def.id}`);
        break;
      case 3:
        // Impossible vertical / altitude jump
        packet.altitude += 18.0;
        packet.pressureHpa -= 2.2;
        console.log(`[simulator] INJECTED SPOOF: impossible altitude jump for ${state.def.id}`);
        break;
      case 4:
        // Out-of-range sensor reading
        packet.batteryPct = 140;
        console.log(`[simulator] INJECTED SPOOF: out-of-range battery percentage for ${state.def.id}`);
        break;
    }
  }

  return packet;
}
