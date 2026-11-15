import { useEffect, useRef } from "react";

export default function ReplayControls({
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  currentTime,
  startTime,
  endTime,
  onSeek,
  missions,
  selectedMissionId,
  onSelectMission,
}) {
  const min = startTime || 0;
  const max = Math.max(min + 1000, endTime || min + 1000);
  const current = Math.min(max, Math.max(min, currentTime || min));

  const totalDurationSec = Math.max(1, Math.round((max - min) / 1000));
  const currentElapsedSec = Math.max(0, Math.round((current - min) / 1000));

  const formatSec = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const speeds = [1, 2, 5, 10];
  const selectedMission = missions.find(
  (mission) => mission.id === selectedMissionId
);

const packetCount = selectedMission?.packetCount ?? 0;

const durationSeconds = selectedMission?.minTs && selectedMission?.maxTs
  ? Math.max(0, Math.round(
      (selectedMission.maxTs - selectedMission.minTs) / 1000
    ))
  : 0;

const durationLabel = `${Math.floor(durationSeconds / 60)
  .toString()
  .padStart(2, "0")}:${(durationSeconds % 60)
  .toString()
  .padStart(2, "0")}`;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-nsg-dark/95 border-t border-nsg-border text-xs font-mono select-none z-30">
      <div className="flex items-center gap-4 text-[10px] font-mono">
  <div className="border border-nsg-border rounded px-3 py-1">
    <span className="text-gray-500 uppercase">Packets: </span>
    <span className="text-nsg-accent font-bold">{packetCount}</span>
  </div>

  <div className="border border-nsg-border rounded px-3 py-1">
    <span className="text-gray-500 uppercase">Duration: </span>
    <span className="text-white font-bold">{durationLabel}</span>
  </div>

  <div className="border border-nsg-border rounded px-3 py-1">
    <span className="text-gray-500 uppercase">Status: </span>
    <span className="text-emerald-400 font-bold uppercase">
      {selectedMission?.status || "N/A"}
    </span>
  </div>
</div>
      {/* Left: Mission Selector */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">
          Mission:
        </span>
        <select
          value={selectedMissionId || ""}
          onChange={(e) => onSelectMission(e.target.value)}
          className="bg-nsg-surface border border-nsg-border rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-nsg-accent"
        >
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.status})
            </option>
          ))}
        </select>
      </div>

      {/* Center: Play/Pause, Scrubber, Time */}
      <div className="flex items-center gap-4 flex-1 max-w-xl mx-6">
        <button
          onClick={onTogglePlay}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-nsg-accent text-nsg-dark font-bold hover:bg-emerald-400 transition-colors shadow-sm text-sm"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <span className="text-[11px] text-gray-300 w-12 text-right">
          {formatSec(currentElapsedSec)}
        </span>

        <input
          type="range"
          min={min}
          max={max}
          step="500"
          value={current}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 accent-nsg-accent h-2 bg-gray-700 rounded-lg cursor-pointer"
        />

        <span className="text-[11px] text-gray-500 w-12">
          {formatSec(totalDurationSec)}
        </span>

        <span className="text-[10px] text-gray-400 border border-nsg-border rounded px-1.5 py-0.5">
          {new Date(current).toLocaleTimeString()}
        </span>
      </div>

      {/* Right: Speed controls */}
      <div className="flex items-center gap-1 bg-nsg-surface/80 border border-nsg-border rounded p-0.5">
        <span className="text-gray-500 text-[10px] uppercase font-bold px-1.5">
          Speed:
        </span>
        {speeds.map((spd) => (
          <button
            key={spd}
            onClick={() => onChangeSpeed(spd)}
            className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
              playbackSpeed === spd
                ? "bg-nsg-accent text-nsg-dark"
                : "text-gray-400 hover:text-white hover:bg-nsg-border/50"
            }`}
          >
            {spd}x
          </button>
        ))}
      </div>
    </div>
  );
}
