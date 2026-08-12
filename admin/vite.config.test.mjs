import assert from "node:assert/strict";
import test from "node:test";
import viteConfig, { markdownOptimizeDependencies } from "./vite.config.js";

test("development prebundles every dependency imported by the lazy Markdown editor", () => {
  assert.deepEqual(markdownOptimizeDependencies, [
    "@blocknote/core",
    "@blocknote/core/extensions",
    "@blocknote/core/locales",
    "@blocknote/mantine",
    "@blocknote/react"
  ]);
  assert.deepEqual(
    viteConfig.optimizeDeps.include,
    markdownOptimizeDependencies
  );
});
