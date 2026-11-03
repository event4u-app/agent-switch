/**
 * Tray popover entry (tray.html). A borderless window Rust shows next to the
 * menu-bar icon on left click and hides on blur; it renders the redesign's tray
 * card over the same view model as the main window.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TrayApp from "./redesign/tray/TrayApp.js";
import V3TrayApp from "./v3/adapter/V3TrayApp.js";
import { getUiWindow } from "./settings-store.js";
import { applyAppearance, loadAppearance } from "./v3/adapter/appearance.js";
import { applyTheme, getTheme } from "./theme.js";

const v3 = getUiWindow() === "v3";
const dark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
const apply = () => (v3 ? applyAppearance(loadAppearance(), dark()) : applyTheme(getTheme()));
apply();
// The main window writes the theme; follow it live (shared localStorage).
window.addEventListener("storage", (e) => {
  if (e.key === null || e.key === "agent-switch-theme" || e.key === "agent-switch-appearance") apply();
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {v3 ? <V3TrayApp /> : <TrayApp />}
  </React.StrictMode>,
);
