import { SIGNAL_LOST_TIMEOUT_MS } from "./alerts.js";

/**
 * Calculate mission summaries from accepted telemetry packets.
 * Coordinates are treated as metres, matching the telemetry schema and simulator.
 * Distance is horizontal (x/y) only; vertical travel is not included.
 *
 * Packets with invalid timestamps are ignored. Packets are sorted chronologically;
 * for duplicate soldier/timestamp pairs, the last packet in the input is retained.
 * A floor is credited from a packet until the next packet, but no longer than the
 * signal timeout, because the soldier's position is unknown beyond that point.
 *
 * @param {{ mission: object, telemetry: object[], asOf?: number }} input
 */
export function calculateMissionAnalytics({ mission, telemetry, asOf }) {
  const missionStart = finiteNumber(mission?.startedAt ?? mission?.started_at);
  const missionEnd = finiteNumber(mission?.endedAt ?? mission?.ended_at);
  const activeEnd = missionEnd ?? finiteNumber(asOf);
  const reportEnd = activeEnd ?? missionStart;

  const packetGroups = new Map();
  for (const packet of Array.isArray(telemetry) ? telemetry : []) {
    const soldierId = packet?.soldierId ?? packet?.soldier_id;
    const timestamp = finiteNumber(packet?.timestamp ?? packet?.ts);
    if (typeof soldierId !== "string" || timestamp === null) continue;
    if (missionStart !== null && timestamp < missionStart) continue;
    if (reportEnd !== null && timestamp > reportEnd) continue;
    if (!packetGroups.has(soldierId)) packetGroups.set(soldierId, []);
    packetGroups.get(soldierId).push({ ...packet, soldierId, timestamp, _inputIndex: packetGroups.get(soldierId).length });
  }

  const soldiers = [];
  for (const [soldierId, packets] of packetGroups) {
    packets.sort((a, b) => a.timestamp - b.timestamp || a._inputIndex - b._inputIndex);
    const uniquePackets = packets.filter((packet, index) =>
      index === packets.length - 1 || packet.timestamp !== packets[index + 1].timestamp
    );
    const teamId = uniquePackets.find((packet) => packet.teamId ?? packet.team_id)?.teamId
      ?? uniquePackets.find((packet) => packet.team_id)?.team_id
      ?? null;

    const timePerFloorMs = {};
    const floorTransitions = [];
    const signalLostIntervals = [];
    let distanceMeters = 0;
    let previousPosition = null;

    for (let i = 0; i < uniquePackets.length; i++) {
      const packet = uniquePackets[i];
      const next = uniquePackets[i + 1];
      const floor = packet.estimatedFloor ?? packet.floor ?? null;
      if (next && floor !== null && floor !== undefined && next.timestamp > packet.timestamp) {
        const intervalEnd = Math.min(next.timestamp, packet.timestamp + SIGNAL_LOST_TIMEOUT_MS);
        const duration = Math.max(0, intervalEnd - packet.timestamp);
        if (duration > 0) timePerFloorMs[floor] = (timePerFloorMs[floor] ?? 0) + duration;
      } else if (!next && reportEnd !== null && floor !== null && floor !== undefined) {
        const intervalEnd = Math.min(reportEnd, packet.timestamp + SIGNAL_LOST_TIMEOUT_MS);
        const duration = Math.max(0, intervalEnd - packet.timestamp);
        if (duration > 0) timePerFloorMs[floor] = (timePerFloorMs[floor] ?? 0) + duration;
      }

      if (next && floor !== null && floor !== undefined) {
        const nextFloor = next.estimatedFloor ?? next.floor ?? null;
        if (nextFloor !== null && nextFloor !== undefined && nextFloor !== floor) {
          floorTransitions.push({ timestamp: next.timestamp, fromFloor: floor, toFloor: nextFloor });
        }
      }

      if (next && next.timestamp - packet.timestamp > SIGNAL_LOST_TIMEOUT_MS) {
        const startedAt = packet.timestamp + SIGNAL_LOST_TIMEOUT_MS;
        signalLostIntervals.push({
          startedAt,
          endedAt: next.timestamp,
          durationMs: next.timestamp - startedAt,
        });
      } else if (!next && reportEnd !== null && reportEnd - packet.timestamp > SIGNAL_LOST_TIMEOUT_MS) {
        const startedAt = packet.timestamp + SIGNAL_LOST_TIMEOUT_MS;
        signalLostIntervals.push({
          startedAt,
          endedAt: reportEnd,
          durationMs: reportEnd - startedAt,
        });
      }

      const x = finiteNumber(packet.x);
      const y = finiteNumber(packet.y);
      if (x !== null && y !== null) {
        if (previousPosition && packet.timestamp - previousPosition.timestamp <= SIGNAL_LOST_TIMEOUT_MS) {
          distanceMeters += Math.hypot(x - previousPosition.x, y - previousPosition.y);
        }
        previousPosition = { x, y, timestamp: packet.timestamp };
      } else {
        previousPosition = null;
      }
    }

    soldiers.push({
      soldierId,
      teamId,
      timePerFloorMs,
      distanceMeters,
      floorTransitionCount: floorTransitions.length,
      floorTransitions,
      signalLostIntervals,
      longestSignalLostMs: signalLostIntervals.reduce((longest, interval) => Math.max(longest, interval.durationMs), 0),
    });
  }

  const totals = soldiers.reduce((result, soldier) => ({
    soldierCount: result.soldierCount + 1,
    distanceMeters: result.distanceMeters + soldier.distanceMeters,
    floorTransitionCount: result.floorTransitionCount + soldier.floorTransitionCount,
    longestSignalLostMs: Math.max(result.longestSignalLostMs, soldier.longestSignalLostMs),
  }), { soldierCount: 0, distanceMeters: 0, floorTransitionCount: 0, longestSignalLostMs: 0 });

  return {
    mission: mission ? {
      id: mission.id,
      name: mission.name,
      startedAt: mission.startedAt ?? mission.started_at ?? null,
      endedAt: mission.endedAt ?? mission.ended_at ?? null,
      status: mission.status ?? null,
    } : null,
    generatedAt: finiteNumber(asOf),
    totals,
    soldiers,
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
