import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const packageRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(packageRoot, "dist");
const entries = await readdir(outputDirectory, { withFileTypes: true });

assert.deepEqual(
  entries.map((entry) => entry.name),
  ["minicms.js"],
  "dist/ must contain only minicms.js"
);
assert.equal(entries[0].isFile(), true, "dist/minicms.js must be a file");

const source = await readFile(path.join(outputDirectory, "minicms.js"), "utf8");
assert.match(
  source,
  /data-minicms-styles/,
  "minicms.js must contain its stylesheet"
);
new vm.Script(source, { filename: "minicms.js" });

console.log("Verified standalone dist/minicms.js.");
