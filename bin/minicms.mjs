#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const viteConfig = path.join(packageRoot, "admin", "vite.config.js");
const args = process.argv.slice(2);
const command = args.shift();
const host = process.env.HOST || "127.0.0.1";
const adminPort = Number(process.env.ADMIN_PORT || 5173);

async function runTests() {
  const testFiles = [
    path.join(packageRoot, "core", "content.test.mjs"),
    path.join(packageRoot, "core", "connectors.test.mjs"),
    path.join(packageRoot, "core", "inline-reference.test.mjs"),
    path.join(packageRoot, "core", "image-service.test.mjs"),
    path.join(packageRoot, "core", "media.test.mjs"),
    path.join(packageRoot, "core", "slug.test.mjs"),
    path.join(packageRoot, "admin", "src", "adapters", "api.test.mjs"),
    path.join(packageRoot, "admin", "src", "adapters", "connectors.test.mjs"),
    path.join(packageRoot, "admin", "src", "adapters", "github.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "auth.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "advancedFilter.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "configuration.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "editor.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "image.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "imageGeometry.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "markdown.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "nodeFactory.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "reference.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "referenceSets.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "tags.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "views.test.mjs"),
    path.join(packageRoot, "content", "index.test.mjs"),
    path.join(packageRoot, "content", "fs.test.mjs"),
    path.join(
      packageRoot,
      "admin",
      "src",
      "components",
      "Preview",
      "preview.test.mjs"
    ),
    path.join(
      packageRoot,
      "admin",
      "src",
      "components",
      "Preview",
      "registration.test.mjs"
    ),
    path.join(packageRoot, "admin", "vite-plugin-inline-css.test.mjs")
  ];
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    cwd: packageRoot,
    stdio: "inherit"
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  process.exitCode = exitCode ?? 1;
}

async function runBuild() {
  await build({ configFile: viteConfig });
}

async function runDev() {
  const vite = await createServer({
    configFile: viteConfig,
    server: {
      host,
      port: adminPort
    }
  });
  await vite.listen();
  vite.printUrls();

  const close = () => vite.close();
  process.once("SIGINT", async () => {
    await close();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await close();
    process.exit(0);
  });
}

async function main() {
  if (args.length) {
    throw new Error(`Unknown argument${args.length === 1 ? "" : "s"}: ${args.join(" ")}`);
  }

  switch (command) {
    case "dev":
      await runDev();
      break;
    case "build":
      await runBuild();
      break;
    case "test":
      await runTests();
      break;
    default:
      console.log(`miniCMS

Usage:
  minicms dev
  minicms build
  minicms test

Environment:
  ADMIN_PORT       Vite development port (default: 5173)
  HOST             Listening host (default: 127.0.0.1)
  MINICMS_API_URL  Direct API origin (default: http://127.0.0.1:8787)`);
      if (command) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
