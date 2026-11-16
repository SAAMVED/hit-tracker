# V5 Mission Analytics

## Purpose

Mission Analytics summarizes the telemetry recorded for one HIT-Tracker mission. It gives a commander or reviewer a view of where soldiers were recorded, how far their recorded horizontal positions changed, which floor changes were observed, and how long telemetry was absent beyond the existing signal-loss timeout.

The implementation uses the shared calculation function in `shared/src/analytics.js`. The server loads telemetry for one mission and returns the calculation result. The client presents the result and can download the same response as JSON.

## API

### `GET /api/missions/:id/analytics`

Replace `:id` with the mission ID. For example:

```text
GET /api/missions/mission-123/analytics
```

The server first looks up that mission. If it does not exist, the response is HTTP `404`:

```json
{ "error": "Mission not found" }
```

For a known mission, the server selects telemetry with `WHERE mission_id = ?`, ordered by soldier, timestamp, and telemetry row ID. It maps the database columns to the shared analytics input and captures `Date.now()` once for the request. That value is passed as `asOf` and returned as `generatedAt`.

The telemetry query selects the fields used by the calculation: soldier ID, team ID, timestamp, x/y position, and floor. The database has a composite index on `(mission_id, soldier_id, ts)` for this access pattern.

### Response structure

The response contains mission metadata, the report generation timestamp, totals, and one record for each soldier with usable timestamped telemetry:

```json
{
  "mission": {
    "id": "mission-123",
    "name": "Example mission",
    "startedAt": 1700000000000,
    "endedAt": null,
    "status": "active"
  },
  "generatedAt": 1700000123456,
  "totals": {
    "soldierCount": 1,
    "distanceMeters": 12.5,
    "floorTransitionCount": 1,
    "longestSignalLostMs": 5000
  },
  "soldiers": [
    {
      "soldierId": "A1",
      "teamId": "Alpha",
      "timePerFloorMs": { "G": 10000, "1": 2500 },
      "distanceMeters": 12.5,
      "floorTransitionCount": 1,
      "floorTransitions": [
        { "timestamp": 1700000012500, "fromFloor": "G", "toFloor": "1" }
      ],
      "signalLostIntervals": [
        { "startedAt": 1700000020000, "endedAt": 1700000025000, "durationMs": 5000 }
      ],
      "longestSignalLostMs": 5000
    }
  ]
}
```

The values above illustrate the field layout only. Timestamps are Unix epoch milliseconds. `endedAt` is `null` for an active mission. `teamId` is `null` if no team value is present in that soldier's records. If no usable telemetry remains, `soldiers` is empty and all numeric totals are zero.

## Per-soldier metrics and calculation rules

The shared calculator accepts either the camelCase field names used by the API or the snake_case database names. It ignores packets whose soldier ID is not a string or whose timestamp is not a finite number. Packets before mission start or after the report boundary are excluded. Packets are sorted by timestamp; when a soldier has duplicate timestamps, the last packet in input order is retained. In the API query, row ID provides the deterministic input order for duplicates.

### Time spent per floor

`timePerFloorMs` maps floor labels such as `B1`, `G`, or `2` to durations in milliseconds.

For each packet with a known floor, the calculator credits time from that packet's timestamp up to the next packet's timestamp, or to the report boundary for the soldier's last packet. A credited interval is capped at the packet timestamp plus the 10-second signal timeout. Time after that cap is not assigned to a floor because the soldier's location is unknown. Packets with a null floor receive no floor-time credit.

For completed missions, the report boundary is the mission's `endedAt`. For active missions, the API supplies the request's `asOf` timestamp as the boundary.

### Horizontal distance travelled

`distanceMeters` is the sum of straight-line x/y distances between consecutive usable coordinate samples. For each pair, the calculation uses the Euclidean distance `Math.hypot(deltaX, deltaY)`. The telemetry schema and simulator define x and y in metres, so the result is horizontal metres. Vertical movement is not included.

Distance is counted only when the sample gap is at most 10,000 ms. A longer gap resets the coordinate baseline; the first valid coordinate after that gap starts a new segment. A packet with a missing or non-finite x or y also resets the baseline, so the calculation does not bridge across that packet.

### Floor transitions and timeline

`floorTransitionCount` is the number of records in `floorTransitions`. A record is added when two consecutive timestamped packets for a soldier both have known floors and their floor labels differ. Each record contains:

- `timestamp`: the timestamp of the later packet where the changed floor was observed.
- `fromFloor`: the earlier packet's floor.
- `toFloor`: the later packet's floor.

This timestamp represents when the new floor appears in the recorded telemetry; it does not establish the precise time the soldier crossed between floors. The current implementation compares consecutive known floors even when the packet gap exceeds the signal timeout, so a transition across a long telemetry gap is based only on the two recorded floor values.

### Signal-lost intervals and longest duration

`signalLostIntervals` contains intervals where the gap between consecutive valid timestamped packets exceeds the timeout. `startedAt` is the earlier packet timestamp plus the timeout. For a recovered soldier, `endedAt` is the next packet timestamp. For the final packet in a mission, the interval ends at the report boundary if the mission boundary is more than the timeout after that packet.

`durationMs` is the interval length after the timeout, not the entire time without packets. `longestSignalLostMs` is the largest `durationMs` for that soldier, or zero when no interval exists.

## Relationship to signal-loss alerts

The calculator imports `SIGNAL_LOST_TIMEOUT_MS` from `shared/src/alerts.js`; the value is 10,000 ms and is not duplicated in the analytics module. Existing alert logic marks a soldier stale only when elapsed time since the last packet is **greater than** 10,000 ms. The alert engine scans known soldiers periodically, prevents repeated active signal-loss alerts, and clears the alert when telemetry resumes.

The alert system uses missing telemetry, not the numeric radio-strength `signal` field, to detect stale soldiers. The analytics calculation follows the same strict greater-than boundary: an exact 10,000 ms packet gap is not a signal-lost interval. The server-side alert is transient dashboard behavior; mission analytics reconstructs intervals from stored mission telemetry rather than querying persisted alert intervals.

## Dashboard

The dashboard has a third navigation mode, **Analytics**, alongside Live and Replay. It reuses the mission list and selected mission state. Selecting a mission fetches `/api/missions/:id/analytics`; changing the selection refreshes the report, and an obsolete request is cancelled.

The Analytics view provides:

- A chronological floor-transition timeline with soldier, team, timestamp, and from/to floor labels.
- An aggregated floor-time bar chart. Each floor's value is the sum of `timePerFloorMs` for soldiers in the API response.
- An expandable per-soldier floor-time breakdown using each soldier's returned floor values.
- A soldier summary table with team, horizontal distance, transition count, and longest signal-loss duration.
- An **Export JSON** button. It downloads the selected API response, including mission metadata, `generatedAt`, totals, and per-soldier values, without reshaping those data. The filename is based on the mission name or ID and is sanitized for use as a filename. The button is disabled until analytics are loaded.
- Loading, API error, no-missions, and no-telemetry states.

Durations are displayed as hours/minutes or minutes/seconds, and distance is displayed in metres or kilometres. These are presentation formats; the API values remain milliseconds and metres.

## Tests and verification

The implementation has shared calculation tests and PostgreSQL backend integration tests. Backend tests connect only to the dedicated `hit_tracker_test` database and create uniquely named temporary schemas that are dropped after each test file. Mission analytics coverage includes a successful report, unknown mission response, mission-scoped telemetry filtering, and the active and completed mission boundaries. The wider backend suite also checks PostgreSQL migrations, constraints, authentication, gateway persistence, calibration, alerts, and the one-time SQLite importer fixture.

Commands run for V5 analytics verification:

```sh
npm test
npm test --workspace server
npm run build
git diff --check
```

`npm test` runs the shared Vitest suite (108 tests). `npm test --workspace server` runs the backend Node test suite (17 tests). The build runs the client Vite production build; Vite currently reports a large JavaScript bundle warning.

## Limitations and assumptions

- The reported distance is horizontal x/y displacement accumulated over short telemetry segments. It excludes vertical travel and does not reconstruct a path during signal-loss gaps.
- Floor time is inferred from the floor attached to each packet and is capped at 10 seconds per packet interval. It is not continuous indoor positioning.
- A transition record uses the later packet timestamp, and a floor change after a long telemetry gap remains uncertain as described above.
- Signal-loss periods are inferred from telemetry gaps; the database does not store authoritative signal-loss interval records.
- Rooms-cleared analytics are not included. V4 room-clear integration/data is not available in this implementation, so the dashboard does not report rooms cleared per HIT.
- JSON export is implemented. CSV export is not part of the current V5 implementation.

These are the current implemented behaviors. More detailed path reconstruction or room-clear reporting would require additional data or integration and is not claimed by this version.
