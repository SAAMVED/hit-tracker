# One-time SQLite data import

The importer copies the legacy `db/hit-tracker.sqlite` data into the PostgreSQL database selected by `DATABASE_URL`. It does not delete or write to the SQLite source. It opens SQLite read-only and creates a consistent temporary backup snapshot; SQLite includes committed WAL data in that backup. The temporary snapshot is removed when the command exits.

## Safe procedure

1. Stop application writers so the source database does not continue changing during the import. Keep the SQLite database, its `-wal` and `-shm` sidecars together and in place.
2. Back up both the original SQLite database and the PostgreSQL destination independently.
3. Check `server/.env` locally and confirm `DATABASE_URL` points to the intended empty PostgreSQL database. Do not print or share its credentials.
4. Apply the PostgreSQL schema, then import from the repository root:

   ```sh
   npm run db:migrate --workspace server
   npm run db:import-sqlite --workspace server
   ```

   An alternate SQLite path may be provided after `--`:

   ```sh
   npm run db:import-sqlite --workspace server -- /absolute/path/to/hit-tracker.sqlite
   ```

The importer refuses to proceed unless the initial PostgreSQL migration is recorded and all tables it imports into are empty. It serializes import attempts using a transaction-scoped PostgreSQL advisory lock and records the SHA-256 fingerprint of the logical SQLite snapshot. Re-running an already imported snapshot is rejected. Any SQL/FK failure rolls back the entire import.

Users, missions, telemetry, calibration, reference readings, rejected packets, and legacy alerts are copied with their IDs and millisecond timestamps converted to `TIMESTAMPTZ`. Soldier and team identity rows are created only from IDs present in source telemetry or alerts; names remain `NULL` because the SQLite records do not carry authoritative roster names. Mission/team/soldier assignments are derived from the actual telemetry tuples. Telemetry without an existing mission or required soldier/team IDs is skipped and reported with its source row ID and reason; no replacement mission or personnel names are invented.

Telemetry is inserted in parameterized batches. The importer compares exact source-valid and destination row counts for each imported table before commit, synchronizes identity sequences, and prints source/imported counts plus every skipped record. Imported rejected-packet `raw_payload` values are stored as JSON strings so PostgreSQL returns a string through the existing API, matching SQLite's prior response shape.

`calibration_history`, `building_models`, and `mission_events` have no corresponding legacy SQLite tables or data and are not populated by this importer. New values for those features must come from their application workflows; the importer does not synthesize them.

This repository change only prepares and statically checks the importer. The commands above have not been run as part of this change.
