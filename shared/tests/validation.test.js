import { describe, expect, it } from "vitest";
import { validatePacket, MAX_HORIZONTAL_SPEED_MPS, MAX_VERTICAL_SPEED_MPS } from "../src/validation.js";

describe("Telemetry Packet Validation & Spoof Rejection", () => {
  const baseValidPacket = {
    soldierId: "A1",
    teamId: "Alpha",
    seq: 10,
    timestamp: 1700000010000,
    x: 10.0,
    y: 10.0,
    pressureHpa: 1013.25,
    batteryPct: 80,
    signal: -65,
    altitude: 3.5,
    accelMagnitude: 1.0,
  };

  it("accepts a valid initial packet when prev is undefined or null", () => {
    const res = validatePacket(null, baseValidPacket);
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("accepts a valid sequential packet within physical speed limits", () => {
    const prev = { ...baseValidPacket };
    const next = {
      ...baseValidPacket,
      seq: 11,
      timestamp: baseValidPacket.timestamp + 1000, // 1 second later
      x: 11.2, // ~1.2 m distance -> 1.2 m/s
      y: 10.5,
      altitude: 3.8, // 0.3 m altitude change -> 0.3 m/s
      batteryPct: 79,
    };
    const res = validatePacket(prev, next);
    expect(res.valid).toBe(true);
  });

  // ── 1. Out-of-order Timestamps ───────────────────────────────────────────────
  describe("Out-of-order timestamps", () => {
    it("rejects when next.timestamp is strictly less than prev.timestamp", () => {
      const prev = { ...baseValidPacket };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp - 500, // 500ms earlier!
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("OUT_OF_ORDER_TIMESTAMP");
    });

    it("rejects when next.timestamp is equal to prev.timestamp", () => {
      const prev = { ...baseValidPacket };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp, // Same timestamp
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("OUT_OF_ORDER_TIMESTAMP");
    });
  });

  // ── 2. Duplicate or Non-increasing Sequence Numbers ──────────────────────────
  describe("Sequence number monotonicity", () => {
    it("rejects duplicate sequence number (seq == prev.seq)", () => {
      const prev = { ...baseValidPacket, seq: 25 };
      const next = {
        ...baseValidPacket,
        seq: 25, // duplicate
        timestamp: baseValidPacket.timestamp + 1000,
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("NON_INCREASING_SEQUENCE");
    });

    it("rejects decreasing sequence number (seq < prev.seq)", () => {
      const prev = { ...baseValidPacket, seq: 30 };
      const next = {
        ...baseValidPacket,
        seq: 29, // rolled back
        timestamp: baseValidPacket.timestamp + 1000,
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("NON_INCREASING_SEQUENCE");
    });
  });

  // ── 3. Impossible Horizontal Speed (> 10 m/s) ────────────────────────────────
  describe("Horizontal speed limits", () => {
    it("rejects packet with horizontal speed > 10 m/s", () => {
      const prev = { ...baseValidPacket, x: 0, y: 0 };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 1000, // 1 sec elapsed
        x: 12.0, // 12 metres in 1s = 12 m/s (> 10 m/s)
        y: 0,
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("IMPOSSIBLE_HORIZONTAL_SPEED");
    });

    it("accepts packet with horizontal speed right at threshold (10 m/s)", () => {
      const prev = { ...baseValidPacket, x: 0, y: 0 };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 1000, // 1 sec elapsed
        x: 10.0, // 10 m in 1s = 10 m/s (<= 10 m/s)
        y: 0,
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(true);
    });

    it("evaluates horizontal speed correctly over arbitrary time delta", () => {
      const prev = { ...baseValidPacket, x: 5, y: 5 };
      // 2 seconds elapsed, 25m distance -> 12.5 m/s
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 2000,
        x: 25,
        y: 20,
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("IMPOSSIBLE_HORIZONTAL_SPEED");
    });
  });

  // ── 4. Impossible Altitude Change (> 6 m/s) ──────────────────────────────────
  describe("Altitude / vertical speed limits", () => {
    it("rejects packet with vertical speed > 6 m/s using explicit altitude", () => {
      const prev = { ...baseValidPacket, altitude: 0 };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 1000, // 1 sec elapsed
        altitude: 7.5, // 7.5 m in 1s = 7.5 m/s (> 6 m/s)
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("IMPOSSIBLE_ALTITUDE_CHANGE");
    });

    it("rejects packet with barometric pressure jump corresponding to > 6 m/s vertical speed", () => {
      // 1 hPa ~ 8.3m altitude difference. A jump of 1.5 hPa in 1s corresponds to ~12.45 m/s
      const prev = { ...baseValidPacket, altitude: undefined, pressureHpa: 1013.25 };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 1000,
        altitude: undefined,
        pressureHpa: 1011.5, // 1.75 hPa diff * 8.3m/hPa = 14.5 m/s
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("IMPOSSIBLE_ALTITUDE_CHANGE");
    });

    it("accepts vertical speed <= 6 m/s", () => {
      const prev = { ...baseValidPacket, altitude: 3.5 };
      const next = {
        ...baseValidPacket,
        seq: 11,
        timestamp: baseValidPacket.timestamp + 1000,
        altitude: 5.5, // 2 m in 1s = 2 m/s (<= 6 m/s)
      };
      const res = validatePacket(prev, next);
      expect(res.valid).toBe(true);
    });
  });

  // ── 5. NaN or Out-of-Range Values ────────────────────────────────────────────
  describe("NaN and out-of-range rejection", () => {
    it("rejects NaN coordinates", () => {
      const res = validatePacket(null, { ...baseValidPacket, x: NaN });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("NAN_OR_OUT_OF_RANGE_X");
    });

    it("rejects Infinite coordinates", () => {
      const res = validatePacket(null, { ...baseValidPacket, y: Infinity });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("NAN_OR_OUT_OF_RANGE_Y");
    });

    it("rejects out-of-range battery percentage", () => {
      expect(validatePacket(null, { ...baseValidPacket, batteryPct: -5 }).valid).toBe(false);
      expect(validatePacket(null, { ...baseValidPacket, batteryPct: 105 }).valid).toBe(false);
    });

    it("rejects out-of-range barometric pressure", () => {
      expect(validatePacket(null, { ...baseValidPacket, pressureHpa: 0 }).valid).toBe(false);
      expect(validatePacket(null, { ...baseValidPacket, pressureHpa: 1200 }).valid).toBe(false);
    });

    it("rejects out-of-range signal strength", () => {
      expect(validatePacket(null, { ...baseValidPacket, signal: 10 }).valid).toBe(false);
      expect(validatePacket(null, { ...baseValidPacket, signal: -150 }).valid).toBe(false);
    });

    it("rejects negative or non-integer sequence numbers", () => {
      expect(validatePacket(null, { ...baseValidPacket, seq: -1 }).valid).toBe(false);
      expect(validatePacket(null, { ...baseValidPacket, seq: 3.14 }).valid).toBe(false);
    });

    it("rejects invalid payload object or null", () => {
      expect(validatePacket(null, null).valid).toBe(false);
      expect(validatePacket(null, "invalid string").valid).toBe(false);
    });
  });
});
