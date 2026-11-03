import React from "react";
import { createRoot } from "react-dom/client";
import RedesignApp from "./redesign/RedesignApp.js";
import V3App from "./v3/adapter/V3App.js";
import { getUiWindow } from "./settings-store.js";
import { applyAppearance, loadAppearance } from "./v3/adapter/appearance.js";
import "./index.css";
import { applyTheme, getTheme } from "./theme.js";
import { applyAutostartDefault } from "./ipc.js";

// Apply the saved theme before first paint so there is no flash.
applyTheme(getTheme());
if (getUiWindow() === "v3") applyAppearance(loadAppearance(), typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
// Default launch-at-login to ON on the first run (one-shot; respects later opt-out).
void applyAutostartDefault();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {getUiWindow() === "v3" ? <V3App /> : <RedesignApp />}
  </React.StrictMode>,
);
