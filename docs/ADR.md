# Architecture Decision Records

## ADR-001: Offline-First with SQLite

**Status:** Accepted  
**Date:** 2024-11-14

### Context
HIT-Tracker is deployed in forward operating environments with no internet access. The system must operate completely offline.

### Decision
- SQLite (via better-sqlite3) for all persistence – no external DB needed.
- WebSocket (ws) for real-time telemetry – no MQTT broker.
- JWT (jsonwebtoken + bcryptjs) for auth stored locally.
- All npm packages bundled at install time, no CDN references.

### Consequences
- Simple deployment: single Node process + SQLite file.
- No horizontal scaling (acceptable for single-ICP use case).

---

## ADR-002: Monorepo with npm Workspaces

**Status:** Accepted

### Decision
npm workspaces with four packages: `shared`, `server`, `client`, `simulator`.

- `shared` holds all Zod schemas and pure business logic (barometric estimation).  
- Server and client import from `shared` directly (TypeScript path resolution).  
- Simulator is a standalone Node process.

---

## ADR-003: Barometric Floor Estimation

**Status:** Accepted for legacy compatibility; superseded for live estimation by ADR-004
**Date:** 2024-11-14

### Context
The initial floor-estimation design used a linear pressure-to-height approximation and a nominal floor spacing. The current live estimator has since moved to a hypsometric pressure model and a different floor spacing.

### Decision
The original design estimated a floor using this linear approximation:

```
Δh ≈ 8.3 m/hPa × (P_ground − P_measured)
floor = round(Δh / 3.0 m)
```

A ground-floor reference pressure was required by the original design. The linear `pressureToAltitude`, `estimateFloor`, and `floorToPressure` functions remain in `shared/src/barometric.js` for backwards compatibility. They are not the live estimator's method. The live estimator uses hypsometric altitude, a 3.5 m nominal floor spacing, Kalman smoothing, and hysteresis as described in ADR-004.

### Rationale
The linear formula was simple to explain and adequate as an initial approximation. Preserving its helpers avoids breaking existing consumers and tests while the live system uses the newer estimation flow.

### Consequences
- The approximation and 3.0 m spacing must not be presented as current live behavior.
- Legacy helpers remain available; new live-estimation behavior is documented by ADR-004.
- A barometric floor estimate remains an estimate and depends on reference readings and model assumptions.

---

## ADR-004: Differential Barometry and Weather Drift

**Status:** Accepted

### Context
Changes in ambient weather pressure affect both a soldier's barometer and the ICP reference station. If that shared drift is treated as altitude change, the estimated altitude can shift even when the soldier has not changed floors. The project simulates a common pressure drift and needs a repeatable correction and floor-decision pipeline.

### Decision
For each soldier, the gateway records the latest ICP reference pressure when that soldier is first observed. On each subsequent packet, shared logic computes:

```text
ambientDrift = referenceNow - referenceAtEntry
correctedPressure = soldierPressure - ambientDrift
```

If either reference value is unavailable, `correctedPressure` returns the soldier's unadjusted pressure. The `FloorEstimator` then converts the effective pressure to relative altitude with the hypsometric formula, smooths it with a one-dimensional Kalman filter (defaults `Q = 0.05`, `R = 0.5`), and maps smoothed altitude to a floor using a hysteresis state machine (3.5 m nominal floor spacing, ±0.4 m threshold band, and 2000 ms dwell). The gateway also publishes an uncorrected raw-altitude estimate for comparison.

### Rationale
Subtracting the reference station's pressure change aims to remove pressure variation common to both sensors while retaining pressure differences associated with the soldier's elevation. Keeping correction, altitude estimation, smoothing, and floor selection in shared code makes the same tested calculation available to the server and other workspace consumers.

### Trade-offs
- The correction assumes the reference station and soldier sensor experience sufficiently similar ambient pressure drift.
- Each soldier's reference baseline is captured when first seen by the gateway; it is not necessarily a separately surveyed building-ground reading.
- The filter and dwell rules reduce noisy floor changes but introduce smoothing and delay.
- The simulator applies synthetic common drift and noise. This demonstrates the calculation but does not establish real-world sensor accuracy or calibration.
- The dashboard's correction toggle selects corrected or raw values for display. It does not turn off the gateway's server-side correction.

### Consequences
- The live flow is `differential correction → hypsometric altitude → Kalman smoothing → hysteresis floor decision`.
- The barometer modal can compare raw and corrected live estimates, reference pressure, and the displayed correction state.
- Tests validate implemented calculations and transitions, not real sensor calibration in field conditions.

---

## ADR-005: Mission Analytics and Debrief

**Status:** Accepted

### Context
Recorded telemetry is useful for post-mission review, but live dashboard state alone does not provide a consistent mission summary. Analytics also needs to respect mission boundaries and explain uncertainty in gaps between packets.

### Decision
Calculate analytics from a mission's stored telemetry through the shared pure function `calculateMissionAnalytics`. The server endpoint `GET /api/missions/:id/analytics` first verifies the mission, queries telemetry scoped to that mission, and passes mission metadata and one request-time `asOf` value to the calculator. The client presents mission selection, a floor-transition timeline, aggregated and per-soldier floor time, a soldier summary, and JSON export of the API response.

The calculator reports observed horizontal x/y distance, floor transitions, floor-time estimates, and signal-loss intervals inferred from telemetry gaps. It applies the existing 10-second signal timeout and respects mission start/end boundaries. See [V5 Mission Analytics](V5_MISSION_ANALYTICS.md) for the response fields and detailed calculation rules.

### Rationale
Centralizing calculations in shared code avoids separate client and server interpretations. Computing from mission-scoped telemetry keeps reports reproducible from recorded packets and prevents mixing telemetry from other missions. JSON export makes the returned report portable without reshaping its values.

### Trade-offs
- Floor time and signal loss are inferred from packet timestamps; analytics is not continuous location tracking or an authoritative alert history.
- Distance is horizontal only and cannot reconstruct movement during long telemetry gaps.
- Reports reflect recorded telemetry and the mission boundary supplied to the calculation.
- Rooms-cleared analytics are not included because V4 room-clear integration/data is unavailable. CSV export is also not implemented.

### Consequences
- The API is the report source for the Analytics dashboard and JSON download.
- Tests cover shared calculations and mission-scoped API behavior, including active and completed mission boundaries.
- The detailed implementation and current limitations are maintained in [V5 Mission Analytics](V5_MISSION_ANALYTICS.md).
