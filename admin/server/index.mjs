import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "..", "..");
const rootDir = path.resolve(process.env.MINICMS_PROJECT_ROOT || packageRoot);
const port = Number(process.env.PORT || 8787);
const serveAdmin = process.env.NODE_ENV === "production";

const app = createApp({ rootDir, serveAdmin });

app.listen(port, "127.0.0.1", () => {
  console.log(`Content API listening on http://127.0.0.1:${port}`);
  if (serveAdmin) console.log("Serving the built admin application.");
});
