import { describe, it, expect } from "vitest";
import {
  AlertSchema,
  SoldierSchema,
  TeamSchema,
  LoginRequestSchema,
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
