import { describe, expect, it } from "vitest";
import {
  FloorEstimator,
  FloorStateMachine,
  KalmanFilter1D,
  altitudeToPressure,
  estimateFloor,
  floorLabelToNumber,
  floorNumberToLabel,
  floorToPressure,
  hypsometricAltitude,
  pressureToAltitude,
} from "../src/barometric.js";
import { FLOOR_HEIGHT_M, SEA_LEVEL_HPA } from "../src/schemas.js";

// ─── Legacy Barometric Functions ──────────────────────────────────────────────

describe("pressureToAltitude (legacy)", () => {
  it("returns 0 when pressure equals reference", () => {
    expect(pressureToAltitude(SEA_LEVEL_HPA, SEA_LEVEL_HPA)).toBe(0);
  });

  it("returns positive altitude for pressure below reference (ascending)", () => {
    // 1 hPa drop ≈ 8.3 m gain
    const alt = pressureToAltitude(SEA_LEVEL_HPA - 1, SEA_LEVEL_HPA);
    expect(alt).toBeCloseTo(8.3, 5);
  });

  it("returns negative altitude for pressure above reference (descending)", () => {
    const alt = pressureToAltitude(SEA_LEVEL_HPA + 1, SEA_LEVEL_HPA);
    expect(alt).toBeCloseTo(-8.3, 5);
  });
});

describe("estimateFloor (legacy)", () => {
  it("returns floor 0 when pressure equals ground reference", () => {
    expect(estimateFloor(SEA_LEVEL_HPA, SEA_LEVEL_HPA)).toBe(0);
  });

  it("returns floor 1 when altitude ≈ FLOOR_HEIGHT_M above ground", () => {
    const pressureDrop = FLOOR_HEIGHT_M / 8.3;
    const floor = estimateFloor(SEA_LEVEL_HPA - pressureDrop, SEA_LEVEL_HPA);
    expect(floor).toBe(1);
  });

  it("returns negative floor for basement (pressure above ground reference)", () => {
    const pressureRise = FLOOR_HEIGHT_M / 8.3;
    const floor = estimateFloor(SEA_LEVEL_HPA + pressureRise, SEA_LEVEL_HPA);
    expect(floor).toBe(-1);
  });
});

describe("floorToPressure (legacy)", () => {
  it("returns ground pressure for floor 0", () => {
    expect(floorToPressure(0, SEA_LEVEL_HPA)).toBeCloseTo(SEA_LEVEL_HPA, 5);
  });

  it("round-trips: estimateFloor(floorToPressure(n)) === n", () => {
    for (const floor of [-2, -1, 0, 1, 2, 3]) {
      const pressure = floorToPressure(floor, SEA_LEVEL_HPA);
      expect(estimateFloor(pressure, SEA_LEVEL_HPA)).toBe(floor);
    }
  });
});

// ─── Hypsometric Formula Tests ───────────────────────────────────────────────

describe("hypsometricAltitude & altitudeToPressure", () => {
  it("returns exactly 0 altitude when pressure equals entry-point reference P0", () => {
    expect(hypsometricAltitude(1013.25, 1013.25)).toBe(0);
    expect(hypsometricAltitude(990.0, 990.0)).toBe(0);
  });

  it("calculates positive relative altitude when ascending (P < P0)", () => {
    const alt = hypsometricAltitude(1012.83, 1013.25, 15);
    expect(alt).toBeGreaterThan(3.4);
    expect(alt).toBeLessThan(3.6);
  });

  it("calculates negative relative altitude when descending into basement (P > P0)", () => {
    const alt = hypsometricAltitude(1013.67, 1013.25, 15);
    expect(alt).toBeLessThan(-3.4);
    expect(alt).toBeGreaterThan(-3.6);
  });

  it("round-trips between altitudeToPressure and hypsometricAltitude across multiple floors", () => {
    const testAltitudes = [-7.0, -3.5, 0.0, 3.5, 7.0, 10.5, 14.0, 17.5];
    for (const alt of testAltitudes) {
      const pressure = altitudeToPressure(alt, 1013.25, 15);
      const computedAlt = hypsometricAltitude(pressure, 1013.25, 15);
      expect(computedAlt).toBeCloseTo(alt, 4);
    }
  });
});

// ─── 1D Kalman Filter Tests ──────────────────────────────────────────────────

describe("KalmanFilter1D", () => {
  it("initializes on first measurement", () => {
    const kf = new KalmanFilter1D();
    const result = kf.update(7.0);
    expect(result).toBe(7.0);
    expect(kf.getAltitude()).toBe(7.0);
  });

  it("substantially reduces variance of noisy static sensor measurements", () => {
    const kf = new KalmanFilter1D({ q: 0.02, r: 0.8 });
    const trueAltitude = 10.5;
    const rawErrors: number[] = [];
    const filteredErrors: number[] = [];

    // Simulate 50 noisy measurements around 10.5 m with alternating noise ±1.2m
    for (let i = 0; i < 50; i++) {
      const noise = (i % 2 === 0 ? 1 : -1) * 1.2;
      const measurement = trueAltitude + noise;
      const filtered = kf.update(measurement);

      if (i > 10) {
        // Evaluate steady-state errors
        rawErrors.push(Math.abs(measurement - trueAltitude));
        filteredErrors.push(Math.abs(filtered - trueAltitude));
      }
    }

    const avgRawError = rawErrors.reduce((a, b) => a + b, 0) / rawErrors.length;
    const avgFilteredError =
      filteredErrors.reduce((a, b) => a + b, 0) / filteredErrors.length;

    expect(avgFilteredError).toBeLessThan(avgRawError * 0.4);
  });

  it("tracks dynamic altitude changes while climbing stairs", () => {
    const kf = new KalmanFilter1D({ q: 0.1, r: 0.4 });
    kf.update(0);

    // Climb from 0m to 3.5m over 5 steps
    const trajectory = [0.7, 1.4, 2.1, 2.8, 3.5];
    let lastFiltered = 0;
    for (const target of trajectory) {
      const filtered = kf.update(target);
      expect(filtered).toBeGreaterThan(lastFiltered);
      lastFiltered = filtered;
    }
    // Filter tracks dynamically behind the measurement
    expect(lastFiltered).toBeGreaterThan(2.5);

    // Once settled at the landing (3.5 m)
    kf.update(3.5);
    kf.update(3.5);
    expect(kf.getAltitude()).toBeGreaterThan(3.1);
  });
});

// ─── Floor Label Helpers ─────────────────────────────────────────────────────

describe("floorNumberToLabel and floorLabelToNumber", () => {
  it("maps numbers -2..5 to correct FloorLabel strings", () => {
    expect(floorNumberToLabel(-2)).toBe("B2");
    expect(floorNumberToLabel(-1)).toBe("B1");
    expect(floorNumberToLabel(0)).toBe("G");
    expect(floorNumberToLabel(1)).toBe("1");
    expect(floorNumberToLabel(2)).toBe("2");
    expect(floorNumberToLabel(3)).toBe("3");
    expect(floorNumberToLabel(4)).toBe("4");
    expect(floorNumberToLabel(5)).toBe("5");
  });

  it("clamps out-of-range floor numbers", () => {
    expect(floorNumberToLabel(-5)).toBe("B2");
    expect(floorNumberToLabel(10)).toBe("5");
  });

  it("maps labels back to numbers", () => {
    expect(floorLabelToNumber("B2")).toBe(-2);
    expect(floorLabelToNumber("B1")).toBe(-1);
    expect(floorLabelToNumber("G")).toBe(0);
    expect(floorLabelToNumber("1")).toBe(1);
    expect(floorLabelToNumber("5")).toBe(5);
  });
});

// ─── Hysteresis State Machine Tests ──────────────────────────────────────────

describe("FloorStateMachine", () => {
  it("maps steady nominal altitudes to correct floor labels", () => {
    const sm = new FloorStateMachine({
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 1000,
      initialFloor: "G",
    });

    let t = 1000;
    // Move to Floor 2 (7.0 m) and dwell 2000 ms
    sm.update(7.0, t);
    t += 1000;
    const res = sm.update(7.0, t);
    expect(res.floor).toBe("2");
    expect(res.floorNumber).toBe(2);
    expect(res.changed).toBe(true);
  });

  it("prevents floor-bouncing around a boundary under rapid noise oscillations", () => {
    // Floor height 3.5 m -> boundary between G (0 m) and 1 (3.5 m) is 1.75 m.
    // With thresholdBandM = 0.4 m, upper threshold from G is 1.75 + 0.4 = 2.15 m.
    const sm = new FloorStateMachine({
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 2000,
      initialFloor: "G",
    });

    let t = 1000;
    // Oscillate altitude around the 1.75 m midpoint: [1.60, 1.90, 1.70, 1.85, 1.65, 1.80]
    // None of these exceed 2.15 m, so floor must strictly remain "G" with ZERO bounces.
    const noisySamples = [1.65, 1.85, 1.7, 1.9, 1.72, 1.82, 1.68, 1.88];
    for (const alt of noisySamples) {
      t += 500;
      const res = sm.update(alt, t);
      expect(res.floor).toBe("G");
      expect(res.changed).toBe(false);
      expect(res.candidateFloor).toBeNull();
    }

    // Now cross the threshold band (2.3 m > 2.15 m) and dwell for minDwellTimeMs (2000 ms)
    sm.update(2.3, t); // t = 5000, dwell begins
    t += 1000;
    let intermediate = sm.update(2.4, t); // t = 6000, dwell 1000 ms < 2000 ms
    expect(intermediate.floor).toBe("G");
    expect(intermediate.changed).toBe(false);

    t += 1000;
    let committed = sm.update(2.4, t); // t = 7000, dwell 2000 ms -> transition!
    expect(committed.floor).toBe("1");
    expect(committed.changed).toBe(true);

    // Now test downward hysteresis from Floor 1:
    // To drop from 1 back to G, altitude must drop below 1.75 - 0.4 = 1.35 m!
    // Oscillating around 1.75 m (e.g. 1.60 m to 1.80 m) now keeps the floor at "1"!
    for (const alt of [1.8, 1.6, 1.75, 1.5, 1.7]) {
      t += 500;
      const res = sm.update(alt, t);
      expect(res.floor).toBe("1");
      expect(res.changed).toBe(false);
    }
  });

  it("does not transition if altitude spike dwells for less than minDwellTimeMs", () => {
    const sm = new FloorStateMachine({
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 3000,
      initialFloor: "G",
    });

    let t = 1000;
    // Transient spike above threshold band for 1.5s
    sm.update(3.5, t); // t = 1000
    t += 1500;
    const resSpike = sm.update(3.5, t); // t = 2500 (1500 ms dwell)
    expect(resSpike.floor).toBe("G");
    expect(resSpike.changed).toBe(false);
    expect(resSpike.candidateFloor).toBe("1");

    // Drops back to ground floor altitude before 3000ms dwell completes
    t += 500;
    const resFallback = sm.update(0.2, t); // t = 3000
    expect(resFallback.floor).toBe("G");
    expect(resFallback.changed).toBe(false);
    expect(resFallback.candidateFloor).toBeNull();
  });

  it("transitions smoothly into basement levels (B1 and B2)", () => {
    const sm = new FloorStateMachine({
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 2000,
      initialFloor: "G",
    });

    let t = 1000;
    // Move down to B1 (-3.5 m)
    sm.update(-3.5, t);
    t += 2000;
    const resB1 = sm.update(-3.5, t);
    expect(resB1.floor).toBe("B1");
    expect(resB1.floorNumber).toBe(-1);
    expect(resB1.changed).toBe(true);

    // Move further down to B2 (-7.0 m)
    t += 500;
    sm.update(-7.0, t);
    t += 2000;
    const resB2 = sm.update(-7.0, t);
    expect(resB2.floor).toBe("B2");
    expect(resB2.floorNumber).toBe(-2);
    expect(resB2.changed).toBe(true);
  });
});

// ─── Integrated FloorEstimator Tests ─────────────────────────────────────────

describe("FloorEstimator (end-to-end)", () => {
  it("processes barometric pressures and estimates floor with Kalman smoothing", () => {
    const estimator = new FloorEstimator({
      p0Hpa: 1013.25,
      floorHeightM: 3.5,
      thresholdBandM: 0.4,
      minDwellTimeMs: 2000,
      initialFloor: "G",
    });

    let t = 1000;
    // Ground floor pressure ~1013.25 hPa
    const initial = estimator.update(1013.25, t);
    expect(initial.floor).toBe("G");
    expect(initial.smoothedAltitude).toBeCloseTo(0, 1);

    // Ascend to Floor 1 (~1012.83 hPa) and dwell for 4 seconds
    const pFloor1 = altitudeToPressure(3.5, 1013.25);
    for (let i = 0; i < 4; i++) {
      t += 1000;
      estimator.update(pFloor1, t);
    }
    const updated = estimator.update(pFloor1, t + 1000);

    expect(updated.floor).toBe("1");
    expect(updated.floorNumber).toBe(1);
    expect(updated.smoothedAltitude).toBeGreaterThan(3.0);
  });
});
