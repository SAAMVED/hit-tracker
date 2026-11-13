import {
  FLOOR_HEIGHT_M,
  FloorLabel,
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

export const FLOOR_LABELS: readonly FloorLabel[] = [
  "B2",
  "B1",
  "G",
  "1",
  "2",
  "3",
  "4",
  "5",
] as const;

// ─── Floor Label Mapping ──────────────────────────────────────────────────────

/**
 * Maps an integer floor number (-2..5) to a FloorLabel ("B2", "B1", "G", "1".."5").
 * Values outside [-2, 5] are clamped to the nearest valid floor.
 */
export function floorNumberToLabel(floor: number): FloorLabel {
  const rounded = Math.round(floor);
  if (rounded <= -2) return "B2";
  if (rounded === -1) return "B1";
  if (rounded === 0) return "G";
  if (rounded >= 5) return "5";
  return String(rounded) as FloorLabel;
}

/**
 * Maps a FloorLabel to its integer floor number.
 * "B2" -> -2, "B1" -> -1, "G" -> 0, "1".."5" -> 1..5.
 */
export function floorLabelToNumber(label: FloorLabel): number {
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
export function isFloorLabel(value: unknown): value is FloorLabel {
  return FloorLabelSchema.safeParse(value).success;
}

// ─── Hypsometric Formulas ────────────────────────────────────────────────────

/**
 * Relative altitude (in metres) from barometric pressure against an entry-point
 * reference pressure P0 using the international barometric / hypsometric formula.
 *
 * h = (T0 / L) * (1 - (P / P0)^((R * L) / g))
 *
 * @param pressureHpa Measured barometric pressure in hectopascals (hPa)
 * @param p0Hpa Reference pressure at ground level P0 in hPa (default: 1013.25)
 * @param tempC Ambient temperature in degrees Celsius (default: 15 °C)
 * @returns Relative altitude in metres (positive = above ground, negative = basement)
 */
export function hypsometricAltitude(
  pressureHpa: number,
  p0Hpa: number = SEA_LEVEL_HPA,
  tempC: number = 15
): number {
  if (pressureHpa <= 0 || p0Hpa <= 0) return 0;
  if (pressureHpa === p0Hpa) return 0;

  const tempK = tempC + 273.15;
  const scaleHeight = tempK / ISA_LAPSE_RATE_K_PER_M;
  const pressureRatio = pressureHpa / p0Hpa;

  return scaleHeight * (1 - Math.pow(pressureRatio, INV_BARO_EXPONENT));
}

/**
 * Inverse hypsometric formula: calculates expected pressure from relative altitude.
 *
 * P = P0 * (1 - (L * h) / T0)^(g / (R * L))
 *
 * @param altitudeM Relative altitude in metres
 * @param p0Hpa Reference ground pressure in hPa (default: 1013.25)
 * @param tempC Ambient temperature in degrees Celsius (default: 15 °C)
 * @returns Barometric pressure in hectopascals (hPa)
 */
export function altitudeToPressure(
  altitudeM: number,
  p0Hpa: number = SEA_LEVEL_HPA,
  tempC: number = 15
): number {
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
export function pressureToAltitude(
  pressureHpa: number,
  refPressureHpa: number = SEA_LEVEL_HPA
): number {
  return METRES_PER_HPA * (refPressureHpa - pressureHpa);
}

/**
 * Estimate the floor number from a pressure reading using linear approximation.
 * Preserved for backwards compatibility with existing tests.
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
 * Preserved for backwards compatibility with existing tests.
 */
export function floorToPressure(
  floor: number,
  groundPressureHpa: number = SEA_LEVEL_HPA
): number {
  const altitudeDelta = floor * FLOOR_HEIGHT_M;
  return groundPressureHpa - altitudeDelta / METRES_PER_HPA;
}

// ─── 1D Kalman Filter ────────────────────────────────────────────────────────

export interface KalmanFilterOptions {
  /** Process noise covariance Q (default: 0.05) */
  q?: number;
  /** Measurement noise covariance R (default: 0.5) */
  r?: number;
  /** Initial estimation error covariance P (default: 1.0) */
  p?: number;
  /** Initial state/altitude estimate */
  initialAltitude?: number;
}

/**
 * 1D Kalman Filter for smoothing barometric altitude readings.
 */
export class KalmanFilter1D {
  private x: number;
  private p: number;
  private readonly q: number;
  private readonly r: number;
  private initialized: boolean;

  constructor(options: KalmanFilterOptions = {}) {
    this.q = options.q ?? 0.05;
    this.r = options.r ?? 0.5;
    this.p = options.p ?? 1.0;
    this.x = options.initialAltitude ?? 0;
    this.initialized = options.initialAltitude !== undefined;
  }

  /**
   * Updates the filter with a new altitude measurement and returns smoothed estimate.
   */
  public update(measurement: number): number {
    if (!this.initialized) {
      this.x = measurement;
      this.p = this.r;
      this.initialized = true;
      return this.x;
    }

    // Prediction step
    const pPredicted = this.p + this.q;

    // Measurement update step
    const kGain = pPredicted / (pPredicted + this.r);
    this.x = this.x + kGain * (measurement - this.x);
    this.p = (1 - kGain) * pPredicted;

    return this.x;
  }

  public getAltitude(): number {
    return this.x;
  }

  public reset(altitude?: number): void {
    if (altitude !== undefined) {
      this.x = altitude;
      this.p = this.r;
      this.initialized = true;
    } else {
      this.initialized = false;
      this.x = 0;
      this.p = 1.0;
    }
  }
}

// ─── Hysteresis State Machine ─────────────────────────────────────────────────

export interface FloorStateMachineOptions {
  /** Height of each floor in metres (default: 3.5 m) */
  floorHeightM?: number;
  /** Hysteresis margin band in metres beyond boundary (default: 0.4 m) */
  thresholdBandM?: number;
  /** Minimum time (ms) altitude must stay beyond threshold band before transition (default: 2000 ms) */
  minDwellTimeMs?: number;
  /** Initial floor label (default: "G") */
  initialFloor?: FloorLabel;
}

export interface FloorStateResult {
  /** Current floor label after update */
  floor: FloorLabel;
  /** Current integer floor number (-2..5) */
  floorNumber: number;
  /** Whether the floor label changed in this update */
  changed: boolean;
  /** Candidate floor being evaluated, or null if within current floor's band */
  candidateFloor: FloorLabel | null;
  /** Elapsed time (ms) candidate floor has been active */
  candidateDwellMs: number;
}

/**
 * Hysteresis state machine that maps smoothed altitude to discrete floor labels
 * (B2, B1, G, 1..5). A transition only occurs when altitude stays beyond the
 * threshold band of the current floor for at least `minDwellTimeMs`.
 */
export class FloorStateMachine {
  public readonly floorHeightM: number;
  public readonly thresholdBandM: number;
  public readonly minDwellTimeMs: number;

  private currentFloor: FloorLabel;
  private candidateFloor: FloorLabel | null = null;
  private candidateStartTime: number | null = null;

  constructor(options: FloorStateMachineOptions = {}) {
    this.floorHeightM = options.floorHeightM ?? 3.5;
    this.thresholdBandM = options.thresholdBandM ?? 0.4;
    this.minDwellTimeMs = options.minDwellTimeMs ?? 2000;
    this.currentFloor = options.initialFloor ?? "G";
  }

  /**
   * Updates state with smoothed altitude and timestamp.
   *
   * @param smoothedAltitude Altitude in metres (smoothed by Kalman filter)
   * @param timestampMs Unix timestamp in milliseconds
   */
  public update(smoothedAltitude: number, timestampMs: number): FloorStateResult {
    const curNum = floorLabelToNumber(this.currentFloor);

    // Calculate upper threshold to move up (if not top floor 5)
    // Nominal midpoint boundary between curNum and curNum + 1 is (curNum + 0.5) * H
    const upperBoundary = (curNum + 0.5) * this.floorHeightM;
    const upperThreshold = curNum < 5 ? upperBoundary + this.thresholdBandM : Infinity;

    // Calculate lower threshold to move down (if not lowest floor B2 / -2)
    const lowerBoundary = (curNum - 0.5) * this.floorHeightM;
    const lowerThreshold = curNum > -2 ? lowerBoundary - this.thresholdBandM : -Infinity;

    let targetFloor: FloorLabel | null = null;

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
      this.candidateFloor = null;
      this.candidateStartTime = null;
      return {
        floor: this.currentFloor,
        floorNumber: curNum,
        changed: false,
        candidateFloor: null,
        candidateDwellMs: 0,
      };
    }

    // A candidate target floor outside current floor is detected
    if (this.candidateFloor !== targetFloor) {
      this.candidateFloor = targetFloor;
      this.candidateStartTime = timestampMs;
    }

    const dwellMs = Math.max(0, timestampMs - (this.candidateStartTime ?? timestampMs));

    if (dwellMs >= this.minDwellTimeMs) {
      // Transition condition met! Commit new floor
      this.currentFloor = targetFloor;
      this.candidateFloor = null;
      this.candidateStartTime = null;
      return {
        floor: this.currentFloor,
        floorNumber: floorLabelToNumber(this.currentFloor),
        changed: true,
        candidateFloor: null,
        candidateDwellMs: dwellMs,
      };
    }

    // Still dwelling in candidate floor band
    return {
      floor: this.currentFloor,
      floorNumber: curNum,
      changed: false,
      candidateFloor: this.candidateFloor,
      candidateDwellMs: dwellMs,
    };
  }

  public getCurrentFloor(): FloorLabel {
    return this.currentFloor;
  }

  public reset(floor: FloorLabel = "G"): void {
    this.currentFloor = floor;
    this.candidateFloor = null;
    this.candidateStartTime = null;
  }
}

// ─── Integrated Floor Estimator ───────────────────────────────────────────────

export interface FloorEstimatorOptions extends FloorStateMachineOptions {
  /** Entry-point reference pressure P0 in hPa (default: 1013.25) */
  p0Hpa?: number;
  /** Ambient temperature in °C (default: 15) */
  tempC?: number;
  /** Kalman filter process noise Q (default: 0.05) */
  kalmanQ?: number;
  /** Kalman filter measurement noise R (default: 0.5) */
  kalmanR?: number;
}

export interface FloorEstimationResult {
  /** Raw altitude computed via hypsometric formula (metres) */
  rawAltitude: number;
  /** Altitude smoothed by 1D Kalman filter (metres) */
  smoothedAltitude: number;
  /** Estimated floor label ("B2", "B1", "G", "1".."5") */
  floor: FloorLabel;
  /** Estimated floor number (-2..5) */
  floorNumber: number;
  /** Whether the floor label transitioned in this update */
  changed: boolean;
}

/**
 * End-to-end barometric floor estimator combining:
 * 1. Hypsometric formula (pressure -> raw relative altitude)
 * 2. 1D Kalman filter (raw altitude -> smoothed altitude)
 * 3. Hysteresis state machine (smoothed altitude -> floor label with dwell time)
 */
export class FloorEstimator {
  public p0Hpa: number;
  public tempC: number;
  private readonly kalman: KalmanFilter1D;
  private readonly stateMachine: FloorStateMachine;

  constructor(options: FloorEstimatorOptions = {}) {
    this.p0Hpa = options.p0Hpa ?? SEA_LEVEL_HPA;
    this.tempC = options.tempC ?? 15;

    this.kalman = new KalmanFilter1D({
      q: options.kalmanQ ?? 0.05,
      r: options.kalmanR ?? 0.5,
    });

    this.stateMachine = new FloorStateMachine(options);
  }

  /**
   * Process a new barometric pressure sample.
   *
   * @param pressureHpa Measured barometric pressure in hPa
   * @param timestampMs Unix timestamp of reading (ms)
   */
  public update(pressureHpa: number, timestampMs: number): FloorEstimationResult {
    const rawAltitude = hypsometricAltitude(pressureHpa, this.p0Hpa, this.tempC);
    const smoothedAltitude = this.kalman.update(rawAltitude);
    const state = this.stateMachine.update(smoothedAltitude, timestampMs);

    return {
      rawAltitude,
      smoothedAltitude,
      floor: state.floor,
      floorNumber: state.floorNumber,
      changed: state.changed,
    };
  }

  public getCurrentFloor(): FloorLabel {
    return this.stateMachine.getCurrentFloor();
  }

  public getSmoothedAltitude(): number {
    return this.kalman.getAltitude();
  }

  public setReferencePressure(p0Hpa: number): void {
    this.p0Hpa = p0Hpa;
  }
}
