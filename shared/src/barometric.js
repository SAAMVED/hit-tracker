import {
  FLOOR_HEIGHT_M,
  FloorLabelSchema,
  METRES_PER_HPA,
  SEA_LEVEL_HPA,
} from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Standard temperature at sea level in Kelvin (15 °C) */
export const ISA_STANDARD_TEMP_K = 288.15;

/** Standard temperature lapse rate in Troposphere (K/m) */
export const ISA_LAPSE_RATE_K_PER_M = 0.0065;

/** Specific gas constant for dry air in J/(kg·K) */
export const GAS_CONSTANT_DRY_AIR = 287.05287;

/** Standard acceleration due to gravity in m/s² */
export const STANDARD_GRAVITY = 9.80665;

/** Exponent for barometric formula: (g) / (R * L) ≈ 5.25588 */
const BARO_EXPONENT = STANDARD_GRAVITY / (GAS_CONSTANT_DRY_AIR * ISA_LAPSE_RATE_K_PER_M);

/** Inverse exponent: (R * L) / g ≈ 0.190263 */
const INV_BARO_EXPONENT = 1 / BARO_EXPONENT;

export const FLOOR_LABELS = [
  "B2",
  "B1",
  "G",
  "1",
  "2",
  "3",
  "4",
  "5",
];

// ─── Floor Label Mapping ──────────────────────────────────────────────────────

/**
 * Maps an integer floor number (-2..5) to a FloorLabel ("B2", "B1", "G", "1".."5").
 * Values outside [-2, 5] are clamped to the nearest valid floor.
 */
export function floorNumberToLabel(floor) {
  const rounded = Math.round(floor);
  if (rounded <= -2) return "B2";
  if (rounded === -1) return "B1";
  if (rounded === 0) return "G";
  if (rounded >= 5) return "5";
  return String(rounded);
}

/**
 * Maps a FloorLabel to its integer floor number.
 * "B2" -> -2, "B1" -> -1, "G" -> 0, "1".."5" -> 1..5.
 */
export function floorLabelToNumber(label) {
  switch (label) {
    case "B2":
      return -2;
    case "B1":
      return -1;
    case "G":
      return 0;
    default:
      return parseInt(label, 10);
  }
}

/**
 * Type guard for FloorLabel.
 */
export function isFloorLabel(value) {
  return FloorLabelSchema.safeParse(value).success;
}

// ─── Hypsometric Formulas ────────────────────────────────────────────────────

/**
 * Relative altitude (in metres) from barometric pressure against an entry-point
 * reference pressure P0 using the international barometric / hypsometric formula.
 */
export function hypsometricAltitude(pressureHpa, p0Hpa = SEA_LEVEL_HPA, tempC = 15) {
  if (pressureHpa <= 0 || p0Hpa <= 0) return 0;
  if (pressureHpa === p0Hpa) return 0;

  const tempK = tempC + 273.15;
  const scaleHeight = tempK / ISA_LAPSE_RATE_K_PER_M;
  const pressureRatio = pressureHpa / p0Hpa;

  return scaleHeight * (1 - Math.pow(pressureRatio, INV_BARO_EXPONENT));
}

/**
 * Inverse hypsometric formula: calculates expected pressure from relative altitude.
 */
export function altitudeToPressure(altitudeM, p0Hpa = SEA_LEVEL_HPA, tempC = 15) {
  if (altitudeM === 0) return p0Hpa;

  const tempK = tempC + 273.15;
  const tempRatio = 1 - (ISA_LAPSE_RATE_K_PER_M * altitudeM) / tempK;
  if (tempRatio <= 0) return 0;

  return p0Hpa * Math.pow(tempRatio, BARO_EXPONENT);
}

// ─── Legacy / Backward-Compatible Functions ──────────────────────────────────

/**
 * Linear approximation of altitude above sea level (metres) from pressure reading.
 * Preserved for backwards compatibility with existing tests.
 */
export function pressureToAltitude(pressureHpa, refPressureHpa = SEA_LEVEL_HPA) {
  return METRES_PER_HPA * (refPressureHpa - pressureHpa);
}

/**
 * Estimate the floor number from a pressure reading using linear approximation.
 * Preserved for backwards compatibility with existing tests.
 */
export function estimateFloor(pressureHpa, groundPressureHpa = SEA_LEVEL_HPA, floorHeightM = FLOOR_HEIGHT_M) {
  const altitudeDelta = pressureToAltitude(pressureHpa, groundPressureHpa);
  return Math.round(altitudeDelta / floorHeightM);
}

// Alias for backwards compatibility
export const estimateFloorFromPressure = estimateFloor;

/**
 * Convert a floor number to an approximate pressure offset (hPa) from ground.
 * Preserved for backwards compatibility with existing tests.
 */
export function floorToPressure(floor, groundPressureHpa = SEA_LEVEL_HPA) {
  const altitudeDelta = floor * FLOOR_HEIGHT_M;
  return groundPressureHpa - altitudeDelta / METRES_PER_HPA;
}

// ─── Kalman Filter (1D) ───────────────────────────────────────────────────────

/**
 * 1D Kalman Filter for smoothing barometric altitude readings.
 */
export class KalmanFilter1D {
  #x;
  #p;
  #q;
  #r;
  #initialized;

  constructor({ q = 0.05, r = 0.5, p = 1.0, initialAltitude } = {}) {
    this.#q = q;
    this.#r = r;
    this.#p = p;
    this.#x = initialAltitude ?? 0;
    this.#initialized = initialAltitude !== undefined;
  }

  /**
   * Updates the filter with a new altitude measurement and returns smoothed estimate.
   */
  update(measurement) {
    if (!this.#initialized) {
      this.#x = measurement;
      this.#p = this.#r;
      this.#initialized = true;
      return this.#x;
    }

    // Prediction step
    const pPredicted = this.#p + this.#q;

    // Measurement update step
    const kGain = pPredicted / (pPredicted + this.#r);
    this.#x = this.#x + kGain * (measurement - this.#x);
    this.#p = (1 - kGain) * pPredicted;

    return this.#x;
  }

  getAltitude() {
    return this.#x;
  }

  reset(altitude) {
    if (altitude !== undefined) {
      this.#x = altitude;
      this.#p = this.#r;
      this.#initialized = true;
    } else {
      this.#initialized = false;
      this.#x = 0;
      this.#p = 1.0;
    }
  }
}

// ─── Floor State Machine (Hysteresis) ─────────────────────────────────────────

/**
 * Hysteresis state machine that maps smoothed altitude to discrete floor labels.
 * A transition only occurs when altitude stays beyond the threshold band for
 * at least `minDwellTimeMs` milliseconds.
 */
export class FloorStateMachine {
  floorHeightM;
  thresholdBandM;
  minDwellTimeMs;
  #currentFloor;
  #candidateFloor = null;
  #candidateStartTime = null;

  constructor({
    floorHeightM = FLOOR_HEIGHT_M,
    thresholdBandM = 0.4,
    minDwellTimeMs = 2000,
    initialFloor = "G",
  } = {}) {
    this.floorHeightM = floorHeightM;
    this.thresholdBandM = thresholdBandM;
    this.minDwellTimeMs = minDwellTimeMs;
    this.#currentFloor = initialFloor;
  }

  /**
   * Updates state with smoothed altitude and timestamp.
   */
  update(smoothedAltitude, timestampMs) {
    const curNum = floorLabelToNumber(this.#currentFloor);

    // Calculate upper threshold to move up (if not top floor 5)
    // Nominal midpoint boundary between curNum and curNum + 1 is (curNum + 0.5) * H
    const upperBoundary = (curNum + 0.5) * this.floorHeightM;
    const upperThreshold = curNum < 5 ? upperBoundary + this.thresholdBandM : Infinity;

    // Calculate lower threshold to move down (if not lowest floor B2 / -2)
    const lowerBoundary = (curNum - 0.5) * this.floorHeightM;
    const lowerThreshold = curNum > -2 ? lowerBoundary - this.thresholdBandM : -Infinity;

    let targetFloor = null;

    if (smoothedAltitude >= upperThreshold) {
      // Altitude exceeds upper threshold
      const estimatedNum = Math.min(
        5,
        Math.max(curNum + 1, Math.round(smoothedAltitude / this.floorHeightM))
      );
      targetFloor = floorNumberToLabel(estimatedNum);
    } else if (smoothedAltitude <= lowerThreshold) {
      // Altitude falls below lower threshold
      const estimatedNum = Math.max(
        -2,
        Math.min(curNum - 1, Math.round(smoothedAltitude / this.floorHeightM))
      );
      targetFloor = floorNumberToLabel(estimatedNum);
    } else {
      // Altitude remains inside current floor's hysteresis band
      this.#candidateFloor = null;
      this.#candidateStartTime = null;
      return {
        floor: this.#currentFloor,
        floorNumber: curNum,
        changed: false,
        candidateFloor: null,
        candidateDwellMs: 0,
      };
    }

    // A candidate target floor outside current floor is detected
    if (this.#candidateFloor !== targetFloor) {
      this.#candidateFloor = targetFloor;
      this.#candidateStartTime = timestampMs;
    }

    const dwellMs = Math.max(0, timestampMs - (this.#candidateStartTime ?? timestampMs));

    if (dwellMs >= this.minDwellTimeMs) {
      // Transition condition met! Commit new floor
      this.#currentFloor = targetFloor;
      this.#candidateFloor = null;
      this.#candidateStartTime = null;
      return {
        floor: this.#currentFloor,
        floorNumber: floorLabelToNumber(this.#currentFloor),
        changed: true,
        candidateFloor: null,
        candidateDwellMs: dwellMs,
      };
    }

    // Still dwelling in candidate floor band
    return {
      floor: this.#currentFloor,
      floorNumber: curNum,
      changed: false,
      candidateFloor: this.#candidateFloor,
      candidateDwellMs: dwellMs,
    };
  }

  getCurrentFloor() {
    return this.#currentFloor;
  }

  reset(floor = "G") {
    this.#currentFloor = floor;
    this.#candidateFloor = null;
    this.#candidateStartTime = null;
  }
}

// ─── Integrated Floor Estimator ───────────────────────────────────────────────

/**
 * End-to-end barometric floor estimator combining:
 * 1. Hypsometric formula (pressure -> raw relative altitude)
 * 2. 1D Kalman filter (raw altitude -> smoothed altitude)
 * 3. Hysteresis state machine (smoothed altitude -> floor label with dwell time)
 */
export class FloorEstimator {
  p0Hpa;
  tempC;
  #kalman;
  #stateMachine;

  constructor(options = {}) {
    this.p0Hpa = options.p0Hpa ?? SEA_LEVEL_HPA;
    this.tempC = options.tempC ?? 15;

    this.#kalman = new KalmanFilter1D({
      q: options.kalmanQ ?? 0.05,
      r: options.kalmanR ?? 0.5,
    });

    this.#stateMachine = new FloorStateMachine(options);
  }

  /**
   * Process a new barometric pressure sample.
   */
  update(pressureHpa, timestampMs) {
    const rawAltitude = hypsometricAltitude(pressureHpa, this.p0Hpa, this.tempC);
    const smoothedAltitude = this.#kalman.update(rawAltitude);
    const state = this.#stateMachine.update(smoothedAltitude, timestampMs);

    return {
      rawAltitude,
      smoothedAltitude,
      floor: state.floor,
      floorNumber: state.floorNumber,
      changed: state.changed,
    };
  }

  getCurrentFloor() {
    return this.#stateMachine.getCurrentFloor();
  }

  getSmoothedAltitude() {
    return this.#kalman.getAltitude();
  }

  setReferencePressure(p0Hpa) {
    this.p0Hpa = p0Hpa;
  }
}
