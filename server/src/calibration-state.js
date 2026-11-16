const identityCalibration = () => ({
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

let currentCalibration = identityCalibration();
let updatedAt;

export async function restoreCalibration(pool) {
  const { rows: [row] } = await pool.query("SELECT * FROM calibration WHERE id='default'");
  if (!row) {
    currentCalibration = identityCalibration();
    updatedAt = undefined;
    return getCalibrationResponse();
  }

  currentCalibration = {
    translation: { x: Number(row.translation_x), y: Number(row.translation_y), z: Number(row.translation_z) },
    rotation: { x: Number(row.rotation_x), y: Number(row.rotation_y), z: Number(row.rotation_z) },
    scale: { x: Number(row.scale_x), y: Number(row.scale_y), z: Number(row.scale_z) },
  };
  updatedAt = new Date(row.updated_at).getTime();
  return getCalibrationResponse();
}

export function setCurrentCalibration({ translation, rotation, scale }, timestamp) {
  currentCalibration = { translation: { ...translation }, rotation: { ...rotation }, scale: { ...scale } };
  updatedAt = timestamp;
}

export function getCalibrationResponse() {
  return {
    translation: { ...currentCalibration.translation },
    rotation: { ...currentCalibration.rotation },
    scale: { ...currentCalibration.scale },
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}
