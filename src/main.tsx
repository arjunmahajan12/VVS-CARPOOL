import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Restore the saved theme before first paint.
try {
  const t = localStorage.getItem("theme");
  if (t === "dark") document.documentElement.classList.add("dark");
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
