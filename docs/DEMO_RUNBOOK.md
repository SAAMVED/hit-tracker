# HIT-Tracker Barometry and Mission Debrief Demo

This runbook demonstrates the current simulator, live dashboard, Replay view, and Mission Analytics. Use synthetic drift as a visual demonstration, not as evidence of real-world sensor accuracy. Floor changes depend on randomized simulated movement, noise, and the estimator's filtering and dwell rules; do not promise an exact transition time.

## Before the demo

1. From the repository root, install dependencies if needed with `npm install`.
2. Configure the local environment as described in the [README Quick Start](../README.md#quick-start).
3. Ensure the server's local SQLite database contains at least one mission with telemetry if you plan to demonstrate Replay and Analytics. The demo does not create a mission automatically.

## Start with synthetic weather drift

Start the server, client, and simulator together from the repository root:

```sh
SIM_DRIFT=1 npm start
```

This uses POSIX shell environment-variable syntax. Wait for the dashboard and simulator connection, then open the dashboard at `http://localhost:5173` (the default development URL in the README). The simulator logs that `SIM_DRIFT=1` is active. It applies a common drift term that rises by about 0.8 hPa per 30 seconds to soldier and reference pressure readings; the drift is based on simulator process start time, not mission start time. Random noise is also present.

## Show the drift comparison and modal

1. Stay in **Live** mode and allow live telemetry to arrive.
2. Click **Barometer** in the dashboard header.
3. In the **Differential Barometer Calibration** modal, explain the ICP reference pressure and the displayed ambient drift, which is the current reference pressure minus `SEA_LEVEL_HPA` for that display.
4. Select a soldier. Point out the raw uncorrected altitude and corrected altitude values and the last-40-second comparison plot. The two series can diverge as the shared simulated pressure drift grows; the exact visual difference varies with the readings and noise.
5. The quick-check table compares raw and corrected floor estimates for the displayed live soldiers. It may mark a row as drifted when those floor labels differ; it need not do so at a particular time.

The server-side path subtracts the change in ICP reference pressure from soldier pressure, then estimates altitude, smooths it, and applies floor hysteresis. This common-mode correction is intended to keep simulated weather drift from appearing as soldier height change.

## Toggle the displayed values and show floor stabilization

1. In the modal, click the **ENABLED/DISABLED** weather-drift correction control.
2. Explain that the control changes which values the dashboard displays. With correction enabled, the dashboard uses the server's corrected altitude and estimated floor. With it disabled, it displays raw altitude and calculates a display floor by rounding raw altitude divided by 3.5 m.
3. Emphasize that the toggle **does not turn off server-side correction**. The gateway continues to calculate the corrected values in both display modes.
4. Close the modal if desired and compare floor labels in the live roster/viewport as the display mode changes. With correction enabled, common synthetic drift is subtracted before floor estimation; the Kalman filter and 2000 ms hysteresis dwell also damp brief threshold changes.

The simulator's soldiers move randomly and sometimes use stairs. Their actual simulated floor may change during the demo, so stabilization means avoiding floor changes caused solely by common pressure drift, not freezing every soldier on one floor.

## Show mission playback

1. Select **Replay** in the top navigation.
2. Choose a mission in the selector at the bottom of the dashboard.
3. Use the play/pause button, timeline scrubber, and playback-speed controls to show recorded packets and soldier positions over time.

Replay requires a mission with stored telemetry. If there is no suitable mission, skip this section rather than implying that live data is automatically a completed replay mission.

## Show Analytics debrief and JSON export

1. Select **Analytics** in the top navigation.
2. Select a mission from the mission selector.
3. Walk through the chronological floor-transition timeline, aggregated time-per-floor bars, expandable per-soldier floor-time breakdown, and soldier summary table.
4. Describe the report as calculations over that mission's stored telemetry. The UI displays returned values; floor time and signal-loss intervals are inferred from packet timestamps under the existing 10-second timeout.
5. Click **Export JSON** to download the selected mission's analytics response, including mission metadata, generation timestamp, totals, and soldier records.

Rooms-cleared analytics are not shown because V4 room-clear integration/data is unavailable. JSON export is implemented; CSV export is not part of this dashboard.

## Source references

- Barometric calculation and floor estimator: `shared/src/barometric.js`
- Differential correction and live telemetry flow: `server/src/gateway.js`
- Synthetic drift and soldier movement: `simulator/src/index.js` and `simulator/src/state.js`
- Dashboard mode/toggle behavior: `client/src/components/Dashboard.jsx`
- Analytics details and limitations: [V5_MISSION_ANALYTICS.md](V5_MISSION_ANALYTICS.md)
