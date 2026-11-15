import { describe, expect, it } from "vitest";
import { calculateMissionAnalytics } from "../src/analytics.js";
import { SIGNAL_LOST_TIMEOUT_MS } from "../src/alerts.js";

const mission = { id: "m1", name: "Mission 1", startedAt: 1_000, endedAt: 20_000, status: "completed" };
const packet = (timestamp, props = {}) => ({
  soldierId: "A1", teamId: "Alpha", timestamp, x: 0, y: 0, estimatedFloor: "G", ...props,
});
const soldier = (result, id = "A1") => result.soldiers.find((item) => item.soldierId === id);

describe("calculateMissionAnalytics", () => {
  it("calculates floor time and chronological floor transitions", () => {
    const result = calculateMissionAnalytics({ mission, asOf: 20_000, telemetry: [
      packet(1_000), packet(6_000, { x: 3, estimatedFloor: "1" }), packet(10_000, { x: 6, estimatedFloor: "2" }),
    ] });
    expect(soldier(result).timePerFloorMs).toEqual({ G: 5_000, "1": 4_000, "2": 10_000 });
    expect(soldier(result).floorTransitionCount).toBe(2);
    expect(soldier(result).floorTransitions).toEqual([
      { timestamp: 6_000, fromFloor: "G", toFloor: "1" },
      { timestamp: 10_000, fromFloor: "1", toFloor: "2" },
    ]);
  });

  it("computes distance for normal consecutive packets", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(2_000, { x: 3, y: 4 }), packet(3_000, { x: 6, y: 8 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(10);
  });

  it("does not count distance across a gap longer than the signal timeout", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(1_000 + SIGNAL_LOST_TIMEOUT_MS + 1, { x: 3, y: 4 }),
      packet(1_000 + SIGNAL_LOST_TIMEOUT_MS + 2_000, { x: 6, y: 8 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(5);
  });

  it("counts distance across a gap exactly equal to the signal timeout", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(1_000 + SIGNAL_LOST_TIMEOUT_MS, { x: 3, y: 4 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(5);
  });

  it("breaks the distance baseline when a packet has missing or invalid coordinates", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(2_000, { x: null, y: 4 }), packet(3_000, { x: 6, y: 8 }),
      packet(4_000, { x: 9, y: 12 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(5);
  });

  it("uses the shared timeout for recovered and mission-end signal loss", () => {
    const recovered = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(1_000 + SIGNAL_LOST_TIMEOUT_MS + 7_000),
    ] });
    expect(soldier(recovered).signalLostIntervals).toEqual([{
      startedAt: 11_000, endedAt: 18_000, durationMs: 7_000,
    }]);

    const endedWhileLost = calculateMissionAnalytics({
      mission: { ...mission, endedAt: 18_000 },
      telemetry: [packet(1_000)],
    });
    expect(soldier(endedWhileLost).longestSignalLostMs).toBe(7_000);
    expect(soldier(endedWhileLost).signalLostIntervals[0].endedAt).toBe(18_000);
  });

  it("uses asOf as the active-mission boundary and stops floor credit at timeout", () => {
    const result = calculateMissionAnalytics({
      mission: { ...mission, endedAt: null, status: "active" },
      asOf: 25_000,
      telemetry: [packet(1_000)],
    });
    expect(soldier(result).timePerFloorMs.G).toBe(SIGNAL_LOST_TIMEOUT_MS);
    expect(soldier(result).longestSignalLostMs).toBe(14_000);
  });

  it("sorts out-of-order packets and retains the last packet at duplicate timestamps", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(3_000, { x: 99 }), packet(1_000), packet(3_000, { x: 3, estimatedFloor: "1" }), packet(2_000, { x: 2 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(3);
    expect(soldier(result).floorTransitions).toEqual([
      { timestamp: 3_000, fromFloor: "G", toFloor: "1" },
    ]);
  });

  it("skips missing coordinates and does not attribute time to null floors", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(1_000), packet(2_000, { x: null, y: null, estimatedFloor: null }), packet(3_000, { x: 4, y: 0 }),
    ] });
    expect(soldier(result).distanceMeters).toBe(0);
    expect(soldier(result).timePerFloorMs).toEqual({ G: 11_000 });
    expect(soldier(result).floorTransitionCount).toBe(0);
  });

  it("ignores missing or invalid timestamps and telemetry outside mission bounds", () => {
    const result = calculateMissionAnalytics({ mission, telemetry: [
      packet(undefined), packet(500), packet(1_000), packet(21_000),
    ] });
    expect(result.soldiers).toHaveLength(1);
    expect(soldier(result).timePerFloorMs.G).toBe(SIGNAL_LOST_TIMEOUT_MS);
    expect(soldier(result).distanceMeters).toBe(0);
  });

  it("returns empty totals for a mission with no usable telemetry", () => {
    expect(calculateMissionAnalytics({ mission, telemetry: [] }).totals).toEqual({
      soldierCount: 0, distanceMeters: 0, floorTransitionCount: 0, longestSignalLostMs: 0,
    });
  });
});
