/**
 * Barometric floor estimation utilities.
 *
 * Uses the hypsometric approximation:
 *   Δh ≈ METRES_PER_HPA × (P_ref − P_measured)
 *
 * References:
 *   - WMO-No.8 (Guide to Instruments and Methods of Observation)
 *   - ISA standard atmosphere
 */

import { FLOOR_HEIGHT_M, METRES_PER_HPA, SEA_LEVEL_HPA } from "./schemas.js";

/**
 * Estimate the altitude above sea level (metres) from a pressure reading.
 *
 * @param pressureHpa  Current barometric pressure in hectopascals
 * @param refPressureHpa  Reference pressure at the building's ground floor
 *                        (defaults to ISA sea-level 1013.25 hPa)
 */
export function pressureToAltitude(
  pressureHpa: number,
  refPressureHpa: number = SEA_LEVEL_HPA
): number {
  return METRES_PER_HPA * (refPressureHpa - pressureHpa);
}

/**
 * Estimate the floor number from a pressure reading.
 *
 * Floor 0  = ground floor
 * Floor -1 = first basement level
 * Floor  1 = first floor above ground
 *
 * @param pressureHpa       Current barometric pressure in hPa
 * @param groundPressureHpa Pressure at ground-floor reference point
 * @param floorHeightM      Height of one floor in metres (default 3.0 m)
 */
export function estimateFloor(
  pressureHpa: number,
  groundPressureHpa: number = SEA_LEVEL_HPA,
  floorHeightM: number = FLOOR_HEIGHT_M
): number {
  const altitudeDelta = pressureToAltitude(pressureHpa, groundPressureHpa);
  return Math.round(altitudeDelta / floorHeightM);
}

/**
 * Convert a floor number to an approximate pressure offset (hPa) from ground.
 *
 * Useful for the simulator to generate realistic pressure readings.
 *
 * @param floor  Integer floor number (0 = ground, negative = basement)
 * @param groundPressureHpa  Reference ground pressure
 */
export function floorToPressure(
  floor: number,
  groundPressureHpa: number = SEA_LEVEL_HPA
): number {
  const altitudeDelta = floor * FLOOR_HEIGHT_M;
  // Invert: P = P_ref − Δh / METRES_PER_HPA
  return groundPressureHpa - altitudeDelta / METRES_PER_HPA;
}
