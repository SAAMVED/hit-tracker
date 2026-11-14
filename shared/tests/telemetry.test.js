import { describe, it, expect } from "vitest";
import { TelemetryPacketSchema } from "../src/schemas.js";

// ─── Telemetry Packet Schema Tests ───────────────────────────────────────────

describe("TelemetryPacketSchema", () => {
  const validPacket = {
    soldierId: "A1",
    teamId: "Alpha",
    seq: 42,
    timestamp: 1700000000000,
    x: 12.5,
    y: 8.3,
    pressureHpa: 1013.25,
    batteryPct: 87,
    signal: -72,
  };

  it("accepts a valid telemetry packet", () => {
    const result = TelemetryPacketSchema.safeParse(validPacket);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.soldierId).toBe("A1");
      expect(result.data.teamId).toBe("Alpha");
    }
  });

  it("rejects a packet with missing required fields", () => {
    const { soldierId: _dropped, ...incomplete } = validPacket;
    const result = TelemetryPacketSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects a negative sequence number", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, seq: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects battery percentage above 100", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, batteryPct: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects battery percentage below 0", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, batteryPct: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a positive signal value (must be <= 0 dBm)", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, signal: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects pressure above 1100 hPa", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, pressureHpa: 1200 });
    expect(result.success).toBe(false);
  });

  it("rejects non-finite x coordinate (Infinity)", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, x: Infinity });
    expect(result.success).toBe(false);
  });

  it("accepts boundary values (batteryPct 0 and 100)", () => {
    expect(TelemetryPacketSchema.safeParse({ ...validPacket, batteryPct: 0 }).success).toBe(true);
    expect(TelemetryPacketSchema.safeParse({ ...validPacket, batteryPct: 100 }).success).toBe(true);
  });

  it("accepts signal exactly at 0 dBm", () => {
    const result = TelemetryPacketSchema.safeParse({ ...validPacket, signal: 0 });
    expect(result.success).toBe(true);
  });
});
