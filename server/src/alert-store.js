export async function persistAlerts(pool, alerts, missionId = null) {
  if (alerts.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const alert of alerts) {
      await client.query(`INSERT INTO alerts
        (id,type,severity,soldier_id,team_id,mission_id,message,ts,acknowledged,acknowledged_by,acknowledged_at,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),$9,$10,
          CASE WHEN $11::double precision IS NULL THEN NULL ELSE to_timestamp($11/1000.0) END,$12::jsonb)
        ON CONFLICT(id) DO NOTHING`, [
        alert.id, alert.type, alert.severity, alert.soldierId, alert.teamId, missionId,
        alert.message, alert.timestamp, Boolean(alert.acknowledged), alert.acknowledgedBy ?? null,
        alert.acknowledgedAt ?? null, JSON.stringify(alert),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadActiveAlerts(pool) {
  const { rows } = await pool.query(`SELECT id,type,severity,soldier_id,team_id,message,
    (extract(epoch FROM ts)*1000)::bigint AS timestamp,acknowledged,acknowledged_by,
    (extract(epoch FROM acknowledged_at)*1000)::bigint AS acknowledged_at
    FROM alerts WHERE resolved=false ORDER BY ts DESC,id`);
  return rows.map((row) => {
    const alert = {
      id: row.id, type: row.type, severity: row.severity,
      soldierId: row.soldier_id, teamId: row.team_id, message: row.message,
      timestamp: Number(row.timestamp), acknowledged: row.acknowledged,
    };
    if (row.acknowledged_by != null) alert.acknowledgedBy = row.acknowledged_by;
    if (row.acknowledged_at != null) alert.acknowledgedAt = Number(row.acknowledged_at);
    return alert;
  });
}

export async function acknowledgePersistedAlert(pool, id, acknowledgedBy, at = Date.now()) {
  const { rows: [row] } = await pool.query(`UPDATE alerts SET acknowledged=true,acknowledged_by=$2,
    acknowledged_at=to_timestamp($3/1000.0) WHERE id=$1 AND resolved=false
    RETURNING id,type,severity,soldier_id,team_id,message,
      (extract(epoch FROM ts)*1000)::bigint AS timestamp,acknowledged,acknowledged_by,
      (extract(epoch FROM acknowledged_at)*1000)::bigint AS acknowledged_at`, [id, acknowledgedBy, at]);
  return row ? loadAlert(row) : null;
}

export async function resolvePersistedAlert(pool, id, resolvedBy = null, at = Date.now()) {
  const { rowCount } = await pool.query(`UPDATE alerts SET resolved=true,resolved_by=$2,
    resolved_at=to_timestamp($3/1000.0) WHERE id=$1 AND resolved=false`, [id, resolvedBy, at]);
  return rowCount > 0;
}

export async function resolvePersistedAlerts(pool, ids, at = Date.now()) {
  if (ids.length === 0) return;
  await pool.query(`UPDATE alerts SET resolved=true,resolved_at=to_timestamp($2/1000.0)
    WHERE id=ANY($1::text[]) AND resolved=false`, [ids, at]);
}

function loadAlert(row) {
  const alert = {
    id: row.id, type: row.type, severity: row.severity,
    soldierId: row.soldier_id, teamId: row.team_id, message: row.message,
    timestamp: Number(row.timestamp), acknowledged: row.acknowledged,
  };
  if (row.acknowledged_by != null) alert.acknowledgedBy = row.acknowledged_by;
  if (row.acknowledged_at != null) alert.acknowledgedAt = Number(row.acknowledged_at);
  return alert;
}
