import { useState } from "react";
import type { AuthState } from "../App.tsx";
import FloorSelector from "./FloorSelector.tsx";
import Roster from "./Roster.tsx";
import Viewport from "./Viewport.tsx";

interface Props {
  auth: AuthState;
  onLogout: () => void;
}

export default function Dashboard({ auth, onLogout }: Props) {
  const [activeFloor, setActiveFloor] = useState(0);

  return (
    <div className="h-screen w-screen flex flex-col bg-nsg-dark overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-12 bg-nsg-surface border-b border-nsg-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-nsg-accent font-bold tracking-widest text-lg">HIT-TRACKER</span>
          <span className="text-xs text-gray-500 border border-nsg-border rounded px-2 py-0.5 uppercase">
            {auth.role}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-nsg-accent animate-pulse" title="Live" />
          <span className="text-xs text-gray-400">LIVE</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <button
            onClick={onLogout}
            className="text-xs text-gray-400 hover:text-nsg-danger transition-colors uppercase tracking-widest"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Floor Selector */}
        <aside className="w-16 bg-nsg-surface border-r border-nsg-border flex flex-col items-center py-4 gap-2 flex-shrink-0">
          <FloorSelector
            floors={[3, 2, 1, 0, -1]}
            activeFloor={activeFloor}
            onSelect={setActiveFloor}
          />
        </aside>

        {/* Centre: 3D Viewport */}
        <main className="flex-1 relative overflow-hidden">
          <Viewport floor={activeFloor} />
        </main>

        {/* Right: Roster */}
        <aside className="w-64 bg-nsg-surface border-l border-nsg-border overflow-y-auto flex-shrink-0">
          <Roster role={auth.role} />
        </aside>
      </div>
    </div>
  );
}
