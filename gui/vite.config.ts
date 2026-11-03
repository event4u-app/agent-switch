import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tauri expects a fixed dev port and a relative base for the bundled assets.
  clearScreen: false,
  base: "./",
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        pet: fileURLToPath(new URL("./pet.html", import.meta.url)),
        tray: fileURLToPath(new URL("./tray.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Tests assert English copy: pin en regardless of the machine's language.
    setupFiles: ["src/i18n/test-setup.ts"],
    // The theme test reads index.css as text (?raw); vitest empties CSS it does not include.
    css: { include: [/index\.css/] },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/v3/design-fixture/**"],
      reporter: ["text-summary"],
      // Floor = the 2026-11-01 measurement minus 1 point, rounded down. Raise it
      // when coverage rises; never lower it (roadmap 4.2).
      thresholds: { lines: 78, statements: 78, branches: 82, functions: 69 },
    },
  },
});
