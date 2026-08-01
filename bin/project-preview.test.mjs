import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "vite";
import {
  createProjectPreviewPlugin,
  PROJECT_PREVIEW_MODULE_ID,
  resolveProjectPreview
} from "./project-preview.mjs";

async function withProject(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minicms-preview-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("project preview is optional", async () => {
  await withProject(async (root) => {
    await writeFile(path.join(root, "package.json"), "{}\n");
    assert.equal(await resolveProjectPreview(root), null);
  });
});

test("project preview resolves a path relative to the consumer manifest", async () => {
  await withProject(async (root) => {
    const entry = path.join(root, "website", "src", "minicms.tsx");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, "export default {};\n");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ minicms: { preview: "./website/src/minicms.tsx" } })}\n`
    );
    assert.deepEqual(await resolveProjectPreview(root), {
      specifier: "./website/src/minicms.tsx",
      importer: path.join(root, "package.json"),
      entryPath: await realpath(entry)
    });
  });
});

test("project preview resolves an import-only workspace package export", async () => {
  await withProject(async (root) => {
    const packageRoot = path.join(root, "packages", "website");
    const moduleRoot = path.join(root, "node_modules", "@example");
    await mkdir(path.join(packageRoot, "src"), { recursive: true });
    await mkdir(moduleRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@example/website",
        type: "module",
        exports: {
          "./minicms": { import: "./src/minicms.tsx" }
        }
      })}\n`
    );
    const entry = path.join(packageRoot, "src", "minicms.tsx");
    await writeFile(entry, "export default {};\n");
    await symlink(packageRoot, path.join(moduleRoot, "website"), "dir");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ minicms: { preview: "@example/website/minicms" } })}\n`
    );
    const configuration = await resolveProjectPreview(root);
    assert.deepEqual(configuration, {
      specifier: "@example/website/minicms",
      importer: path.join(root, "package.json"),
      entryPath: null
    });
    const buildEntry = path.join(root, "entry.js");
    await writeFile(
      buildEntry,
      'import preview from "virtual:minicms-project-preview";\nexport default preview;\n'
    );
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [createProjectPreviewPlugin(configuration)],
      build: {
        write: false,
        rollupOptions: { input: buildEntry }
      }
    });
  });
});

test("project preview rejects invalid manifest configuration", async () => {
  await withProject(async (root) => {
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ minicms: { preview: true } })}\n`
    );
    await assert.rejects(
      resolveProjectPreview(root),
      /minicms\.preview value.*non-empty module specifier/
    );
  });
});

test("project preview reports unresolved entries with consumer context", async () => {
  await withProject(async (root) => {
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ minicms: { preview: "@example/missing/preview" } })}\n`
    );
    const configuration = await resolveProjectPreview(root);
    const buildEntry = path.join(root, "entry.js");
    await writeFile(
      buildEntry,
      'import "virtual:minicms-project-preview";\n'
    );
    await assert.rejects(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [createProjectPreviewPlugin(configuration)],
        build: {
          write: false,
          rollupOptions: { input: buildEntry }
        }
      }),
      /Could not resolve miniCMS preview.*@example\/missing\/preview.*package\.json/
    );
  });
});

test("project preview plugin supplies a fallback or the resolved entry", async () => {
  const fallback = createProjectPreviewPlugin(null);
  const resolvedId = await fallback.resolveId(PROJECT_PREVIEW_MODULE_ID);
  assert.match(fallback.load(resolvedId), /collections: \{\}/);

  const configuration = {
    specifier: "./website/src/minicms.tsx",
    importer: "/project/package.json",
    entryPath: "/project/website/src/minicms.tsx"
  };
  const configured = createProjectPreviewPlugin(configuration);
  assert.match(
    configured.load(await configured.resolveId(PROJECT_PREVIEW_MODULE_ID)),
    /minicms-project-preview-entry/
  );
});
