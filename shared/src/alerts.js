import { detectManDown } from "./mandown.js";

/** Threshold in milliseconds before a soldier is marked as having lost signal (10 seconds) */
export const SIGNAL_LOST_TIMEOUT_MS = 10_000;

/** Battery percentage threshold below which a warning is triggered (< 20%) */
export const LOW_BATTERY_THRESHOLD_PCT = 20;

/**
 * Generate a v4-compliant UUID without external libraries.
 */
export function generateAlertId() {
  // Use crypto.randomUUID if available (Node 19+ and modern browsers)
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if a soldier has lost signal (no telemetry received for > 10 s).
 *
 * @param soldier Soldier state to evaluate
 * @param nowMs Current time in epoch milliseconds (defaults to Date.now())
 * @param timeoutMs Timeout in ms before declaring signal lost (default 10,000 ms)
 */
export function checkSignalLost(soldier, nowMs = Date.now(), timeoutMs = SIGNAL_LOST_TIMEOUT_MS) {
  const elapsedMs = nowMs - soldier.lastSeenAt;
  if (elapsedMs > timeoutMs) {
    const elapsedSec = Math.round(elapsedMs / 1000);
    return {
      id: generateAlertId(),
      type: "signal_lost",
      severity: "critical",
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
      message: `[${soldier.soldierId}] Signal lost: no telemetry received for ${elapsedSec}s`,
      timestamp: nowMs,
      acknowledged: false,
    };
  }
  return null;
}

/**
 * Check if a soldier's battery is critically low (< 20%).
 *
 * @param soldier Soldier state to evaluate
 * @param thresholdPct Battery threshold (default 20%)
 * @param nowMs Current time in epoch milliseconds (defaults to Date.now())
 */
export function checkLowBattery(soldier, thresholdPct = LOW_BATTERY_THRESHOLD_PCT, nowMs = Date.now()) {
  if (
    typeof soldier.batteryPct === "number" &&
    !Number.isNaN(soldier.batteryPct) &&
    soldier.batteryPct < thresholdPct
  ) {
    return {
      id: generateAlertId(),
      type: "battery_low",
      severity: "warning",
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
      message: `[${soldier.soldierId}] Low battery warning: ${soldier.batteryPct}% remaining`,
      timestamp: nowMs,
      acknowledged: false,
    };
  }
  return null;
}

/**
 * Check if a soldier moved to a new floor.
 *
 * @param soldier Current soldier state
 * @param previousFloor Previous floor label (null if first reading)
 * @param nowMs Current time in epoch milliseconds (defaults to Date.now())
 */
export function checkFloorTransition(soldier, previousFloor, nowMs = Date.now()) {
  if (previousFloor && previousFloor !== soldier.floor) {
    return {
      id: generateAlertId(),
      type: "floor_transition",
      severity: "info",
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
      message: `[${soldier.soldierId}] Floor transition: moved from ${previousFloor} to ${soldier.floor}`,
      timestamp: nowMs,
      acknowledged: false,
    };
  }
  return null;
}

/**
 * Check if a soldier is in a man-down state based on movement history.
 *
 * @param {object} soldier Soldier state to evaluate
 * @param {Array<object>} history Movement history of packets
 * @param {number} [nowMs=Date.now()] Current time in ms
 * @param {object} [options={}] Tuning options
 */
export function checkManDown(soldier, history, nowMs = Date.now(), options = {}) {
  if (!history || history.length === 0) return null;
  const result = detectManDown(history, nowMs, options);
  if (result.isManDown) {
    return {
      id: generateAlertId(),
      type: "man_down",
      severity: "critical",
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
      message: `[${soldier.soldierId}] CRITICAL: MAN DOWN — No motion detected for 20s`,
      timestamp: nowMs,
      acknowledged: false,
    };
  }
  return null;
}

/**
 * Evaluates all conditions for a soldier upon receiving an update.
 *
 * @param current Current soldier state
 * @param previousFloor Previous floor label (or null if initial)
 * @param nowMs Current time in ms
 * @param history Optional movement history for man-down evaluation
 */
export function evaluateSoldierAlerts(current, previousFloor, nowMs = Date.now(), history = null) {
  const alerts = [];

  const floorAlert = checkFloorTransition(current, previousFloor, nowMs);
  if (floorAlert) alerts.push(floorAlert);

  const batteryAlert = checkLowBattery(current, LOW_BATTERY_THRESHOLD_PCT, nowMs);
  if (batteryAlert) alerts.push(batteryAlert);

  if (history) {
    const manDownAlert = checkManDown(current, history, nowMs);
    if (manDownAlert) alerts.push(manDownAlert);
  }

  return alerts;
}

/**
 * Stateful alert engine that maintains active alerts per soldier,
 * prevents duplicate spam of active alerts, and manages acknowledgments.
 */
export class AlertsEngine {
  #activeAlerts = new Map();
  #previousFloors = new Map();
  #knownSoldiers = new Map();
  #soldierHistories = new Map();
  #resolvedAlertIds = [];

  #removeActiveAlert(key) {
    const alert = this.#activeAlerts.get(key);
    if (!alert) return false;
    this.#activeAlerts.delete(key);
    this.#resolvedAlertIds.push(alert.id);
    return true;
  }

  /**
   * Process incoming soldier update.
   */
  processTelemetry(soldier, nowMs = Date.now()) {
    const prevFloor = this.#previousFloors.get(soldier.soldierId);
    this.#knownSoldiers.set(soldier.soldierId, soldier);
    this.#previousFloors.set(soldier.soldierId, soldier.floor);

    // Track movement history for man-down detection
    let history = this.#soldierHistories.get(soldier.soldierId);
    if (!history) {
      history = [];
      this.#soldierHistories.set(soldier.soldierId, history);
    }
    history.push({
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
      x: soldier.x ?? 0,
      y: soldier.y ?? 0,
      altitude: soldier.altitude ?? 0,
      accelMagnitude: soldier.accelMagnitude ?? 1.0,
      timestamp: soldier.lastSeenAt ?? nowMs,
    });
    // Keep 40s of history
    const historyCutoff = nowMs - 40_000;
    while (history.length > 0 && history[0].timestamp < historyCutoff) {
      history.shift();
    }

    const newAlerts = [];

    // If signal was lost previously, clear the signal_lost alert
    const signalLostKey = `${soldier.soldierId}:signal_lost`;
    if (this.#activeAlerts.has(signalLostKey)) {
      this.#removeActiveAlert(signalLostKey);
    }

    // 1. Floor transition check
    const floorAlert = checkFloorTransition(soldier, prevFloor, nowMs);
    if (floorAlert) {
      newAlerts.push(floorAlert);
      // Floor transitions are informational events, stored with unique timestamp keys
      this.#activeAlerts.set(`${soldier.soldierId}:floor_transition:${nowMs}`, floorAlert);
    }

    // 2. Battery check
    const batteryKey = `${soldier.soldierId}:battery_low`;
    if (soldier.batteryPct < LOW_BATTERY_THRESHOLD_PCT) {
      if (!this.#activeAlerts.has(batteryKey)) {
        const alert = checkLowBattery(soldier, LOW_BATTERY_THRESHOLD_PCT, nowMs);
        if (alert) {
          this.#activeAlerts.set(batteryKey, alert);
          newAlerts.push(alert);
        }
      }
    } else {
      // Cleared / recharged
      this.#removeActiveAlert(batteryKey);
    }

    // 3. Man Down check
    const manDownKey = `${soldier.soldierId}:man_down`;
    const manDownCheck = detectManDown(history, nowMs);
    if (manDownCheck.isManDown) {
      if (!this.#activeAlerts.has(manDownKey)) {
        const alert = {
          id: generateAlertId(),
          type: "man_down",
          severity: "critical",
          soldierId: soldier.soldierId,
          teamId: soldier.teamId,
          message: `[${soldier.soldierId}] CRITICAL: MAN DOWN — No motion detected for 20s`,
          timestamp: nowMs,
          acknowledged: false,
        };
        this.#activeAlerts.set(manDownKey, alert);
        newAlerts.push(alert);
      }
    } else if (
      manDownCheck.reason === "POSITION_DELTA_EXCEEDED" ||
      manDownCheck.reason === "ACCEL_VARIANCE_TOO_HIGH"
    ) {
      // Resumed motion clears man down
      this.#removeActiveAlert(manDownKey);
    }

    return newAlerts;
  }

  /**
   * Scan all known soldiers for signal timeout (> 10s).
   * Call periodically (e.g. every second).
   */
  checkStaleSoldiers(nowMs = Date.now()) {
    const newAlerts = [];

    for (const [soldierId, soldier] of this.#knownSoldiers.entries()) {
      const key = `${soldierId}:signal_lost`;
      const elapsed = nowMs - soldier.lastSeenAt;

      if (elapsed > SIGNAL_LOST_TIMEOUT_MS) {
        if (!this.#activeAlerts.has(key)) {
          const alert = checkSignalLost(soldier, nowMs, SIGNAL_LOST_TIMEOUT_MS);
          if (alert) {
            this.#activeAlerts.set(key, alert);
            newAlerts.push(alert);
          }
        }
      } else {
        this.#removeActiveAlert(key);
      }
    }

    return newAlerts;
  }

  getActiveAlerts() {
    return Array.from(this.#activeAlerts.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  restoreActiveAlerts(alerts = []) {
    for (const alert of alerts) {
      const soldierId = alert.soldierId;
      if (!soldierId || !alert.id || alert.resolved) continue;
      let key;
      if (alert.type === "signal_lost" || alert.type === "battery_low" || alert.type === "man_down") {
        key = `${soldierId}:${alert.type}`;
      } else {
        key = `${soldierId}:${alert.type}:${alert.timestamp}:${alert.id}`;
      }
      this.#activeAlerts.set(key, { ...alert });
    }
  }

  drainResolvedAlertIds() {
    const ids = this.#resolvedAlertIds;
    this.#resolvedAlertIds = [];
    return ids;
  }

  acknowledgeAlert(id, by = "commander", nowMs = Date.now()) {
    for (const alert of this.#activeAlerts.values()) {
      if (alert.id === id) {
        alert.acknowledged = true;
        alert.acknowledgedBy = by;
        alert.acknowledgedAt = nowMs;
        return true;
      }
    }
    return false;
  }

  clearAlert(id) {
    for (const [key, alert] of this.#activeAlerts.entries()) {
      if (alert.id === id) {
        this.#activeAlerts.delete(key);
        this.#resolvedAlertIds.push(alert.id);
        return true;
      }
    }
    return false;
  }
}
