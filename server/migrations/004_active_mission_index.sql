CREATE INDEX IF NOT EXISTS missions_active_started_idx
  ON missions(started_at DESC) WHERE status = 'active';
