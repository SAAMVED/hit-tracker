import {
  FLOOR_HEIGHT_M,
  SEA_LEVEL_HPA,
  altitudeToPressure,
  type TelemetryPacket,
} from "@hit-tracker/shared";
import type { SoldierDef } from "./soldiers.js";

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

/** Stair transition state during vertical movement */
export interface StairTransition {
  fromFloor: number;
  toFloor: number;
  startAltitudeM: number;
  targetAltitudeM: number;
  /** Vertical climb speed in metres per second (realistic: 0.7 - 1.1 m/s) */
  climbSpeedMPerSec: number;
}

/** Mutable runtime state for one soldier */
export interface SoldierState {
  def: SoldierDef;
  x: number;
  y: number;
  /** Continuous altitude above ground in metres */
  altitudeM: number;
  /** Current integer floor (-2..5) */
  floor: number;
  /** Active stairwell transition, or null if patrolling */
  stairTransition: StairTransition | null;
  seq: number;
  battery: number;

  // Demo alert simulation state
  nextCommLossMs?: number;
  commLossUntilMs?: number;
}

export function initialState(def: SoldierDef): SoldierState {
  const startAltitudeM = def.startFloor * FLOOR_HEIGHT_M;

  // Demo alert: Soldier B2 starts with a lower battery (23%) to demonstrate LOW BATTERY alert
  const initialBattery =
    def.id === "B2" ? 23 : 85 + Math.floor(Math.random() * 15);

  const state: SoldierState = {
    def,
    x: def.startX,
    y: def.startY,
    altitudeM: startAltitudeM,
    floor: def.startFloor,
    stairTransition: null,
    seq: 0,
    battery: initialBattery,
  };

  // Demo alert: Soldier D4 will drop packets for 15s to demonstrate SIGNAL LOST alert
  if (def.id === "D4") {
    state.nextCommLossMs = Date.now() + 15_000; // First drop after 15s
  }

  return state;
}

/** Random walk bounded inside building footprint */
function randomWalk(value: number, min: number, max: number, step = 0.5): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.max(min, Math.min(max, value + delta));
}

/** Move coordinate smoothly towards a target point */
function moveTowards(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Advance the soldier's simulation state by 1 second (1 Hz tick).
 * Returns null if the soldier is experiencing temporary signal/comm loss (for demo).
 */
export function tick(state: SoldierState, dtSec = 1.0, nowMs = Date.now()): TelemetryPacket | null {
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

  // ── Movement & Stair Navigation ────────────────────────────────────────────
  if (state.stairTransition) {
    const trans = state.stairTransition;
    const verticalStep = trans.climbSpeedMPerSec * dtSec;
    const diff = trans.targetAltitudeM - state.altitudeM;

    // Soldier converges to and stays within stairwell position while changing floors
    state.x = moveTowards(state.x, STAIRWELL_LOCATION.x, 0.6);
    state.y = moveTowards(state.y, STAIRWELL_LOCATION.y, 0.6);

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
  // Use inverse hypsometric formula + small sensor noise (±0.06 hPa)
  const sensorNoiseHpa = (Math.random() - 0.5) * 0.08;
  const theoreticalPressure = altitudeToPressure(state.altitudeM, SEA_LEVEL_HPA);
  const pressureHpa = theoreticalPressure + sensorNoiseHpa;

  const packet: TelemetryPacket = {
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
  };

  return packet;
}
