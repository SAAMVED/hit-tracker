ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS alerts_unresolved_time_idx
  ON alerts(ts DESC) WHERE resolved = false;
