import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adminRoot = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.PORT || 8787);
const adminPort = Number(process.env.ADMIN_PORT || 5173);

export default defineConfig({
  root: adminRoot,
  base: "./",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  define: {
    __MINICMS_ADAPTER_OVERRIDE__: JSON.stringify(
      process.env.MINICMS_ADAPTER_OVERRIDE || ""
    )
  },
  server: {
    host: "127.0.0.1",
    port: adminPort,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/media": `http://127.0.0.1:${apiPort}`
    }
  },
  build: {
    outDir: path.join(adminRoot, "dist"),
    emptyOutDir: true
  }
});
