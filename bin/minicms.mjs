#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { createApp } from "../admin/server/app.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const viteConfig = path.join(packageRoot, "admin", "vite.config.js");
const args = process.argv.slice(2);
const command = args.shift();

function readOption(name) {
  const optionIndex = args.indexOf(name);
  if (optionIndex < 0) return null;
  const value = args[optionIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  args.splice(optionIndex, 2);
  return value;
}

const explicitProjectRoot = readOption("--project-root");
const projectRoot = path.resolve(
  explicitProjectRoot ||
    process.env.MINICMS_PROJECT_ROOT ||
    process.cwd()
);
const host = process.env.HOST || "127.0.0.1";
const apiPort = Number(process.env.PORT || 8787);
const adminPort = Number(process.env.ADMIN_PORT || 5173);

async function assertProject() {
  try {
    await access(path.join(projectRoot, "cms.config.yml"));
  } catch {
    throw new Error(
      `No cms.config.yml found in ${projectRoot}. Run miniCMS from the content project's root or pass --project-root.`
    );
  }
}

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });
}

async function runTests() {
  const testFiles = [
    path.join(packageRoot, "admin", "server", "api.test.mjs"),
    path.join(packageRoot, "admin", "shared", "slug.test.mjs"),
    path.join(packageRoot, "admin", "src", "model", "views.test.mjs")
  ];
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    cwd: packageRoot,
    stdio: "inherit"
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  process.exitCode = exitCode ?? 1;
}

async function runDev() {
  await assertProject();
  const apiServer = await listen(createApp({ rootDir: projectRoot }), apiPort);
  const vite = await createServer({
    configFile: viteConfig,
    server: {
      host,
      port: adminPort,
      proxy: {
        "/api": `http://${host}:${apiPort}`,
        "/media": `http://${host}:${apiPort}`
      }
    }
  });
  await vite.listen();
  console.log(`Content API listening on http://${host}:${apiPort}`);
  vite.printUrls();

  const close = async () => {
    await vite.close();
    await new Promise((resolve) => apiServer.close(resolve));
  };
  process.once("SIGINT", async () => {
    await close();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await close();
    process.exit(0);
  });
}

async function runProduction() {
  await assertProject();
  const server = await listen(
    createApp({ rootDir: projectRoot, serveAdmin: true }),
    apiPort
  );
  console.log(`miniCMS listening on http://${host}:${apiPort}`);

  const close = () =>
    new Promise((resolve) => server.close(resolve));
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
      await build({ configFile: viteConfig });
      break;
    case "start":
      await runProduction();
      break;
    case "test":
      await runTests();
      break;
    default:
      console.log(`miniCMS

Usage:
  minicms dev [--project-root <path>]
  minicms build
  minicms start [--project-root <path>]
  minicms test

Environment:
  PORT        API/production port (default: 8787)
  ADMIN_PORT  Vite development port (default: 5173)
  HOST        Listening host (default: 127.0.0.1)`);
      if (command) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
