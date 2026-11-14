import { useState } from "react";
import LoginScreen from "./components/LoginScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const [auth, setAuth] = useState(null);

  if (!auth) {
    return <LoginScreen onLogin={setAuth} />;
  }

  return <Dashboard auth={auth} onLogout={() => setAuth(null)} />;
}
