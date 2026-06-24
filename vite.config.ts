import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// UI dev server on :5173, proxies API + media to the Bun server on :8787.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/media": "http://localhost:8787",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
