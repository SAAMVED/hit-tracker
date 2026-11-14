import { describe, expect, it } from "vitest";
import {
  detectManDown,
  MAN_DOWN_WINDOW_MS,
  MAN_DOWN_MAX_POS_DELTA_M,
  MAN_DOWN_MAX_ACCEL_VARIANCE,
} from "../src/mandown.js";
import { AlertsEngine } from "../src/alerts.js";

describe("Man-Down (No-Motion) Detection", () => {
  const baseNow = 1700000030000;

  // Helper to build 21 seconds of 1 Hz packets
  function buildPackets(count, transform) {
    const start = baseNow - (count - 1) * 1000;
    return Array.from({ length: count }, (_, i) => {
      const ts = start + i * 1000;
      const base = {
        soldierId: "C2",
        teamId: "Charlie",
        x: 10.0,
        y: 10.0,
        accelMagnitude: 1.0,
        timestamp: ts,
        lastSeenAt: ts,
      };
      return transform ? transform(base, i) : base;
    });
  }

  it("flags MAN DOWN when soldier is still (< 0.5m) and acceleration variance is near zero for 20s", () => {
    // 21 seconds of motionless telemetry with perfectly flat accel = 1.0
    const history = buildPackets(21);
    const result = detectManDown(history, baseNow);

    expect(result.isManDown).toBe(true);
    expect(result.reason).toBe("MAN_DOWN_CONFIRMED");
    expect(result.details?.maxDispM).toBeLessThanOrEqual(MAN_DOWN_MAX_POS_DELTA_M);
    expect(result.details?.variance).toBeLessThanOrEqual(MAN_DOWN_MAX_ACCEL_VARIANCE);
  });

  it("does NOT flag MAN DOWN if position displacement exceeds 0.5m", () => {
    // Soldier walking across the room (moving 0.1m every second = 2.0m total)
    const history = buildPackets(21, (p, i) => ({
      ...p,
      x: 10.0 + i * 0.1,
    }));
    const result = detectManDown(history, baseNow);

    expect(result.isManDown).toBe(false);
    expect(result.reason).toBe("POSITION_DELTA_EXCEEDED");
  });

  it("does NOT flag MAN DOWN if acceleration variance is high (> 0.005)", () => {
    // Soldier standing still in position but moving hands / weapon (high acceleration variance)
    const history = buildPackets(21, (p, i) => ({
      ...p,
      accelMagnitude: 1.0 + (i % 2 === 0 ? 0.2 : -0.2), // variance ~0.04 >> 0.005
    }));
    const result = detectManDown(history, baseNow);

    expect(result.isManDown).toBe(false);
    expect(result.reason).toBe("ACCEL_VARIANCE_TOO_HIGH");
  });

  it("does NOT flag MAN DOWN if radio signal has been lost (> 10s)", () => {
    // Last packet received 15 seconds ago
    const history = buildPackets(21, (p) => ({
      ...p,
      timestamp: p.timestamp - 15000,
      lastSeenAt: p.lastSeenAt - 15000,
    }));
    const result = detectManDown(history, baseNow);

    expect(result.isManDown).toBe(false);
    expect(result.reason).toBe("SIGNAL_NOT_LIVE");
  });

  it("does NOT flag MAN DOWN if observed window is too short (< 20s)", () => {
    // 12 seconds of telemetry (sufficient sample count >= 10, but duration 11s < 20s)
    const history = buildPackets(12);
    const result = detectManDown(history, baseNow);

    expect(result.isManDown).toBe(false);
    expect(result.reason).toBe("WINDOW_TOO_SHORT");
  });

  it("respects requireSpike option to prevent false positives when holding position", () => {
    // Holding position smoothly without an impact spike
    const historyWithoutSpike = buildPackets(21);
    const resultNoSpike = detectManDown(historyWithoutSpike, baseNow, { requireSpike: true });
    expect(resultNoSpike.isManDown).toBe(false);
    expect(resultNoSpike.reason).toBe("NO_MOTION_SPIKE_DETECTED");

    // With impact spike before the stillness window (packet 0 at -21s has spike, packets 1-21 are stillness)
    const start = baseNow - 21000;
    const historyWithSpike = Array.from({ length: 22 }, (_, i) => {
      const ts = start + i * 1000;
      return {
        soldierId: "C2",
        teamId: "Charlie",
        x: 10.0,
        y: 10.0,
        accelMagnitude: i === 0 ? 3.5 : 1.0,
        timestamp: ts,
        lastSeenAt: ts,
      };
    });
    const resultWithSpike = detectManDown(historyWithSpike, baseNow, { requireSpike: true });
    expect(resultWithSpike.isManDown).toBe(true);
  });

  describe("AlertsEngine Integration", () => {
    it("generates a critical man_down alert when condition is met and avoids duplicate alerts", () => {
      const engine = new AlertsEngine();
      const soldier = {
        soldierId: "C2",
        teamId: "Charlie",
        batteryPct: 90,
        floor: "G",
        x: 10.0,
        y: 10.0,
        accelMagnitude: 1.0,
      };

      // Feed 21 packets, 1 per second
      let alertsGenerated = [];
      for (let sec = 0; sec <= 21; sec++) {
        const ts = baseNow - (21 - sec) * 1000;
        const alerts = engine.processTelemetry(
          { ...soldier, lastSeenAt: ts },
          ts
        );
        if (alerts.length > 0) {
          alertsGenerated.push(...alerts);
        }
      }

      const manDownAlerts = alertsGenerated.filter((a) => a.type === "man_down");
      expect(manDownAlerts.length).toBe(1);
      expect(manDownAlerts[0].severity).toBe("critical");
      expect(manDownAlerts[0].soldierId).toBe("C2");

      // Verify active alerts contains man_down
      const active = engine.getActiveAlerts();
      expect(active.some((a) => a.type === "man_down")).toBe(true);

      // Next tick: soldier starts moving again (x jumps by 2m)
      const moveTs = baseNow + 1000;
      engine.processTelemetry(
        { ...soldier, x: 12.0, lastSeenAt: moveTs },
        moveTs
      );

      // Active alert should be cleared
      const activeAfterMove = engine.getActiveAlerts();
      expect(activeAfterMove.some((a) => a.type === "man_down")).toBe(false);
    });
  });
});
