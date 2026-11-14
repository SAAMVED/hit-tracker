import { useState, useEffect } from "react";

export default function SecurityLogModal({
  isOpen,
  onClose,
  authToken,
  role,
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchLogs = async () => {
    if (!authToken || role !== "commander") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/rejected", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Audit request failed: ${res.statusText}`);
      }
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, authToken]);

  if (!isOpen || role !== "commander") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none">
      <div className="bg-nsg-surface border border-nsg-border rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-mono text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-nsg-dark border-b border-nsg-border">
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-bold tracking-widest uppercase">
              Security Audit Log — Rejected Telemetry
            </span>
            <span className="text-[10px] bg-red-950/80 border border-red-500/50 text-red-300 px-1.5 py-0.5 rounded uppercase font-bold">
              {logs.length} DROPPED
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="text-[11px] text-gray-300 hover:text-white px-2 py-0.5 rounded border border-nsg-border hover:bg-nsg-surface transition-colors"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-base leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[70vh] overflow-y-auto space-y-2">
          {error && (
            <div className="p-2 rounded bg-red-950/50 border border-red-500/50 text-red-300">
              {error}
            </div>
          )}

          {logs.length === 0 && !loading && (
            <div className="text-center py-8 text-gray-500 font-medium">
              No rejected packets recorded. All telemetry within standard bounds.
            </div>
          )}

          {logs.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const timeStr = new Date(entry.timestamp).toLocaleTimeString();

            return (
              <div
                key={entry.id || `${entry.soldierId}-${entry.timestamp}`}
                className="p-2.5 rounded border border-red-900/40 bg-red-950/20 hover:bg-red-950/30 transition-colors flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-400">
                      [{entry.soldierId}]
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/60 text-red-200 border border-red-600/50 uppercase">
                      {entry.reason}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    <span>{timeStr}</span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="text-nsg-accent hover:underline uppercase font-bold"
                    >
                      {isExpanded ? "Hide Payload" : "View Raw"}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <pre className="p-2 mt-1 rounded bg-black/60 border border-nsg-border/60 text-[10px] text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {entry.rawPayload}
                  </pre>
                )}
              </div>
            );
          })}
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
