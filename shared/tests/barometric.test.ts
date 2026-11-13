import { describe, it, expect } from "vitest";
import { estimateFloor, floorToPressure, pressureToAltitude } from "../src/barometric.js";
import { SEA_LEVEL_HPA, FLOOR_HEIGHT_M } from "../src/schemas.js";

// ─── Barometric Estimation Tests ─────────────────────────────────────────────

describe("pressureToAltitude", () => {
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

describe("estimateFloor", () => {
  it("returns floor 0 when pressure equals ground reference", () => {
    expect(estimateFloor(SEA_LEVEL_HPA, SEA_LEVEL_HPA)).toBe(0);
  });

  it("returns floor 1 when altitude ≈ FLOOR_HEIGHT_M above ground", () => {
    // Need pressure drop corresponding to 3 m
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

describe("floorToPressure", () => {
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
