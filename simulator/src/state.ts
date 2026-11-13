import { floorToPressure, SEA_LEVEL_HPA } from "@hit-tracker/shared";
import type { TelemetryPacket } from "@hit-tracker/shared";
import type { SoldierDef } from "./soldiers.js";

/** Mutable runtime state for one soldier */
export interface SoldierState {
  def: SoldierDef;
  x: number;
  y: number;
  floor: number;
  seq: number;
  battery: number;
}

export function initialState(def: SoldierDef): SoldierState {
  return {
    def,
    x: def.startX,
    y: def.startY,
    floor: def.startFloor,
    seq: 0,
    battery: 85 + Math.floor(Math.random() * 15),
  };
}

/** Random walk with ±0.5 m/step, bounded to [0, 30] */
function randomWalk(value: number, step = 0.5, min = 0, max = 30): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.max(min, Math.min(max, value + delta));
}

/** Build the next telemetry packet and advance state in-place */
export function tick(state: SoldierState): TelemetryPacket {
  state.x = randomWalk(state.x);
  state.y = randomWalk(state.y);

  // Occasionally change floor (1% chance per tick)
  if (Math.random() < 0.01) {
    state.floor = Math.max(-2, Math.min(4, state.floor + (Math.random() < 0.5 ? 1 : -1)));
  }

  // Drain battery slowly (0–0.05% per tick)
  state.battery = Math.max(0, state.battery - Math.random() * 0.05);

  const pressureHpa =
    floorToPressure(state.floor, SEA_LEVEL_HPA) +
    (Math.random() - 0.5) * 0.2; // ±0.1 hPa noise

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
