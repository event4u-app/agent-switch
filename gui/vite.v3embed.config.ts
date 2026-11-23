// One-file IIFE of the real v3 window on fixture data for the Claude Design canvas:
// window.ASv3.mount(el, { view, theme, accent }). Fonts and icons inline.
// `npm run v3-embed` → dist-v3embed/as-v3.js + as-v3.css. Not shipped with the app.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    outDir: "dist-v3embed",
    emptyOutDir: true,
    assetsInlineLimit: 10_000_000,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/v3/design-fixture/embed.tsx", import.meta.url)),
      name: "ASv3",
      formats: ["iife"],
      fileName: () => "as-v3.js",
    },
    rollupOptions: { output: { assetFileNames: (a) => (a.names?.some((n) => n.endsWith(".css")) ? "as-v3.css" : "[name]-[hash][extname]") } },
  },
});
