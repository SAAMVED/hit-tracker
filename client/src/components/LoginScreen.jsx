import { useState } from "react";

const CAPABILITIES = [
  "Live HIT tracking",
  "3D building visualization",
  "Floor-level location awareness",
  "Mission replay and analytics",
];

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
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
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        return;
      }

      const data = await res.json();
      onLogin({ token: data.token, role: data.role });
    } catch {
      setError("Cannot reach server – check network connection");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-nsg-dark text-gray-100">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 items-center gap-10 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] lg:gap-16 lg:px-12">
        <section className="mx-auto w-full max-w-2xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-nsg-border bg-nsg-surface/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
            <span className="h-2 w-2 rounded-full bg-nsg-accent" />
            Integrated Command Post Platform
          </div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-nsg-accent sm:text-base">
            HIT-TRACKER – NSG Integrated Command Post
          </p>
          <h1 className="mt-5 max-w-xl text-3xl font-bold leading-tight tracking-wide text-white sm:text-4xl lg:text-5xl">
            Indoor situational awareness for every mission.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-gray-400 sm:text-base">
            Monitor House Intervention Teams (HITs) and soldiers in real time as they move through multi-floor buildings and basements. Bring live telemetry, floor-level awareness, and mission review together at the ICP.
          </p>

          <div className="mt-9">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Operational capabilities
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {CAPABILITIES.map((capability) => (
                <li key={capability} className="flex items-center gap-3 rounded-lg border border-nsg-border/80 bg-nsg-surface/50 px-4 py-3 text-sm text-gray-200">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-emerald-500/30 bg-emerald-950/40 text-xs font-bold text-nsg-accent" aria-hidden="true">
                    ✓
                  </span>
                  {capability}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="rounded-xl border border-nsg-border bg-nsg-surface p-6 shadow-2xl shadow-black/30 sm:p-8">
            <div className="mb-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-nsg-accent">
                Secure access
              </p>
              <h2 className="mt-2 text-xl font-bold tracking-wide text-white">
                Authorized Personnel Login
              </h2>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                Sign in with your credentials to access the command post dashboard.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full rounded border border-nsg-border bg-nsg-dark px-3 py-2.5 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-nsg-accent focus:ring-1 focus:ring-nsg-accent"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded border border-nsg-border bg-nsg-dark px-3 py-2.5 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-nsg-accent focus:ring-1 focus:ring-nsg-accent"
                />
              </div>

              {error && (
                <div role="alert" className="rounded border border-nsg-danger/40 bg-nsg-danger/10 px-3 py-2 text-xs text-nsg-danger">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded bg-nsg-accent py-2.5 text-sm font-bold uppercase tracking-widest text-nsg-dark transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Authenticating…" : "Sign in securely"}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 border-t border-nsg-border pt-5 text-[10px] uppercase tracking-wider text-gray-500">
              <span aria-hidden="true">◆</span>
              Offline-capable · Protected access
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
