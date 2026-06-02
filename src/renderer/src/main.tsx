import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";

function App() {
  const [pong, setPong] = useState<string>("…");

  useEffect(() => {
    window.openma
      .ping("phase-1")
      .then(setPong)
      .catch((e: unknown) => setPong(`ipc error: ${String(e)}`));
  }, []);

  return (
    <main className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-medium tracking-tight">openma desktop</h1>
        <p className="mt-3 text-sm opacity-60">phase 1 scaffold</p>
        <p className="mt-6 text-xs font-mono opacity-50">main ⇄ renderer: {pong}</p>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
