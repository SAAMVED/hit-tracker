ALTER TABLE calibration
  ADD COLUMN IF NOT EXISTS calibrated_by TEXT;
