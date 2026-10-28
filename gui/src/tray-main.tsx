/**
 * Tray popover entry (tray.html). A borderless window Rust shows next to the
 * menu-bar icon on left click and hides on blur; it renders the redesign's tray
 * card over the same view model as the main window.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TrayApp from "./redesign/tray/TrayApp.js";
import { applyTheme, getTheme } from "./theme.js";

applyTheme(getTheme());
// The main window writes the theme; follow it live (shared localStorage).
window.addEventListener("storage", (e) => {
  if (e.key === null || e.key === "agent-switch-theme") applyTheme(getTheme());
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TrayApp />
  </React.StrictMode>,
);
