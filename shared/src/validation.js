import { METRES_PER_HPA } from "./schemas.js";

/** Maximum realistic soldier sprinting speed indoors (m/s) */
export const MAX_HORIZONTAL_SPEED_MPS = 10.0;

/** Maximum realistic vertical climbing / falling speed (m/s) */
export const MAX_VERTICAL_SPEED_MPS = 6.0;

/**
 * Pure function to validate telemetry packets and reject spoofed or corrupted data.
 *
 * Rejection criteria:
 * - NaN or non-finite values for required numerical fields
 * - Out-of-range sensor readings (battery, pressure, signal, seq, timestamp)
 * - Out-of-order timestamps (next.timestamp <= prev.timestamp)
 * - Duplicate or non-increasing sequence numbers (next.seq <= prev.seq)
 * - Impossible horizontal speed (> 10 m/s between packets)
 * - Impossible altitude / vertical change (> 6 m/s between packets)
 *
 * @param {object|null|undefined} prev - Previous accepted telemetry packet for this soldier
 * @param {object} next - Incoming candidate telemetry packet
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePacket(prev, next) {
  if (!next || typeof next !== "object") {
    return { valid: false, reason: "INVALID_PAYLOAD_STRUCTURE" };
  }

  // 1. Check for NaN, non-finite, or missing required numeric values
  const numericFields = ["x", "y", "pressureHpa", "batteryPct", "signal", "seq", "timestamp"];
  for (const field of numericFields) {
    const val = next[field];
    if (typeof val !== "number" || Number.isNaN(val) || !Number.isFinite(val)) {
      return { valid: false, reason: `NAN_OR_OUT_OF_RANGE_${field.toUpperCase()}` };
    }
  }

  // Check optional numeric fields if present
  if (next.altitude !== undefined) {
    if (typeof next.altitude !== "number" || Number.isNaN(next.altitude) || !Number.isFinite(next.altitude)) {
      return { valid: false, reason: "NAN_OR_OUT_OF_RANGE_ALTITUDE" };
    }
  }
  if (next.accelMagnitude !== undefined) {
    if (typeof next.accelMagnitude !== "number" || Number.isNaN(next.accelMagnitude) || !Number.isFinite(next.accelMagnitude) || next.accelMagnitude < 0) {
      return { valid: false, reason: "NAN_OR_OUT_OF_RANGE_ACCEL_MAGNITUDE" };
    }
  }

  // 2. Value range validations
  if (next.batteryPct < 0 || next.batteryPct > 100) {
    return { valid: false, reason: "OUT_OF_RANGE_BATTERY" };
  }
  if (next.pressureHpa <= 0 || next.pressureHpa > 1100) {
    return { valid: false, reason: "OUT_OF_RANGE_PRESSURE" };
  }
  if (next.signal < -130 || next.signal > 0) {
    return { valid: false, reason: "OUT_OF_RANGE_SIGNAL" };
  }
  if (next.seq < 0 || !Number.isInteger(next.seq)) {
    return { valid: false, reason: "OUT_OF_RANGE_SEQ" };
  }
  if (next.timestamp <= 0) {
    return { valid: false, reason: "OUT_OF_RANGE_TIMESTAMP" };
  }

  // If there is no previous packet for this soldier, initial packet is valid
  if (!prev) {
    return { valid: true };
  }

  // 3. Out-of-order timestamp check
  if (next.timestamp <= prev.timestamp) {
    return { valid: false, reason: "OUT_OF_ORDER_TIMESTAMP" };
  }

  // 4. Duplicate or non-increasing sequence numbers
  if (next.seq <= prev.seq) {
    return { valid: false, reason: "NON_INCREASING_SEQUENCE" };
  }

  // Elapsed time in seconds
  const dtSec = (next.timestamp - prev.timestamp) / 1000;
  if (dtSec <= 0) {
    return { valid: false, reason: "OUT_OF_ORDER_TIMESTAMP" };
  }

  // 5. Impossible horizontal speed check
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const horizontalDistM = Math.hypot(dx, dy);
  const horizontalSpeed = horizontalDistM / dtSec;

  if (horizontalSpeed > MAX_HORIZONTAL_SPEED_MPS) {
    return { valid: false, reason: "IMPOSSIBLE_HORIZONTAL_SPEED" };
  }

  // 6. Impossible vertical / altitude speed check
  let nextAlt = next.altitude;
  let prevAlt = prev.altitude;

  // If altitude is not explicitly provided on both, estimate from barometric pressure difference
  if (nextAlt === undefined || prevAlt === undefined) {
    const dHpa = Math.abs(next.pressureHpa - prev.pressureHpa);
    const estimatedVerticalDistM = dHpa * METRES_PER_HPA;
    const verticalSpeed = estimatedVerticalDistM / dtSec;
    if (verticalSpeed > MAX_VERTICAL_SPEED_MPS) {
      return { valid: false, reason: "IMPOSSIBLE_ALTITUDE_CHANGE" };
    }
  } else {
    const verticalDistM = Math.abs(nextAlt - prevAlt);
    const verticalSpeed = verticalDistM / dtSec;
    if (verticalSpeed > MAX_VERTICAL_SPEED_MPS) {
      return { valid: false, reason: "IMPOSSIBLE_ALTITUDE_CHANGE" };
    }
  }

  return { valid: true };
}
