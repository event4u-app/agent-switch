import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./index.css";
import { applyTheme, getTheme } from "./theme.js";
import { applyAutostartDefault } from "./ipc.js";

// Apply the saved theme before first paint so there is no flash.
applyTheme(getTheme());
// Default launch-at-login to ON on the first run (one-shot; respects later opt-out).
void applyAutostartDefault();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
