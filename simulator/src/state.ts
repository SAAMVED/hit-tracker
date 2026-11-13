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

/** Stairwell location on the building grid (metres) */
const STAIRWELL_LOCATION = { x: 15, y: 15 };

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
}

export function initialState(def: SoldierDef): SoldierState {
  const startAltitudeM = def.startFloor * FLOOR_HEIGHT_M;
  return {
    def,
    x: def.startX,
    y: def.startY,
    altitudeM: startAltitudeM,
    floor: def.startFloor,
    stairTransition: null,
    seq: 0,
    battery: 85 + Math.floor(Math.random() * 15),
  };
}

/** Random walk with bounded step */
function randomWalk(value: number, step = 0.5, min = 0, max = 30): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.max(min, Math.min(max, value + delta));
}

/**
 * Move coordinate smoothly towards a target point.
 */
function moveTowards(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Advance the soldier's simulation state by 1 second (1 Hz tick).
 * Realistic stairwell transitions move altitude gradually across several ticks.
 */
export function tick(state: SoldierState, dtSec = 1.0): TelemetryPacket {
  if (state.stairTransition) {
    // ── Active Stairwell Transition ──────────────────────────────────────────
    const trans = state.stairTransition;
    const verticalStep = trans.climbSpeedMPerSec * dtSec;
    const diff = trans.targetAltitudeM - state.altitudeM;

    // Soldier moves towards the stairwell area while on stairs
    state.x = moveTowards(state.x, STAIRWELL_LOCATION.x, 0.4);
    state.y = moveTowards(state.y, STAIRWELL_LOCATION.y, 0.4);

    if (Math.abs(diff) <= verticalStep) {
      // Reached landing / target floor
      state.altitudeM = trans.targetAltitudeM;
      state.floor = trans.toFloor;
      state.stairTransition = null;
    } else {
      // Climbing or descending the stairs
      state.altitudeM += Math.sign(diff) * verticalStep;
      // Update nominal floor to the closest one while climbing
      state.floor = Math.round(state.altitudeM / FLOOR_HEIGHT_M);
    }
  } else {
    // ── Normal Patrol on Current Floor ───────────────────────────────────────
    state.x = randomWalk(state.x, 0.5, 0, 30);
    state.y = randomWalk(state.y, 0.5, 0, 30);

    // Keep altitude anchored to the current floor with minor standing variations
    const nominalFloorAltitude = state.floor * FLOOR_HEIGHT_M;
    state.altitudeM = nominalFloorAltitude + (Math.random() - 0.5) * 0.05;

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
          // Realistic stair climbing speed: 0.7 - 1.1 m/s (takes 3-5s for 3.5m floor)
          climbSpeedMPerSec: 0.7 + Math.random() * 0.4,
        };
      }
    }
  }

  // Drain battery slowly (0–0.05% per tick)
  state.battery = Math.max(0, state.battery - Math.random() * 0.05);

  // Generate barometric pressure from physical altitude using inverse hypsometric formula
  // Add small sensor noise (±0.06 hPa ≈ ±0.5 m sensor accuracy)
  const sensorNoiseHpa = (Math.random() - 0.5) * 0.08;
  const theoreticalPressure = altitudeToPressure(state.altitudeM, SEA_LEVEL_HPA);
  const pressureHpa = theoreticalPressure + sensorNoiseHpa;

  const packet: TelemetryPacket = {
    soldierId: state.def.id,
    teamId: state.def.teamId,
    seq: state.seq++,
    timestamp: Date.now(),
    x: Math.round(state.x * 100) / 100,
    y: Math.round(state.y * 100) / 100,
    pressureHpa: Math.round(pressureHpa * 100) / 100,
    batteryPct: Math.round(state.battery),
    signal: -55 - Math.floor(Math.random() * 40), // -55 to -95 dBm
  };

  return packet;
}
