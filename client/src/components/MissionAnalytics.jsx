import { useEffect, useMemo, useState } from "react";

const FLOOR_ORDER = ["B2", "B1", "G", "1", "2", "3", "4", "5"];

export default function MissionAnalytics({
  missions,
  missionsLoading,
  missionsError,
  selectedMissionId,
  onSelectMission,
}) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleExportJson = () => {
    if (!analytics) return;

    const reportName = analytics.mission?.name || analytics.mission?.id || selectedMissionId;
    const filename = `${safeFilename(reportName)}-analytics.json`;
    const blob = new Blob([JSON.stringify(analytics, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  };

  useEffect(() => {
    if (missionsLoading) return undefined;
    if (missionsError) {
      setAnalytics(null);
      setLoading(false);
      setError(missionsError);
      return undefined;
    }
    if (!selectedMissionId) {
      setAnalytics(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    const controller = new AbortController();
    setAnalytics(null);
    setLoading(true);
    setError("");

    fetch(`/api/missions/${encodeURIComponent(selectedMissionId)}/analytics`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || "Failed to load mission analytics");
        }
        return body;
      })
      .then(setAnalytics)
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message || "Failed to load mission analytics");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedMissionId, missionsLoading, missionsError]);

  const floorTotals = useMemo(() => {
    const totals = new Map();
    for (const soldier of analytics?.soldiers ?? []) {
      for (const [floor, timeMs] of Object.entries(soldier.timePerFloorMs ?? {})) {
        totals.set(floor, (totals.get(floor) ?? 0) + timeMs);
      }
    }
    return [...totals.entries()].sort(([floorA], [floorB]) => {
      const indexA = FLOOR_ORDER.indexOf(floorA);
      const indexB = FLOOR_ORDER.indexOf(floorB);
      return (indexA < 0 ? FLOOR_ORDER.length : indexA) - (indexB < 0 ? FLOOR_ORDER.length : indexB);
    });
  }, [analytics]);

  const transitions = useMemo(() => (analytics?.soldiers ?? [])
    .flatMap((soldier) => (soldier.floorTransitions ?? []).map((transition) => ({
      ...transition,
      soldierId: soldier.soldierId,
      teamId: soldier.teamId,
    })))
    .sort((a, b) => a.timestamp - b.timestamp || a.soldierId.localeCompare(b.soldierId)), [analytics]);
  const perSoldierFloorTimes = (analytics?.soldiers ?? [])
    .map((soldier) => ({
      ...soldier,
      floorTimes: Object.entries(soldier.timePerFloorMs ?? {}).sort(([floorA], [floorB]) => {
        const indexA = FLOOR_ORDER.indexOf(floorA);
        const indexB = FLOOR_ORDER.indexOf(floorB);
        return (indexA < 0 ? FLOOR_ORDER.length : indexA) - (indexB < 0 ? FLOOR_ORDER.length : indexB);
      }),
    }))
    .filter((soldier) => soldier.floorTimes.length > 0);

  const maxFloorTime = Math.max(0, ...floorTotals.map(([, timeMs]) => timeMs));
  const hasTelemetry = (analytics?.soldiers?.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-nsg-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-nsg-accent">V5 Mission Analytics</p>
          <h1 className="mt-1 text-xl font-bold tracking-wide text-white sm:text-2xl">Mission Report</h1>
          <p className="mt-1 text-xs text-gray-400">Movement and floor activity from recorded mission telemetry.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
          <label className="flex w-full flex-col gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 sm:w-80">
            Select mission
            <select
              value={selectedMissionId || ""}
              onChange={(event) => onSelectMission(event.target.value)}
              disabled={missionsLoading || missions.length === 0}
              className="rounded border border-nsg-border bg-nsg-surface px-3 py-2 text-xs font-normal normal-case tracking-normal text-gray-100 outline-none focus:border-nsg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {missions.length === 0 && <option value="">No missions available</option>}
              {missions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.name} ({mission.status})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={!analytics || loading}
            className="rounded border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[2.125rem] sm:shrink-0"
            title={analytics ? "Download the selected mission analytics report as JSON" : "Analytics are not loaded yet"}
          >
            Export JSON
          </button>
        </div>
      </div>

      {missionsLoading ? (
        <StatePanel title="Loading missions" message="Retrieving the mission list…" />
      ) : missionsError ? (
        <StatePanel title="Could not load missions" message={missionsError} error />
      ) : missions.length === 0 ? (
        <StatePanel title="No missions available" message="Create or record a mission before viewing analytics." />
      ) : loading ? (
        <StatePanel title="Loading analytics" message="Calculating the selected mission report…" />
      ) : error ? (
        <StatePanel title="Could not load analytics" message={error} error />
      ) : analytics && !hasTelemetry ? (
        <StatePanel title="No telemetry recorded" message="This mission has no accepted telemetry to summarize." />
      ) : analytics ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-nsg-border bg-nsg-surface p-4 sm:p-5">
            <SectionHeading title="Floor transitions" detail={`${transitions.length} recorded transition${transitions.length === 1 ? "" : "s"}`} />
            {transitions.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">No floor transitions recorded.</p>
            ) : (
              <ol className="mt-5 max-h-80 space-y-0 overflow-y-auto pl-1">
                {transitions.map((transition, index) => (
                  <li key={`${transition.soldierId}-${transition.timestamp}-${index}`} className="relative ml-2 border-l border-emerald-500/40 pb-5 pl-5 last:border-transparent last:pb-1">
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full border border-nsg-dark bg-nsg-accent" />
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs font-bold text-white">{transition.soldierId} <span className="font-normal text-gray-400">· {transition.teamId || "Unknown team"}</span></span>
                      <time className="text-[10px] text-gray-500">{formatTimestamp(transition.timestamp)}</time>
                    </div>
                    <p className="mt-1 text-xs text-gray-300">
                      <FloorTag floor={transition.fromFloor} />
                      <span className="mx-2 text-nsg-accent">→</span>
                      <FloorTag floor={transition.toFloor} />
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-lg border border-nsg-border bg-nsg-surface p-4 sm:p-5">
            <SectionHeading title="Time per floor" detail="Aggregated soldier time" />
            {floorTotals.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">No floor-time data recorded.</p>
            ) : (
              <div className="mt-5 space-y-4">
                {floorTotals.map(([floor, timeMs]) => (
                  <div key={floor} className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] items-center gap-3">
                    <span className="text-right text-xs font-bold text-gray-300">{floor}</span>
                    <div
                      className="h-3 overflow-hidden rounded-sm bg-black/40"
                      role="img"
                      aria-label={`${floorTitle(floor)}: ${formatDuration(timeMs)}`}
                    >
                      <div
                        className="h-full rounded-sm bg-nsg-accent transition-[width]"
                        style={{ width: `${maxFloorTime > 0 ? Math.max(1, (timeMs / maxFloorTime) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-right text-[10px] tabular-nums text-gray-400">{formatDuration(timeMs)}</span>
                  </div>
                ))}
              </div>
            )}
            {perSoldierFloorTimes.length > 0 && (
              <div className="mt-5 border-t border-nsg-border pt-4">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Per-soldier floor time</h3>
                <div className="space-y-1">
                  {perSoldierFloorTimes.map((soldier) => (
                    <details key={soldier.soldierId} className="group rounded border border-transparent px-2 py-1.5 open:border-nsg-border open:bg-black/10">
                      <summary className="cursor-pointer list-none text-xs text-gray-300 marker:hidden">
                        <span className="mr-2 inline-block w-3 text-nsg-accent transition-transform group-open:rotate-90">›</span>
                        <span className="font-bold text-white">{soldier.soldierId}</span>
                        <span className="ml-2 text-gray-500">{soldier.teamId || "—"}</span>
                      </summary>
                      <dl className="mt-2 grid grid-cols-2 gap-2 pl-5 sm:grid-cols-4">
                        {soldier.floorTimes.map(([floor, timeMs]) => (
                          <div key={floor} className="flex items-center justify-between gap-2 rounded bg-nsg-surface px-2 py-1.5 text-[10px]">
                            <dt className="font-bold text-gray-400">{floor}</dt>
                            <dd className="tabular-nums text-gray-200">{formatDuration(timeMs)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-nsg-border bg-nsg-surface xl:col-span-2">
            <div className="p-4 sm:p-5">
              <SectionHeading title="Soldier summary" detail={`${analytics.soldiers.length} soldier${analytics.soldiers.length === 1 ? "" : "s"}`} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead className="bg-black/25 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-bold">Soldier</th>
                    <th className="px-4 py-3 font-bold">HIT</th>
                    <th className="px-4 py-3 text-right font-bold">Distance</th>
                    <th className="px-4 py-3 text-right font-bold">Transitions</th>
                    <th className="px-4 py-3 text-right font-bold">Longest signal lost</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.soldiers.map((soldier) => (
                    <tr key={soldier.soldierId} className="border-t border-nsg-border/70 text-gray-300">
                      <td className="px-4 py-3 font-bold text-white">{soldier.soldierId}</td>
                      <td className="px-4 py-3">{soldier.teamId || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatDistance(soldier.distanceMeters)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{soldier.floorTransitionCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatDuration(soldier.longestSignalLostMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeading({ title, detail }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-gray-100">{title}</h2>
      <span className="text-[10px] text-gray-500">{detail}</span>
    </div>
  );
}

function StatePanel({ title, message, error = false }) {
  return (
    <div className={`rounded-lg border p-8 text-center ${error ? "border-red-900/60 bg-red-950/20" : "border-nsg-border bg-nsg-surface"}`}>
      <h2 className={`text-sm font-bold ${error ? "text-red-300" : "text-gray-200"}`}>{title}</h2>
      <p className="mt-2 text-xs text-gray-500">{message}</p>
    </div>
  );
}

function FloorTag({ floor }) {
  return <span className="rounded border border-nsg-border bg-black/20 px-2 py-0.5 font-bold text-gray-200">{floor}</span>;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((durationMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDistance(distanceMeters) {
  const distance = Math.max(0, distanceMeters || 0);
  return distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(1)} m`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function floorTitle(floor) {
  if (floor === "G") return "Ground floor";
  if (floor === "B1" || floor === "B2") return `Basement ${floor.slice(1)}`;
  return `Floor ${floor}`;
}

function safeFilename(value) {
  const normalized = (value || "mission")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "mission";
}
