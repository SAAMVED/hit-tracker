import { describe, expect, it } from "vitest";
import {
  AlertsEngine,
  checkFloorTransition,
  checkLowBattery,
  checkSignalLost,
  evaluateSoldierAlerts,
  generateAlertId,
} from "../src/alerts.js";
import { AlertSchema, type FloorLabel } from "../src/schemas.js";

describe("Alerts Engine (pure functions)", () => {
  const baseSoldier = {
    soldierId: "A1",
    teamId: "Alpha",
    batteryPct: 85,
    lastSeenAt: 1700000000000,
    floor: "G" as FloorLabel,
  };

  it("generateAlertId returns a valid UUID", () => {
    const id = generateAlertId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  describe("SIGNAL LOST (critical)", () => {
    it("returns null when telemetry was received within 10 seconds", () => {
      const now = baseSoldier.lastSeenAt + 5000; // 5s ago
      const alert = checkSignalLost(baseSoldier, now);
      expect(alert).toBeNull();
    });

    it("returns critical alert when no telemetry received for more than 10 seconds", () => {
      const now = baseSoldier.lastSeenAt + 12000; // 12s ago (> 10s)
      const alert = checkSignalLost(baseSoldier, now);
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe("signal_lost");
      expect(alert?.severity).toBe("critical");
      expect(alert?.soldierId).toBe("A1");
      expect(alert?.teamId).toBe("Alpha");
      expect(alert?.acknowledged).toBe(false);

      // Validate schema conformance
      expect(AlertSchema.safeParse(alert).success).toBe(true);
    });

    it("boundary: returns null at exactly 10,000 ms, triggers at 10,001 ms", () => {
      expect(checkSignalLost(baseSoldier, baseSoldier.lastSeenAt + 10000)).toBeNull();
      expect(checkSignalLost(baseSoldier, baseSoldier.lastSeenAt + 10001)).not.toBeNull();
    });
  });

  describe("LOW BATTERY (warning)", () => {
    it("returns null when battery is >= 20%", () => {
      expect(checkLowBattery({ ...baseSoldier, batteryPct: 20 })).toBeNull();
      expect(checkLowBattery({ ...baseSoldier, batteryPct: 85 })).toBeNull();
    });

    it("triggers warning alert when battery drops strictly below 20%", () => {
      const alert = checkLowBattery({ ...baseSoldier, batteryPct: 19 });
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe("battery_low");
      expect(alert?.severity).toBe("warning");
      expect(alert?.message).toContain("19%");
      expect(AlertSchema.safeParse(alert).success).toBe(true);
    });

    it("triggers for critically depleted battery at 0%", () => {
      const alert = checkLowBattery({ ...baseSoldier, batteryPct: 0 });
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe("warning");
    });
  });

  describe("FLOOR TRANSITION (info)", () => {
    it("returns null when floor is identical to previous", () => {
      expect(checkFloorTransition(baseSoldier, "G")).toBeNull();
    });

    it("returns null when previous floor is undefined (first packet)", () => {
      expect(checkFloorTransition(baseSoldier, undefined)).toBeNull();
    });

    it("triggers info alert when floor changed from previous", () => {
      const alert = checkFloorTransition({ ...baseSoldier, floor: "1" }, "G");
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe("floor_transition");
      expect(alert?.severity).toBe("info");
      expect(alert?.message).toContain("G to 1");
      expect(AlertSchema.safeParse(alert).success).toBe(true);
    });
  });

  describe("evaluateSoldierAlerts (composite)", () => {
    it("can detect simultaneous floor transition and low battery", () => {
      const current = { ...baseSoldier, floor: "2" as FloorLabel, batteryPct: 15 };
      const alerts = evaluateSoldierAlerts(current, "1");
      expect(alerts).toHaveLength(2);
      expect(alerts.map((a) => a.type)).toContain("floor_transition");
      expect(alerts.map((a) => a.type)).toContain("battery_low");
    });
  });
});

describe("AlertsEngine (stateful manager)", () => {
  it("tracks soldiers, evaluates transitions, and detects stale soldiers", () => {
    const engine = new AlertsEngine();
    let now = 1700000000000;

    // First packet for B2 on Ground floor
    const alerts1 = engine.processTelemetry(
      { soldierId: "B2", teamId: "Bravo", batteryPct: 80, lastSeenAt: now, floor: "G" },
      now
    );
    expect(alerts1).toHaveLength(0); // No alerts on initial entry

    // Next packet: B2 transitions to Floor 1
    now += 5000;
    const alerts2 = engine.processTelemetry(
      { soldierId: "B2", teamId: "Bravo", batteryPct: 80, lastSeenAt: now, floor: "1" },
      now
    );
    expect(alerts2).toHaveLength(1);
    expect(alerts2[0].type).toBe("floor_transition");

    // Next packet: B2 battery drops to 18%
    now += 1000;
    const alerts3 = engine.processTelemetry(
      { soldierId: "B2", teamId: "Bravo", batteryPct: 18, lastSeenAt: now, floor: "1" },
      now
    );
    expect(alerts3).toHaveLength(1);
    expect(alerts3[0].type).toBe("battery_low");

    // Subsequent packet with battery still 18%: no duplicate alert spam!
    now += 1000;
    const alerts4 = engine.processTelemetry(
      { soldierId: "B2", teamId: "Bravo", batteryPct: 18, lastSeenAt: now, floor: "1" },
      now
    );
    expect(alerts4).toHaveLength(0);

    // Stale check after 5s: not stale yet (6s since lastSeenAt)
    now += 5000;
    expect(engine.checkStaleSoldiers(now)).toHaveLength(0);

    // Stale check after 15s since lastSeenAt (> 10s): signal_lost triggers!
    now += 10000;
    const staleAlerts = engine.checkStaleSoldiers(now);
    expect(staleAlerts).toHaveLength(1);
    expect(staleAlerts[0].type).toBe("signal_lost");
    expect(staleAlerts[0].severity).toBe("critical");

    // Commander acknowledges the critical alert
    const ackSuccess = engine.acknowledgeAlert(staleAlerts[0].id, "commander", now);
    expect(ackSuccess).toBe(true);

    const active = engine.getActiveAlerts();
    const acked = active.find((a) => a.id === staleAlerts[0].id);
    expect(acked?.acknowledged).toBe(true);
    expect(acked?.acknowledgedBy).toBe("commander");

    // When soldier resumes sending packets, signal_lost is cleared
    now += 2000;
    engine.processTelemetry(
      { soldierId: "B2", teamId: "Bravo", batteryPct: 18, lastSeenAt: now, floor: "1" },
      now
    );
    const activeAfterResume = engine.getActiveAlerts();
    expect(activeAfterResume.find((a) => a.type === "signal_lost")).toBeUndefined();
  });
});
