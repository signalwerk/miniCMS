import assert from "node:assert/strict";
import test from "node:test";
import { inlineCssPlugin } from "./vite-plugin-inline-css.js";

function pluginContext() {
  return {
    error(message) {
      throw new Error(message);
    }
  };
}

test("inlineCssPlugin folds CSS into the only JavaScript entry", () => {
  const plugin = inlineCssPlugin();
  const bundle = {
    "minicms.js": {
      type: "chunk",
      isEntry: true,
      code: "window.miniCMS = {};"
    },
    "minicms.css": {
      type: "asset",
      source: "body { color: red; }"
    }
  };

  plugin.generateBundle.call(pluginContext(), {}, bundle);

  assert.deepEqual(Object.keys(bundle), ["minicms.js"]);
  assert.match(bundle["minicms.js"].code, /data-minicms-styles/);
  assert.match(bundle["minicms.js"].code, /body \{ color: red; \}/);
  assert.match(bundle["minicms.js"].code, /window\.miniCMS = \{\};$/);
});

test("inlineCssPlugin rejects extra chunks and assets", () => {
  const plugin = inlineCssPlugin();
  assert.throws(
    () =>
      plugin.generateBundle.call(pluginContext(), {}, {
        "minicms.js": { type: "chunk", isEntry: true, code: "" },
        "lazy.js": { type: "chunk", isEntry: false, code: "" }
      }),
    /exactly one JavaScript entry/
  );

  assert.throws(
    () =>
      plugin.generateBundle.call(pluginContext(), {}, {
        "minicms.js": { type: "chunk", isEntry: true, code: "" },
        "font.woff2": { type: "asset", source: new Uint8Array() }
      }),
    /emitted external assets: font\.woff2/
  );
});
