import { useState } from "react";
import LoginScreen from "./components/LoginScreen.tsx";
import Dashboard from "./components/Dashboard.tsx";

export interface AuthState {
  token: string;
  role: "commander" | "viewer";
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  if (!auth) {
    return <LoginScreen onLogin={setAuth} />;
  }

  return <Dashboard auth={auth} onLogout={() => setAuth(null)} />;
}
