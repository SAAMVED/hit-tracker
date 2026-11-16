import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { floorLabelToNumber, floorNumberToLabel, SEA_LEVEL_HPA } from "@hit-tracker/shared";
import FloorSelector from "./FloorSelector.jsx";
import Roster from "./Roster.jsx";
import Viewport from "./Viewport.jsx";
import AlertsPanel from "./AlertsPanel.jsx";
import ReplayControls from "./ReplayControls.jsx";
import MissionAnalytics from "./MissionAnalytics.jsx";
import ModelCalibrationModal from "./ModelCalibrationModal.jsx";
import SecurityLogModal from "./SecurityLogModal.jsx";
import BarometerCalibrationModal from "./BarometerCalibrationModal.jsx";
import { playCriticalAlertBeep } from "../utils/audio.js";
import { apiUrl, dashboardWebSocketUrl } from "../utils/api.js";

export default function Dashboard({ auth, onLogout }) {
  const [mode, setMode] = useState("live"); // "live" | "replay"
  const [activeFloor, setActiveFloor] = useState(0);
  const [floorMode, setFloorMode] = useState("cutaway");
  const [connected, setConnected] = useState(false);
  const [liveSoldiers, setLiveSoldiers] = useState({});
  const [liveTrails, setLiveTrails] = useState({});
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [selectedSoldierId, setSelectedSoldierId] = useState(null);

  // ── Calibration State ───────────────────────────────────────────────────────
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [calibration, setCalibration] = useState({
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });

  // ── Security Log State ──────────────────────────────────────────────────────
  const [isSecurityLogOpen, setIsSecurityLogOpen] = useState(false);

  // ── Differential Barometer Calibration State ────────────────────────────────
  const [isBaroModalOpen, setIsBaroModalOpen] = useState(false);
  const [correctionEnabled, setCorrectionEnabled] = useState(true);
  const [referencePressure, setReferencePressure] = useState(SEA_LEVEL_HPA);
  const [baroHistory, setBaroHistory] = useState([]);

  // ── Replay State ────────────────────────────────────────────────────────────
  const [missions, setMissions] = useState([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState("");
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [replayPackets, setReplayPackets] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [replayTime, setReplayTime] = useState(null);
  const [replayRange, setReplayRange] = useState({ min: 0, max: 0 });

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const playTimerRef = useRef(null);

  // ── Fetch Calibration on Start ──────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/calibration")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.translation && data.rotation && data.scale) {
          setCalibration({
            translation: data.translation,
            rotation: data.rotation,
            scale: data.scale,
          });
        }
      })
      .catch((err) => console.warn("[dashboard] Calibration fetch error:", err));
  }, []);

  const handleSaveCalibration = async () => {
    const res = await fetch("/api/calibration", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(calibration),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save calibration");
    }
  };

  // ── Live WebSocket Pipeline ─────────────────────────────────────────────────
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/dashboard?token=${encodeURIComponent(auth.token)}`;

    console.log("[dashboard-ws] Connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[dashboard-ws] Connected successfully");
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // 1. Connection ack
        if (msg.type === "connected") {
          setConnected(true);
        }

        // 2. Initial Snapshot
        else if (msg.type === "snapshot") {
          const list = msg.payload || msg.soldiers || [];
          setLiveSoldiers((prev) => {
            const next = { ...prev };
            for (const s of list) {
              if (s && s.soldierId) {
                next[s.soldierId] = s;
              }
            }
            return next;
          });
        }

        // 3. Live Telemetry
        else if (msg.type === "telemetry") {
          const s = msg.payload || msg;
          if (s && s.soldierId) {
            setLiveSoldiers((prev) => ({
              ...prev,
              [s.soldierId]: s,
            }));

            // Record breadcrumb trail point
            setLiveTrails((prev) => {
              const currentTrail = prev[s.soldierId] ?? [];
              const newPoint = [s.x, s.altitude, s.y];
              // Keep maximum of 30 trail points per soldier
              const updated = [...currentTrail.slice(-29), newPoint];
              return { ...prev, [s.soldierId]: updated };
            });

            // Record barometric history sample for calibration comparison chart
            setBaroHistory((prev) => {
              const sample = {
                soldierId: s.soldierId,
                timestamp: s.timestamp || Date.now(),
                rawAltitude: s.rawAltitude ?? s.altitude ?? 0,
                correctedAltitude: s.correctedAltitude ?? s.altitude ?? 0,
                pressureHpa: s.pressureHpa,
              };
              return [...prev.slice(-300), sample];
            });
          }
        }

        // 4. Reference Barometer Station Feed from ICP
        else if (msg.type === "reference_station") {
          const ref = msg.payload || msg;
          if (ref && typeof ref.pressureHpa === "number") {
            setReferencePressure(ref.pressureHpa);
          }
        }

        // 4. Alert Event
        else if (msg.type === "alert") {
          const alert = msg.payload || msg;
          if (alert && alert.id) {
            if (alert.severity === "critical") {
              // Play tactical audio beep for critical alert (Signal lost / Man down)
              playCriticalAlertBeep();
            }

            setLiveAlerts((prev) => {
              // Deduplicate alert by ID
              const existingIdx = prev.findIndex((a) => a.id === alert.id);
              if (existingIdx >= 0) {
                const copy = [...prev];
                copy[existingIdx] = alert;
                return copy;
              }
              return [alert, ...prev.slice(0, 49)];
            });
          }
        }
      } catch (err) {
        console.error("[dashboard-ws] Message parse error:", err);
      }
    };

    ws.onclose = () => {
      console.warn("[dashboard-ws] Disconnected — reconnecting in 3s...");
      setConnected(false);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error("[dashboard-ws] WebSocket error:", err);
      ws.close();
    };
  }, [auth.token]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket]);

  // ── Replay Missions Fetch & Selection ───────────────────────────────────────
  const fetchMissions = useCallback(async () => {
    setMissionsLoading(true);
    setMissionsError("");
    try {
      const res = await fetch("/api/missions");
      if (!res.ok) throw new Error("Failed to load missions");
      const data = await res.json();
      setMissions(data);
      if (data.length > 0) {
        setSelectedMissionId((currentId) => currentId || data[0].id);
      }
    } catch (err) {
      console.error("[dashboard] Failed to fetch missions:", err);
      setMissionsError(err.message || "Failed to load missions");
    } finally {
      setMissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "replay" || mode === "analytics") {
      fetchMissions();
    }
  }, [mode, fetchMissions]);

  // Load telemetry for selected mission
  useEffect(() => {
    if (mode !== "replay" || !selectedMissionId) return;

    fetch(`/api/missions/${encodeURIComponent(selectedMissionId)}/telemetry`)
      .then((res) => (res.ok ? res.json() : []))
      .then((packets) => {
        setReplayPackets(packets);
        if (packets.length > 0) {
          const minTs = packets[0].timestamp;
          const maxTs = packets[packets.length - 1].timestamp;
          setReplayRange({ min: minTs, max: maxTs });
          setReplayTime(minTs);
        } else {
          setReplayRange({ min: 0, max: 0 });
          setReplayTime(0);
        }
        setIsPlaying(false);
      })
      .catch((err) => console.error("[dashboard] Failed to load replay telemetry:", err));
  }, [mode, selectedMissionId]);

  // Replay playback timer
  useEffect(() => {
    if (!isPlaying || mode !== "replay") {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }

    const stepMs = 200;
    playTimerRef.current = setInterval(() => {
      setReplayTime((prev) => {
        if (prev === null) return prev;
        const next = prev + stepMs * playbackSpeed;
        if (next >= replayRange.max) {
          setIsPlaying(false);
          return replayRange.max;
        }
        return next;
      });
    }, stepMs);

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, replayRange.max, mode]);

  // ── Replay Mode Derived State ───────────────────────────────────────────────
  const replayState = useMemo(() => {
    if (mode !== "replay" || replayTime === null) {
      return { soldiers: {}, trails: {} };
    }

    const soldiersMap = {};
    const trailsMap = {};

    // Filter packets up to replayTime
    for (const pkt of replayPackets) {
      if (pkt.timestamp <= replayTime) {
        soldiersMap[pkt.soldierId] = pkt;

        // Keep trails in a 30s window preceding current replay time
        if (pkt.timestamp >= replayTime - 30_000) {
          if (!trailsMap[pkt.soldierId]) {
            trailsMap[pkt.soldierId] = [];
          }
          trailsMap[pkt.soldierId].push([pkt.x, pkt.altitude ?? 0, pkt.y]);
        }
      }
    }

    return { soldiers: soldiersMap, trails: trailsMap };
  }, [mode, replayTime, replayPackets]);

  // Current active soldiers, trails, alerts depending on mode and differential correction state
  const activeSoldiers = useMemo(() => {
    const base = mode === "replay" ? replayState.soldiers : liveSoldiers;
    if (correctionEnabled) return base;

    // When weather drift correction is toggled OFF, display uncorrected raw altitude and floor
    const uncorrected = {};
    for (const [id, s] of Object.entries(base)) {
      const rawAlt = s.rawAltitude ?? s.altitude ?? 0;
      const rawFloorNum = Math.round(rawAlt / 3.5);
      uncorrected[id] = {
        ...s,
        altitude: rawAlt,
        estimatedFloor: floorNumberToLabel(rawFloorNum),
      };
    }
    return uncorrected;
  }, [mode, replayState.soldiers, liveSoldiers, correctionEnabled]);

  const activeTrails = mode === "replay" ? replayState.trails : liveTrails;
  const activeAlerts = mode === "replay" ? [] : liveAlerts;

  // ── Calculate Unit Counts per Floor ─────────────────────────────────────────
  const unitCounts = useMemo(() => {
    const counts = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
      0: 0,
      "-1": 0,
      "-2": 0,
    };
    for (const soldier of Object.values(activeSoldiers)) {
      if (soldier.estimatedFloor) {
        const fNum = floorLabelToNumber(soldier.estimatedFloor);
        counts[fNum] = (counts[fNum] ?? 0) + 1;
      }
    }
    return counts;
  }, [activeSoldiers]);

  // ── Alert Actions ───────────────────────────────────────────────────────────
  const handleAcknowledgeAlert = async (id) => {
    const acknowledgedAt = Date.now();
    setLiveAlerts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, acknowledged: true, acknowledgedBy: auth.role, acknowledgedAt } : a
      )
    );
    try {
      const response = await fetch(apiUrl(`/api/alerts/${encodeURIComponent(id)}/acknowledge`), {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) throw new Error("Failed to acknowledge alert");
      const alert = await response.json();
      setLiveAlerts((previous) => previous.map((item) => item.id === id ? alert : item));
    } catch (error) {
      console.error("[dashboard] Failed to persist alert acknowledgement:", error);
    }
  };

  const handleClearAlert = async (id) => {
    setLiveAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      const response = await fetch(apiUrl(`/api/alerts/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) throw new Error("Failed to resolve alert");
    } catch (error) {
      console.error("[dashboard] Failed to persist alert resolution:", error);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-nsg-dark overflow-hidden font-mono">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-12 bg-nsg-surface border-b border-nsg-border flex-shrink-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-nsg-accent font-bold tracking-widest text-lg">
            HIT-TRACKER
          </span>
          <span className="text-xs text-gray-400 border border-nsg-border rounded px-2 py-0.5 uppercase">
            NSG ICP
          </span>
          <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 rounded px-1.5 py-0.5 uppercase font-bold">
            {auth.role}
          </span>

          {/* Mode Switcher: LIVE vs REPLAY */}
          <div className="flex items-center ml-2 bg-black/40 border border-nsg-border rounded p-0.5">
            <button
              onClick={() => {
                setMode("live");
                setIsPlaying(false);
              }}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors ${
                mode === "live"
                  ? "bg-nsg-accent text-nsg-dark"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Live
            </button>
            <button
              onClick={() => {
                setMode("replay");
                setIsPlaying(false);
              }}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors ${
                mode === "replay"
                  ? "bg-blue-500 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Replay
            </button>
            <button
              onClick={() => {
                setMode("analytics");
                setIsPlaying(false);
              }}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-colors ${
                mode === "analytics"
                  ? "bg-emerald-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Analytics
            </button>
          </div>
        </div>

        {/* Live Status indicator */}
        <div className="flex items-center gap-2">
          {mode === "live" ? (
            <>
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connected ? "bg-nsg-accent animate-pulse" : "bg-red-500"
                }`}
              />
              <span className="text-xs font-bold text-gray-300">
                {connected ? "LIVE TELEMETRY" : "CONNECTING..."}
              </span>
              <span className="text-[10px] text-gray-500 ml-2">
                ({Object.keys(activeSoldiers).length} soldiers online)
              </span>
            </>
          ) : mode === "replay" ? (
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs font-bold text-blue-300 tracking-wider uppercase">
                Mission Replay Mode ({replayPackets.length} pkts)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="text-xs font-bold text-emerald-300 tracking-wider uppercase">
                Mission Analytics
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Barometer Calibration */}
          <button
            onClick={() => setIsBaroModalOpen(true)}
            className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-950/60 text-[10px] text-emerald-300 uppercase font-bold tracking-wider transition-colors flex items-center gap-1.5"
            title="Differential Barometer Calibration & Weather Drift Comparison"
          >
            <span>Barometer</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                correctionEnabled ? "bg-emerald-400" : "bg-red-400 animate-pulse"
              }`}
            />
          </button>

          {/* Commander Tools */}
          {auth.role === "commander" && (
            <>
              <button
                onClick={() => setIsCalibrationOpen(true)}
                className="px-2 py-1 rounded border border-nsg-border bg-nsg-dark hover:bg-nsg-border/50 text-[10px] text-nsg-accent uppercase font-bold tracking-wider transition-colors"
              >
                Calibration
              </button>
              <button
                onClick={() => setIsSecurityLogOpen(true)}
                className="px-2 py-1 rounded border border-red-500/40 bg-red-950/30 hover:bg-red-950/60 text-[10px] text-red-300 uppercase font-bold tracking-wider transition-colors"
              >
                Security Log
              </button>
            </>
          )}

          <span className="text-xs text-gray-400">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <button
            onClick={onLogout}
            className="text-xs text-gray-400 hover:text-nsg-danger transition-colors uppercase tracking-widest font-bold"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {mode === "analytics" ? (
          <main className="flex-1 min-w-0 overflow-y-auto bg-nsg-dark">
            <MissionAnalytics
              missions={missions}
              missionsLoading={missionsLoading}
              missionsError={missionsError}
              selectedMissionId={selectedMissionId}
              onSelectMission={setSelectedMissionId}
            />
          </main>
        ) : (
          <>
            {/* Left: Floor Selector with Unit Counts */}
            <aside className="w-16 bg-nsg-surface border-r border-nsg-border flex flex-col items-center py-3 gap-2 flex-shrink-0 z-20">
              <FloorSelector
                floors={[5, 4, 3, 2, 1, 0, -1, -2]}
                activeFloor={activeFloor}
                onSelect={setActiveFloor}
                unitCounts={unitCounts}
              />
            </aside>

            {/* Centre: 3D Viewport */}
            <main className="flex-1 relative overflow-hidden bg-nsg-dark">
              <Viewport
                floor={activeFloor}
                floorMode={floorMode}
                onFloorModeChange={setFloorMode}
                soldiers={activeSoldiers}
                trails={activeTrails}
                selectedSoldierId={selectedSoldierId}
                calibration={calibration}
                alerts={activeAlerts}
              />

              {/* Floating Alerts Overlay (Live mode) */}
              {mode === "live" && (
                <AlertsPanel
                  alerts={activeAlerts}
                  onAcknowledge={handleAcknowledgeAlert}
                  onClear={handleClearAlert}
                />
              )}
            </main>

            {/* Right: Roster Panel grouped by HIT */}
            <aside className="w-72 bg-nsg-surface border-l border-nsg-border overflow-y-auto flex-shrink-0 z-20">
              <Roster
                role={auth.role}
                soldiers={activeSoldiers}
                alerts={activeAlerts}
                onSelectSoldier={(id) => {
                  setSelectedSoldierId(id);
                  // Focus floor on selected soldier's floor if available
                  const s = activeSoldiers[id];
                  if (s && s.estimatedFloor) {
                    setActiveFloor(floorLabelToNumber(s.estimatedFloor));
                  }
                }}
              />
            </aside>
          </>
        )}
      </div>

      {/* ── Replay Scrubber Controls (Replay mode only) ───────────────────── */}
      {mode === "replay" && (
        <ReplayControls
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          playbackSpeed={playbackSpeed}
          onChangeSpeed={setPlaybackSpeed}
          currentTime={replayTime}
          startTime={replayRange.min}
          endTime={replayRange.max}
          onSeek={(newTime) => setReplayTime(newTime)}
          missions={missions}
          selectedMissionId={selectedMissionId}
          onSelectMission={(id) => setSelectedMissionId(id)}
        />
      )}

      {/* ── Barometer Calibration Modal ──────────────────────────────────── */}
      <BarometerCalibrationModal
        isOpen={isBaroModalOpen}
        onClose={() => setIsBaroModalOpen(false)}
        soldiers={liveSoldiers}
        selectedSoldierId={selectedSoldierId}
        onSelectSoldier={setSelectedSoldierId}
        correctionEnabled={correctionEnabled}
        onToggleCorrection={() => setCorrectionEnabled(!correctionEnabled)}
        referencePressure={referencePressure}
        history={baroHistory}
      />

      {/* ── Commander Modals ─────────────────────────────────────────────── */}
      {auth.role === "commander" && (
        <>
          <ModelCalibrationModal
            isOpen={isCalibrationOpen}
            onClose={() => setIsCalibrationOpen(false)}
            calibration={calibration}
            onChangeCalibration={setCalibration}
            onSaveCalibration={handleSaveCalibration}
            authToken={auth.token}
            role={auth.role}
          />
          <SecurityLogModal
            isOpen={isSecurityLogOpen}
            onClose={() => setIsSecurityLogOpen(false)}
            authToken={auth.token}
            role={auth.role}
          />
        </>
      )}
    </div>
  );
}
