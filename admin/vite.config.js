import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlineCssPlugin } from "./vite-plugin-inline-css.js";

const adminRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(adminRoot, "..");
const apiPort = Number(process.env.PORT || 8787);
const adminPort = Number(process.env.ADMIN_PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const apiUrl = process.env.MINICMS_API_URL || `http://127.0.0.1:${apiPort}`;
process.env.MINICMS_PUBLIC_API_URL = apiUrl;

export const markdownOptimizeDependencies = [
  "@blocknote/core",
  "@blocknote/core/extensions",
  "@blocknote/core/locales",
  "@blocknote/mantine",
  "@blocknote/react"
];

export default defineConfig({
  root: adminRoot,
  base: "./",
  envPrefix: "MINICMS_PUBLIC_",
  plugins: [react(), inlineCssPlugin()],
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  optimizeDeps: {
    include: markdownOptimizeDependencies
  },
  server: {
    host,
    port: adminPort
  },
  build: {
    outDir: path.join(packageRoot, "dist"),
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.join(adminRoot, "src", "main.jsx"),
      output: {
        format: "iife",
        entryFileNames: "minicms.js",
        inlineDynamicImports: true
      }
    }
  }
});
