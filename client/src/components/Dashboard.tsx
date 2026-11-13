import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { Alert } from "@hit-tracker/shared";
import { floorLabelToNumber } from "@hit-tracker/shared";
import type { AuthState } from "../App.tsx";
import FloorSelector from "./FloorSelector.tsx";
import Roster, { type SoldierStateDisplay } from "./Roster.tsx";
import Viewport, { type FloorMode } from "./Viewport.tsx";
import AlertsPanel from "./AlertsPanel.tsx";
import { playCriticalAlertBeep } from "../utils/audio.ts";

interface Props {
  auth: AuthState;
  onLogout: () => void;
}

export default function Dashboard({ auth, onLogout }: Props) {
  const [activeFloor, setActiveFloor] = useState<number>(0);
  const [floorMode, setFloorMode] = useState<FloorMode>("cutaway");
  const [connected, setConnected] = useState<boolean>(false);
  const [soldiers, setSoldiers] = useState<Record<string, SoldierStateDisplay>>({});
  const [trails, setTrails] = useState<Record<string, [number, number, number][]>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedSoldierId, setSelectedSoldierId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── WebSocket Pipeline ───────────────────────────────────────────────────────
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
          const list: SoldierStateDisplay[] = msg.payload || msg.soldiers || [];
          setSoldiers((prev) => {
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
          const s: SoldierStateDisplay = msg.payload || msg;
          if (s && s.soldierId) {
            setSoldiers((prev) => ({
              ...prev,
              [s.soldierId]: s,
            }));

            // Record breadcrumb trail point
            setTrails((prev) => {
              const currentTrail = prev[s.soldierId] ?? [];
              const newPoint: [number, number, number] = [s.x, s.altitude, s.y];
              // Keep maximum of 30 trail points per soldier
              const updated = [...currentTrail.slice(-29), newPoint];
              return { ...prev, [s.soldierId]: updated };
            });
          }
        }

        // 4. Alert Event
        else if (msg.type === "alert") {
          const alert: Alert = msg.payload || msg;
          if (alert && alert.id) {
            if (alert.severity === "critical") {
              // Play tactical audio beep for critical alert
              playCriticalAlertBeep();
            }

            setAlerts((prev) => {
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

  // ── Calculate Unit Counts per Floor ─────────────────────────────────────────
  const unitCounts = useMemo(() => {
    const counts: Record<number, number> = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
      0: 0,
      "-1": 0,
      "-2": 0,
    };
    for (const soldier of Object.values(soldiers)) {
      if (soldier.estimatedFloor) {
        const fNum = floorLabelToNumber(soldier.estimatedFloor);
        counts[fNum] = (counts[fNum] ?? 0) + 1;
      }
    }
    return counts;
  }, [soldiers]);

  // ── Alert Actions ───────────────────────────────────────────────────────────
  const handleAcknowledgeAlert = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, acknowledged: true, acknowledgedBy: auth.role } : a
      )
    );
  };

  const handleClearAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
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
        </div>

        {/* Live Status indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connected ? "bg-nsg-accent animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-xs font-bold text-gray-300">
            {connected ? "LIVE TELEMETRY" : "CONNECTING..."}
          </span>
          <span className="text-[10px] text-gray-500 ml-2">
            ({Object.keys(soldiers).length} soldiers online)
          </span>
        </div>

        <div className="flex items-center gap-4">
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
            soldiers={soldiers}
            trails={trails}
            selectedSoldierId={selectedSoldierId}
          />

          {/* Floating Alerts Overlay */}
          <AlertsPanel
            alerts={alerts}
            onAcknowledge={handleAcknowledgeAlert}
            onClear={handleClearAlert}
          />
        </main>

        {/* Right: Roster Panel grouped by HIT */}
        <aside className="w-72 bg-nsg-surface border-l border-nsg-border overflow-y-auto flex-shrink-0 z-20">
          <Roster
            role={auth.role}
            soldiers={soldiers}
            alerts={alerts}
            onSelectSoldier={(id) => {
              setSelectedSoldierId(id);
              // Focus floor on selected soldier's floor if available
              const s = soldiers[id];
              if (s && s.estimatedFloor) {
                setActiveFloor(floorLabelToNumber(s.estimatedFloor));
              }
            }}
          />
        </aside>
      </div>
    </div>
  );
}
