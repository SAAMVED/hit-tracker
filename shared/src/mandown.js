/** Time window required to assess stillness for man-down condition (20 seconds) */
export const MAN_DOWN_WINDOW_MS = 20_000;

/** Maximum position displacement allowed during stillness window (metres) */
export const MAN_DOWN_MAX_POS_DELTA_M = 0.5;

/** Maximum variance of accelerometer magnitude allowed to be considered "near zero" */
export const MAN_DOWN_MAX_ACCEL_VARIANCE = 0.005;

/** Maximum time elapsed since last received packet for radio signal to be considered live (10 seconds) */
export const MAN_DOWN_SIGNAL_LIVE_TIMEOUT_MS = 10_000;

/** Threshold for sudden motion / impact spike before stillness (e.g. >= 2.0g) */
export const MAN_DOWN_SPIKE_THRESHOLD = 2.0;

/** Maximum acceptable gap between consecutive telemetry packets in the window (ms) */
export const MAN_DOWN_MAX_PACKET_GAP_MS = 3_000;

/**
 * Pure function to detect a man-down situation from a soldier's recent telemetry history.
 *
 * Conditions for MAN DOWN:
 * 1. Radio signal is still live (most recent packet received within signalLiveTimeoutMs).
 * 2. Position displacement across the 20-second window is strictly under 0.5 metres.
 * 3. Acceleration magnitude variance over the window is near zero (<= 0.005).
 * 4. Telemetry history covers at least 20 seconds without large signal drops.
 * 5. If options.requireSpike is enabled, requires an impact/spike prior to or at start of stillness.
 *
 * @param {Array<object>} history - Array of recent telemetry packets/states for the soldier, ordered chronologically
 * @param {number} [now=Date.now()] - Current epoch timestamp in milliseconds
 * @param {object} [options={}] - Configurable thresholds and tuning options
 * @returns {{ isManDown: boolean, reason?: string, details?: object }}
 */
export function detectManDown(history, now = Date.now(), options = {}) {
  const windowMs = options.windowMs ?? MAN_DOWN_WINDOW_MS;
  const maxPosDeltaM = options.maxPosDeltaM ?? MAN_DOWN_MAX_POS_DELTA_M;
  const maxAccelVariance = options.maxAccelVariance ?? MAN_DOWN_MAX_ACCEL_VARIANCE;
  const signalLiveTimeoutMs = options.signalLiveTimeoutMs ?? MAN_DOWN_SIGNAL_LIVE_TIMEOUT_MS;
  const maxPacketGapMs = options.maxPacketGapMs ?? MAN_DOWN_MAX_PACKET_GAP_MS;
  const requireSpike = options.requireSpike ?? false;
  const spikeThreshold = options.spikeThreshold ?? MAN_DOWN_SPIKE_THRESHOLD;

  if (!Array.isArray(history) || history.length === 0) {
    return { isManDown: false, reason: "NO_HISTORY" };
  }

  // 1. Radio signal check: Most recent packet must be within signalLiveTimeoutMs of now
  const latestPkt = history[history.length - 1];
  const latestTs = latestPkt.timestamp ?? latestPkt.lastSeenAt ?? now;
  if (now - latestTs > signalLiveTimeoutMs) {
    return { isManDown: false, reason: "SIGNAL_NOT_LIVE" };
  }

  // Filter history to the assessment window [now - windowMs, now]
  const windowStart = now - windowMs;
  const windowPackets = history.filter((p) => {
    const ts = p.timestamp ?? p.lastSeenAt;
    return ts !== undefined && ts >= windowStart && ts <= now;
  });

  // 2. Minimum sample count and coverage check
  // For a 20s window at 1 Hz, we need at least 10 samples and coverage spanning at least (windowMs - 1500) ms
  if (windowPackets.length < 10) {
    return { isManDown: false, reason: "INSUFFICIENT_SAMPLES" };
  }

  const oldestInWindow = windowPackets[0];
  const oldestTs = oldestInWindow.timestamp ?? oldestInWindow.lastSeenAt;
  const coveredDurationMs = latestTs - oldestTs;

  if (coveredDurationMs < windowMs - 1500) {
    return { isManDown: false, reason: "WINDOW_TOO_SHORT" };
  }

  // Check that packets were regularly received (no communication blackouts during the window)
  for (let i = 1; i < windowPackets.length; i++) {
    const prevTs = windowPackets[i - 1].timestamp ?? windowPackets[i - 1].lastSeenAt;
    const currTs = windowPackets[i].timestamp ?? windowPackets[i].lastSeenAt;
    if (currTs - prevTs > maxPacketGapMs) {
      return { isManDown: false, reason: "PACKET_GAP_EXCEEDED" };
    }
  }

  // 3. Position displacement check: every packet in the window must stay within maxPosDeltaM of the anchor
  const anchorX = oldestInWindow.x;
  const anchorY = oldestInWindow.y;

  let maxDispM = 0;
  for (const pkt of windowPackets) {
    const dist = Math.hypot(pkt.x - anchorX, pkt.y - anchorY);
    if (dist > maxDispM) maxDispM = dist;
    if (dist >= maxPosDeltaM) {
      return {
        isManDown: false,
        reason: "POSITION_DELTA_EXCEEDED",
        details: { maxDispM, limit: maxPosDeltaM },
      };
    }
  }

  // 4. Acceleration variance check over the stillness window
  const accels = windowPackets.map((p) =>
    typeof p.accelMagnitude === "number" && !Number.isNaN(p.accelMagnitude)
      ? p.accelMagnitude
      : 1.0
  );

  const meanAccel = accels.reduce((sum, a) => sum + a, 0) / accels.length;
  const variance =
    accels.reduce((sum, a) => sum + (a - meanAccel) ** 2, 0) / accels.length;

  if (variance > maxAccelVariance) {
    return {
      isManDown: false,
      reason: "ACCEL_VARIANCE_TOO_HIGH",
      details: { variance, limit: maxAccelVariance },
    };
  }

  // 5. Sudden motion spike check: spike must occur prior to or near the start of the stillness window
  if (requireSpike) {
    const priorPackets = history.filter((p) => {
      const ts = p.timestamp ?? p.lastSeenAt;
      return ts !== undefined && ts <= windowStart + 1000;
    });
    const hasSpike = priorPackets.some((p) => (p.accelMagnitude ?? 0) >= spikeThreshold);
    if (!hasSpike) {
      return { isManDown: false, reason: "NO_MOTION_SPIKE_DETECTED" };
    }
  }

  return {
    isManDown: true,
    reason: "MAN_DOWN_CONFIRMED",
    details: {
      coveredDurationMs,
      maxDispM: Math.round(maxDispM * 100) / 100,
      variance: Math.round(variance * 10000) / 10000,
    },
  };
}
