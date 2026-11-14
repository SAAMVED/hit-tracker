import { describe, it, expect } from "vitest";
import {
  AlertSchema,
  SoldierSchema,
  TeamSchema,
  LoginRequestSchema,
  CalibrationSchema,
  MissionSchema,
  RejectedPacketSchema,
  TelemetryPacketSchema,
} from "../src/schemas.js";

// ─── Alert Schema Tests ───────────────────────────────────────────────────────

describe("AlertSchema", () => {
  const validAlert = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "battery_low",
    severity: "warning",
    soldierId: "B2",
    teamId: "Bravo",
    message: "Battery at 12%",
    timestamp: 1700000000000,
    acknowledged: false,
  };

  it("accepts a valid alert", () => {
    expect(AlertSchema.safeParse(validAlert).success).toBe(true);
  });

  it("rejects an invalid alert type", () => {
    expect(AlertSchema.safeParse({ ...validAlert, type: "explosion" }).success).toBe(false);
  });

  it("rejects an invalid severity", () => {
    expect(AlertSchema.safeParse({ ...validAlert, severity: "extreme" }).success).toBe(false);
  });

  it("requires a valid UUID for id", () => {
    expect(AlertSchema.safeParse({ ...validAlert, id: "not-a-uuid" }).success).toBe(false);
  });
});

// ─── Soldier Schema Tests ─────────────────────────────────────────────────────

describe("SoldierSchema", () => {
  const validSoldier = {
    id: "C3",
    name: "Havildar Rajesh Kumar",
    teamId: "Charlie",
    status: "active",
    floor: 2,
  };

  it("accepts a valid soldier", () => {
    expect(SoldierSchema.safeParse(validSoldier).success).toBe(true);
  });

  it("defaults status to 'unknown' when omitted", () => {
    const { status: _s, ...noStatus } = validSoldier;
    const result = SoldierSchema.safeParse(noStatus);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("unknown");
  });

  it("rejects an invalid status", () => {
    expect(SoldierSchema.safeParse({ ...validSoldier, status: "retired" }).success).toBe(false);
  });
});

// ─── Team Schema Tests ────────────────────────────────────────────────────────

describe("TeamSchema", () => {
  it("accepts a valid team", () => {
    const team = {
      id: "Alpha",
      name: "Alpha Team",
      colour: "#ef4444",
      soldierIds: ["A1", "A2", "A3", "A4"],
    };
    expect(TeamSchema.safeParse(team).success).toBe(true);
  });

  it("rejects unknown team ids", () => {
    expect(
      TeamSchema.safeParse({ id: "Echo", name: "Echo Team", colour: "#fff", soldierIds: [] }).success
    ).toBe(false);
  });
});

// ─── LoginRequest Tests ───────────────────────────────────────────────────────

describe("LoginRequestSchema", () => {
  it("accepts valid credentials", () => {
    expect(LoginRequestSchema.safeParse({ username: "commander", password: "secret" }).success).toBe(
      true
    );
  });

  it("rejects empty username", () => {
    expect(LoginRequestSchema.safeParse({ username: "", password: "secret" }).success).toBe(false);
  });
});

// ─── Calibration Schema Tests ────────────────────────────────────────────────

describe("CalibrationSchema", () => {
  it("defaults to identity transformation when empty object passed", () => {
    const res = CalibrationSchema.safeParse({});
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.translation).toEqual({ x: 0, y: 0, z: 0 });
      expect(res.data.rotation).toEqual({ x: 0, y: 0, z: 0 });
      expect(res.data.scale).toEqual({ x: 1, y: 1, z: 1 });
    }
  });

  it("accepts custom translation, rotation and scale", () => {
    const custom = {
      translation: { x: 5.5, y: -2.0, z: 1.0 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    };
    const res = CalibrationSchema.safeParse(custom);
    expect(res.success).toBe(true);
  });

  it("rejects non-positive scale", () => {
    const invalid = { scale: { x: -1, y: 1, z: 1 } };
    expect(CalibrationSchema.safeParse(invalid).success).toBe(false);
  });
});

// ─── Mission Schema Tests ────────────────────────────────────────────────────

describe("MissionSchema", () => {
  it("accepts valid active mission", () => {
    const mission = {
      id: "mission-01",
      name: "Operation Black Tornado",
      startedAt: 1700000000000,
      status: "active",
    };
    expect(MissionSchema.safeParse(mission).success).toBe(true);
  });

  it("rejects invalid status", () => {
    const mission = {
      id: "mission-01",
      name: "Operation Black Tornado",
      startedAt: 1700000000000,
      status: "aborted",
    };
    expect(MissionSchema.safeParse(mission).success).toBe(false);
  });
});

// ─── RejectedPacketSchema Tests ──────────────────────────────────────────────

describe("RejectedPacketSchema", () => {
  it("accepts valid rejected packet entry", () => {
    const entry = {
      soldierId: "A4",
      reason: "IMPOSSIBLE_HORIZONTAL_SPEED",
      rawPayload: '{"x": 100}',
      timestamp: 1700000000000,
    };
    expect(RejectedPacketSchema.safeParse(entry).success).toBe(true);
  });
});

// ─── TelemetryPacketSchema Accel Tests ───────────────────────────────────────

describe("TelemetryPacketSchema with accelMagnitude", () => {
  const basePkt = {
    soldierId: "A1",
    teamId: "Alpha",
    seq: 1,
    timestamp: 1700000000000,
    x: 0,
    y: 0,
    pressureHpa: 1013.25,
    batteryPct: 90,
    signal: -60,
  };

  it("accepts packet with valid accelMagnitude", () => {
    expect(TelemetryPacketSchema.safeParse({ ...basePkt, accelMagnitude: 1.05 }).success).toBe(true);
  });

  it("rejects negative accelMagnitude", () => {
    expect(TelemetryPacketSchema.safeParse({ ...basePkt, accelMagnitude: -0.5 }).success).toBe(false);
  });
});
