import { useState, FormEvent } from "react";
import type { AuthState } from "../App.tsx";

interface Props {
  onLogin: (auth: AuthState) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Login failed");
        return;
      }

      const data = await res.json() as { token: string; role: "commander" | "viewer" };
      onLogin({ token: data.token, role: data.role });
    } catch {
      setError("Cannot reach server – check network connection");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-nsg-dark">
      <div className="w-full max-w-sm space-y-6 p-8 bg-nsg-surface rounded-xl border border-nsg-border shadow-2xl">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="text-3xl font-bold tracking-widest text-nsg-accent">HIT-TRACKER</div>
          <div className="text-xs text-gray-500 uppercase tracking-widest">
            National Security Guard — ICP Dashboard
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full bg-nsg-dark border border-nsg-border rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-nsg-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-nsg-dark border border-nsg-border rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-nsg-accent"
            />
          </div>

          {error && (
            <div className="text-nsg-danger text-xs border border-nsg-danger/40 bg-nsg-danger/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-nsg-accent hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-nsg-dark font-bold rounded text-sm uppercase tracking-widest transition-colors"
          >
            {loading ? "Authenticating…" : "Secure Login"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600">
          OFFLINE MODE — no external connectivity required
        </p>
      </div>
    </div>
  );
}
