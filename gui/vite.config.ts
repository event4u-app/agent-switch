import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed dev port and a relative base for the bundled assets.
  clearScreen: false,
  base: "./",
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
