import type { Alert, FloorLabel } from "@hit-tracker/shared";

export interface SoldierStateDisplay {
  soldierId: string;
  teamId: string;
  x: number;
  y: number;
  altitude: number;
  estimatedFloor: FloorLabel;
  batteryPct: number;
  timestamp: number;
  signal?: number;
}

const TEAMS = [
  {
    id: "Alpha",
    name: "Alpha (Assault 1)",
    colour: "bg-red-500",
    borderColour: "border-red-500/50",
    soldiers: [
      { id: "A1", name: "Nk Arjun Singh" },
      { id: "A2", name: "Sep Rahul Yadav" },
      { id: "A3", name: "Sep Vikram Mehra" },
      { id: "A4", name: "Sep Deepak Nair" },
    ],
  },
  {
    id: "Bravo",
    name: "Bravo (Assault 2)",
    colour: "bg-blue-500",
    borderColour: "border-blue-500/50",
    soldiers: [
      { id: "B1", name: "Hav Rajan Kumar" },
      { id: "B2", name: "Sep Suresh Patel" },
      { id: "B3", name: "Sep Arun Sharma" },
      { id: "B4", name: "Sep Kiran Joshi" },
    ],
  },
  {
    id: "Charlie",
    name: "Charlie (Support)",
    colour: "bg-amber-500",
    borderColour: "border-amber-500/50",
    soldiers: [
      { id: "C1", name: "Nk Pradeep Reddy" },
      { id: "C2", name: "Sep Ashok Verma" },
      { id: "C3", name: "Sep Rajesh Gupta" },
      { id: "C4", name: "Sep Mohan Das" },
    ],
  },
  {
    id: "Delta",
    name: "Delta (Basement / Breach)",
    colour: "bg-purple-500",
    borderColour: "border-purple-500/50",
    soldiers: [
      { id: "D1", name: "Hav Sunil Tiwari" },
      { id: "D2", name: "Sep Ramesh Pillai" },
      { id: "D3", name: "Sep Ganesh Iyer" },
      { id: "D4", name: "Sep Vinod Chandra" },
    ],
  },
];

interface Props {
  role: "commander" | "viewer";
  soldiers: Record<string, SoldierStateDisplay>;
  alerts: Alert[];
  onSelectSoldier?: (soldierId: string) => void;
}

export default function Roster({ role, soldiers, alerts, onSelectSoldier }: Props) {
  // Find active alerts for each soldier
  const soldierAlertMap = new Map<string, Alert>();
  for (const alert of alerts) {
    if (!alert.acknowledged) {
      // Prioritize critical over warning
      const existing = soldierAlertMap.get(alert.soldierId);
      if (!existing || alert.severity === "critical") {
        soldierAlertMap.set(alert.soldierId, alert);
      }
    }
  }

  return (
    <div className="p-3 space-y-4 text-xs font-mono select-none">
      <div className="flex items-center justify-between border-b border-nsg-border pb-2">
        <span className="text-gray-400 uppercase tracking-widest font-bold">
          HIT Roster (16)
        </span>
        <span className="text-[10px] text-nsg-accent bg-nsg-accent/10 border border-nsg-accent/30 rounded px-1.5 py-0.5 uppercase">
          {role === "commander" ? "CMD CTRL" : "VIEW ONLY"}
        </span>
      </div>

      {TEAMS.map((team) => (
        <div key={team.id} className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${team.colour}`} />
              <span className="font-bold text-gray-200 tracking-wider">
                {team.name}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            {team.soldiers.map((sDef) => {
              const live = soldiers[sDef.id];
              const alert = soldierAlertMap.get(sDef.id);
              const floor = live?.estimatedFloor ?? "G";
              const battery = live ? live.batteryPct : 0;
              const hasTelemetry = Boolean(live);

              // Battery color coding
              const batteryColor =
                battery > 50
                  ? "text-emerald-400"
                  : battery >= 20
                  ? "text-amber-400"
                  : "text-red-400 font-bold animate-pulse";

              return (
                <div
                  key={sDef.id}
                  onClick={() => onSelectSoldier?.(sDef.id)}
                  className={`flex flex-col gap-1 p-2 rounded border bg-nsg-surface/80 hover:bg-nsg-border/40 transition-colors cursor-pointer ${
                    alert?.severity === "critical"
                      ? "border-red-500 bg-red-950/20"
                      : alert?.severity === "warning"
                      ? "border-amber-500/80 bg-amber-950/20"
                      : "border-nsg-border/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-100">{sDef.id}</span>
                      <span className="text-[11px] text-gray-400 truncate max-w-[120px]">
                        {sDef.name}
                      </span>
                    </div>

                    {/* Floor badge */}
                    <span className="px-1.5 py-0.5 rounded bg-nsg-dark border border-nsg-accent/40 text-[10px] font-bold text-nsg-accent">
                      {floor}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-gray-400 pt-0.5">
                    {/* Battery indicator */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-8 h-2 rounded-sm bg-gray-800 border border-gray-700 overflow-hidden relative">
                        <div
                          className={`h-full transition-all ${
                            battery > 50
                              ? "bg-emerald-500"
                              : battery >= 20
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, battery))}%` }}
                        />
                      </div>
                      <span className={batteryColor}>{hasTelemetry ? `${battery}%` : "—"}</span>
                    </div>

                    {/* Status or Alert badge */}
                    {alert ? (
                      <span
                        className={`px-1 rounded text-[9px] font-bold uppercase ${
                          alert.severity === "critical"
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-amber-500/30 text-amber-300 border border-amber-500/40"
                        }`}
                      >
                        {alert.type === "signal_lost" ? "SIGNAL LOST" : "LOW BATT"}
                      </span>
                    ) : hasTelemetry ? (
                      <span className="text-[10px] text-gray-500">
                        {live?.altitude !== undefined ? `${live.altitude.toFixed(1)}m` : "LIVE"}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-600">WAITING</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
