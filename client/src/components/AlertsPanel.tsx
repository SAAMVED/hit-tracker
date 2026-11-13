import type { Alert } from "@hit-tracker/shared";

interface Props {
  alerts: Alert[];
  onAcknowledge: (id: string) => void;
  onClear: (id: string) => void;
}

export default function AlertsPanel({ alerts, onAcknowledge, onClear }: Props) {
  if (alerts.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-20 right-72 z-20 pointer-events-none flex flex-col gap-2 max-h-48 overflow-y-auto">
      {alerts.slice(0, 5).map((alert) => {
        const isCritical = alert.severity === "critical";
        const isWarning = alert.severity === "warning";

        const bgClass = isCritical
          ? "bg-red-950/90 border-red-500/80 text-red-200"
          : isWarning
          ? "bg-amber-950/90 border-amber-500/80 text-amber-200"
          : "bg-blue-950/90 border-blue-500/80 text-blue-200";

        const badgeClass = isCritical
          ? "bg-red-500 text-white animate-pulse"
          : isWarning
          ? "bg-amber-500 text-black"
          : "bg-blue-500 text-white";

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto flex items-center justify-between px-3 py-2 rounded border shadow-lg backdrop-blur-sm text-xs transition-all ${bgClass}`}
          >
            <div className="flex items-center gap-3">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                {alert.type.replace("_", " ")}
              </span>
              <span className="font-mono">{alert.message}</span>
              <span className="text-[10px] opacity-60">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!alert.acknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="px-2 py-0.5 rounded bg-black/40 hover:bg-black/60 border border-white/20 text-[10px] uppercase font-bold tracking-wider transition-colors"
                >
                  Ack
                </button>
              )}
              <button
                onClick={() => onClear(alert.id)}
                className="opacity-50 hover:opacity-100 text-sm px-1"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
