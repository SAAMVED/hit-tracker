import { useState } from "react";

export default function ModelCalibrationModal({
  isOpen,
  onClose,
  calibration,
  onChangeCalibration,
  onSaveCalibration,
  authToken,
  role,
}) {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  if (!isOpen || role !== "commander") return null;

  const handleTranslationChange = (axis, val) => {
    onChangeCalibration({
      ...calibration,
      translation: {
        ...calibration.translation,
        [axis]: parseFloat(val) || 0,
      },
    });
  };

  const handleRotationChange = (axis, val) => {
    onChangeCalibration({
      ...calibration,
      rotation: {
        ...calibration.rotation,
        [axis]: parseFloat(val) || 0,
      },
    });
  };

  const handleScaleChange = (axis, val) => {
    const num = Math.max(0.01, parseFloat(val) || 1);
    onChangeCalibration({
      ...calibration,
      scale: {
        ...calibration.scale,
        [axis]: num,
      },
    });
  };

  const handleUniformScaleChange = (val) => {
    const num = Math.max(0.01, parseFloat(val) || 1);
    onChangeCalibration({
      ...calibration,
      scale: { x: num, y: num, z: num },
    });
  };

  const handleReset = () => {
    onChangeCalibration({
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await onSaveCalibration();
      setSaveStatus("Calibration saved successfully!");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus("Uploading model...");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];
        const res = await fetch("/api/model/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            filename: file.name,
            fileBase64: base64,
          }),
        });
        if (!res.ok) throw new Error("Upload failed: " + res.statusText);
        setUploadStatus("Model uploaded! Reload page to apply.");
      } catch (err) {
        setUploadStatus("Error: " + err.message);
      }
    };
    reader.readAsDataURL(file);
  };

  const t = calibration.translation;
  const r = calibration.rotation;
  const s = calibration.scale;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none">
      <div className="bg-nsg-surface border border-nsg-border rounded-lg shadow-2xl w-full max-w-lg overflow-hidden flex flex-col font-mono text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-nsg-dark border-b border-nsg-border">
          <div className="flex items-center gap-2">
            <span className="text-nsg-accent font-bold tracking-widest uppercase">
              Model Alignment Calibration
            </span>
            <span className="text-[10px] bg-red-950/80 border border-red-500/50 text-red-300 px-1.5 py-0.5 rounded uppercase font-bold">
              CMD ONLY
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-base leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Translation */}
          <div className="space-y-2 border border-nsg-border/60 rounded p-2.5 bg-black/20">
            <span className="text-gray-300 font-bold tracking-wider uppercase text-[11px] block">
              Translation (Metres)
            </span>
            {["x", "y", "z"].map((axis) => (
              <div key={`trans-${axis}`} className="flex items-center gap-2">
                <span className="w-5 uppercase font-bold text-nsg-accent text-[11px]">
                  {axis}:
                </span>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="0.2"
                  value={t[axis]}
                  onChange={(e) => handleTranslationChange(axis, e.target.value)}
                  className="flex-1 accent-nsg-accent h-1.5 bg-gray-700 rounded cursor-pointer"
                />
                <input
                  type="number"
                  step="0.1"
                  value={t[axis]}
                  onChange={(e) => handleTranslationChange(axis, e.target.value)}
                  className="w-16 bg-nsg-dark border border-nsg-border rounded px-1.5 py-0.5 text-right text-gray-200"
                />
              </div>
            ))}
          </div>

          {/* Rotation */}
          <div className="space-y-2 border border-nsg-border/60 rounded p-2.5 bg-black/20">
            <span className="text-gray-300 font-bold tracking-wider uppercase text-[11px] block">
              Rotation (Degrees)
            </span>
            {["x", "y", "z"].map((axis) => (
              <div key={`rot-${axis}`} className="flex items-center gap-2">
                <span className="w-5 uppercase font-bold text-nsg-accent text-[11px]">
                  {axis}:
                </span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={r[axis]}
                  onChange={(e) => handleRotationChange(axis, e.target.value)}
                  className="flex-1 accent-nsg-accent h-1.5 bg-gray-700 rounded cursor-pointer"
                />
                <input
                  type="number"
                  step="1"
                  value={r[axis]}
                  onChange={(e) => handleRotationChange(axis, e.target.value)}
                  className="w-16 bg-nsg-dark border border-nsg-border rounded px-1.5 py-0.5 text-right text-gray-200"
                />
              </div>
            ))}
          </div>

          {/* Scale */}
          <div className="space-y-2 border border-nsg-border/60 rounded p-2.5 bg-black/20">
            <span className="text-gray-300 font-bold tracking-wider uppercase text-[11px] block">
              Scale Multiplier
            </span>
            <div className="flex items-center gap-2">
              <span className="w-12 text-gray-400 text-[10px]">Uniform:</span>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.05"
                value={s.x}
                onChange={(e) => handleUniformScaleChange(e.target.value)}
                className="flex-1 accent-nsg-accent h-1.5 bg-gray-700 rounded cursor-pointer"
              />
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={s.x}
                onChange={(e) => handleUniformScaleChange(e.target.value)}
                className="w-16 bg-nsg-dark border border-nsg-border rounded px-1.5 py-0.5 text-right text-gray-200"
              />
            </div>
          </div>

          {/* Upload Custom Model */}
          <div className="border border-nsg-border/60 rounded p-2.5 bg-black/20 space-y-1.5">
            <span className="text-gray-300 font-bold tracking-wider uppercase text-[11px] block">
              Upload Custom 3D Model (.glb)
            </span>
            <input
              type="file"
              accept=".glb,.gltf"
              onChange={handleFileUpload}
              className="w-full text-[10px] text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-nsg-border file:bg-nsg-dark file:text-nsg-accent file:font-mono file:cursor-pointer"
            />
            {uploadStatus && (
              <p className="text-[10px] text-nsg-accent">{uploadStatus}</p>
            )}
          </div>

          {saveStatus && (
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-[11px] text-center font-bold">
              {saveStatus}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-nsg-dark border-t border-nsg-border">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors uppercase font-bold tracking-wider text-[11px]"
          >
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-nsg-border text-gray-400 hover:text-white transition-colors uppercase font-bold tracking-wider text-[11px]"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded bg-nsg-accent text-nsg-dark hover:bg-emerald-400 transition-colors uppercase font-bold tracking-wider text-[11px] shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save to Database"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
