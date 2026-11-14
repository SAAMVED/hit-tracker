import { useState, useMemo } from "react";
import { SEA_LEVEL_HPA } from "@hit-tracker/shared";

export default function BarometerCalibrationModal({
  isOpen,
  onClose,
  soldiers = {},
  selectedSoldierId,
  onSelectSoldier,
  correctionEnabled,
  onToggleCorrection,
  referencePressure = SEA_LEVEL_HPA,
  history = [],
}) {
  const [internalSelectedId, setInternalSelectedId] = useState(
    selectedSoldierId || "A1"
  );

  const activeId = selectedSoldierId || internalSelectedId;
  const currentSoldier = soldiers[activeId];

  // Filter history for currently active soldier
  const soldierHistory = useMemo(() => {
    return history.filter((h) => h.soldierId === activeId).slice(-40);
  }, [history, activeId]);

  if (!isOpen) return null;

  // Chart dimensions
  const width = 500;
  const height = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Compute Y bounds based on history data (with default fallback to -10m .. +20m)
  let minY = -10;
  let maxY = 25;
  if (soldierHistory.length > 0) {
    const rawVals = soldierHistory.map((h) => h.rawAltitude);
    const corrVals = soldierHistory.map((h) => h.correctedAltitude);
    const allVals = [...rawVals, ...corrVals];
    minY = Math.min(-10, Math.floor(Math.min(...allVals) - 2));
    maxY = Math.max(20, Math.ceil(Math.max(...allVals) + 2));
  }

  const getY = (val) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return (
      padding.top +
      chartHeight -
      ((clamped - minY) / (maxY - minY)) * chartHeight
    );
  };

  const getX = (index) => {
    if (soldierHistory.length <= 1) return padding.left;
    return padding.left + (index / (soldierHistory.length - 1)) * chartWidth;
  };

  // Generate SVG paths
  const rawPath = soldierHistory
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(d.rawAltitude).toFixed(1)}`)
    .join(" ");

  const correctedPath = soldierHistory
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(d.correctedAltitude).toFixed(1)}`)
    .join(" ");

  const latestSample = soldierHistory[soldierHistory.length - 1];
  const latestRaw = latestSample ? latestSample.rawAltitude : (currentSoldier?.rawAltitude ?? 0);
  const latestCorrected = latestSample ? latestSample.correctedAltitude : (currentSoldier?.correctedAltitude ?? 0);

  const driftHpa = Math.round((referencePressure - SEA_LEVEL_HPA) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none">
      <div className="bg-nsg-surface border border-nsg-border rounded-lg shadow-2xl w-full max-w-xl overflow-hidden flex flex-col font-mono text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-nsg-dark border-b border-nsg-border">
          <div className="flex items-center gap-2">
            <span className="text-nsg-accent font-bold tracking-widest uppercase">
              Differential Barometer Calibration
            </span>
            <span className="text-[10px] text-gray-400 border border-nsg-border rounded px-1.5 py-0.5">
              ICP REF: {referencePressure.toFixed(2)} hPa
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-base leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-4 py-3 border-b border-nsg-border/60 bg-black/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 uppercase font-bold">
              Soldier:
            </span>
            <select
              value={activeId}
              onChange={(e) => {
                setInternalSelectedId(e.target.value);
                onSelectSoldier?.(e.target.value);
              }}
              className="bg-nsg-dark border border-nsg-border rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-nsg-accent"
            >
              {Object.keys(soldiers).map((id) => (
                <option key={id} value={id}>
                  {id} ({soldiers[id].teamId})
                </option>
              ))}
            </select>
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-300 font-bold">
              Weather Drift Correction:
            </span>
            <button
              onClick={onToggleCorrection}
              className={`px-3 py-1 rounded text-[10px] uppercase font-bold tracking-wider transition-all ${
                correctionEnabled
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-950 font-extrabold"
                  : "bg-red-950 text-red-300 border border-red-500/50"
              }`}
            >
              {correctionEnabled ? "ENABLED" : "DISABLED"}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4">
          {/* Status summary */}
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="p-2 rounded bg-black/40 border border-nsg-border/50">
              <span className="text-gray-400 block text-[9px] uppercase">
                Ambient Drift (ICP)
              </span>
              <span className={`font-bold ${driftHpa !== 0 ? "text-amber-400" : "text-gray-300"}`}>
                {driftHpa >= 0 ? `+${driftHpa}` : driftHpa} hPa
              </span>
            </div>
            <div className="p-2 rounded bg-black/40 border border-red-900/40">
              <span className="text-red-400 block text-[9px] uppercase font-bold">
                Raw Uncorrected Alt
              </span>
              <span className="font-bold text-red-300">
                {latestRaw.toFixed(1)} m
              </span>
            </div>
            <div className="p-2 rounded bg-black/40 border border-emerald-900/40">
              <span className="text-emerald-400 block text-[9px] uppercase font-bold">
                Corrected Altitude
              </span>
              <span className="font-bold text-emerald-300">
                {latestCorrected.toFixed(1)} m
              </span>
            </div>
          </div>

          {/* Live SVG Comparison Chart */}
          <div className="border border-nsg-border rounded bg-black/50 p-2 flex flex-col items-center">
            <div className="w-full flex items-center justify-between text-[10px] text-gray-400 px-2 pb-1 border-b border-nsg-border/40">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-red-400 inline-block border-t border-dashed" />
                  <span className="text-red-300">Raw Estimated (Uncorrected)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-emerald-400 inline-block" />
                  <span className="text-emerald-300 font-bold">
                    Corrected (Differential)
                  </span>
                </div>
              </div>
              <span>Last 40s</span>
            </div>

            <svg width={width} height={height} className="overflow-visible mt-2">
              {/* Horizontal Grid lines & Floor references */}
              {[-2, -1, 0, 1, 2, 3, 4, 5].map((flNum) => {
                const altM = flNum * 3.5;
                if (altM < minY || altM > maxY) return null;
                const y = getY(altM);
                const label = flNum < 0 ? `B${Math.abs(flNum)}` : flNum === 0 ? "G" : String(flNum);

                return (
                  <g key={`grid-${flNum}`}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke="#374151"
                      strokeDasharray="2,2"
                      strokeWidth="0.5"
                    />
                    <text
                      x={padding.left - 6}
                      y={y + 3}
                      fill="#9ca3af"
                      fontSize="9"
                      textAnchor="end"
                      fontFamily="monospace"
                    >
                      {label} ({altM}m)
                    </text>
                  </g>
                );
              })}

              {/* Data paths */}
              {soldierHistory.length > 1 && (
                <>
                  {/* Raw uncorrected line (dashed red) */}
                  <path
                    d={rawPath}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="1.8"
                    strokeDasharray="4,3"
                    opacity="0.85"
                  />
                  {/* Corrected line (solid emerald) */}
                  <path
                    d={correctedPath}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.2"
                  />
                </>
              )}

              {soldierHistory.length <= 1 && (
                <text
                  x={width / 2}
                  y={height / 2}
                  fill="#6b7280"
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  Collecting barometric samples...
                </text>
              )}
            </svg>
          </div>

          <p className="text-[10px] text-gray-400 leading-relaxed">
            Ambient weather shifts alter atmospheric pressure uniformly. Without differential correction against the ICP reference station, uncorrected estimation drifts across floors over time.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-2.5 bg-nsg-dark border-t border-nsg-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-nsg-border text-gray-300 hover:text-white transition-colors uppercase font-bold tracking-wider text-[11px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
