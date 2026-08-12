import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml, validateSourceConfig } from "./core/content.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const initScript = path.join(packageRoot, "init.sh");
const rawBase = pathToFileURL(packageRoot).href.replace(/\/$/, "");

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    encoding: "utf8",
    ...options
  });
}

async function repositoryFixture(t, {
  branch = "main",
  origin = "git@github.com:example/starter-site.git"
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "minicms-init-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const initialized = command("git", ["init", "-q", "-b", branch], {
    cwd: root
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  if (origin) {
    const remote = command("git", ["remote", "add", "origin", origin], {
      cwd: root
    });
    assert.equal(remote.status, 0, remote.stderr);
  }
  await fs.mkdir(path.join(root, "admin"));
  return root;
}

function initialize(root, environment = {}) {
  return command("bash", [initScript], {
    cwd: path.join(root, "admin"),
    env: {
      ...process.env,
      MINICMS_REPOSITORY: "",
      MINICMS_BRANCH: "",
      MINICMS_INIT_RAW_BASE: rawBase,
      MINICMS_INIT_ALLOW_FILE_BASE: "1",
      ...environment
    }
  });
}

async function readInitializerHtml() {
  const readme = await fs.readFile(path.join(packageRoot, "README.md"), "utf8");
  const starts = [...readme.matchAll(/<!-- minicms-init:index:start -->/g)];
  const ends = [...readme.matchAll(/<!-- minicms-init:index:end -->/g)];
  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);
  const marked = readme.slice(
    starts[0].index + starts[0][0].length,
    ends[0].index
  );
  const fences = [...marked.matchAll(/```html\n([\s\S]*?)\n```/g)];
  assert.equal(fences.length, 1);
  return `${fences[0][1]}\n`;
}

test("starter configuration is local, self-contained, and valid", async () => {
  const config = validateSourceConfig(
    parseYaml(await fs.readFile(path.join(packageRoot, "cms.config.yml"), "utf8"))
  );

  assert.deepEqual(Object.keys(config.connectors), ["default", "development"]);
  assert.deepEqual(Object.keys(config.collections), ["pages", "images", "files"]);
  assert.deepEqual(Object.keys(config.node_types), [
    "page",
    "shortcut",
    "media_image",
    "media_file",
    "title",
    "text",
    "image",
    "box",
    "accordion",
    "grid",
    "column"
  ]);
  assert.equal(config.connectors.default.repo, "owner/repository");
  assert.equal(config.node_types.media_image.fields.file.widget, "image");
  assert.equal(config.collections.images.node_type, "media_image");
  assert.equal(config.collections.images.connector, undefined);
  assert.deepEqual(config.node_types.text.fields.text.blocknote, {
    internal_links: { collections: ["pages"] }
  });
  assert.equal(config.site.reference_sets, undefined);
  assert.equal(
    config.node_types.page.slots.content.allowed_types.includes("reference_list"),
    false
  );
  assert.equal(JSON.stringify(config).includes('"notes"'), false);
});

test("initializer extracts the live README HTML and specializes the template", async (t) => {
  const root = await repositoryFixture(t, { branch: "feature/starter" });
  const result = initialize(root);
  assert.equal(result.status, 0, result.stderr);

  const indexPath = path.join(root, "admin", "index.html");
  const configPath = path.join(root, "cms.config.yml");
  assert.equal(await fs.readFile(indexPath, "utf8"), await readInitializerHtml());
  const generatedSource = await fs.readFile(configPath, "utf8");
  const generated = validateSourceConfig(parseYaml(generatedSource));
  assert.equal(generated.connectors.default.repo, "example/starter-site");
  assert.equal(generated.connectors.default.branch, "feature/starter");
  assert.equal(generated.site.name, "starter-site");
  assert.equal(generatedSource.includes("owner/repository"), false);

  const second = initialize(root);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already initialized; no files changed/);
  assert.equal(await fs.readFile(indexPath, "utf8"), await readInitializerHtml());
  assert.equal(await fs.readFile(configPath, "utf8"), generatedSource);
});

test("initializer accepts an HTTPS GitHub origin", async (t) => {
  const root = await repositoryFixture(t, {
    origin: "https://github.com/acme/example.git/"
  });
  const result = initialize(root);
  assert.equal(result.status, 0, result.stderr);
  const config = parseYaml(await fs.readFile(path.join(root, "cms.config.yml"), "utf8"));
  assert.equal(config.connectors.default.repo, "acme/example");
});

test("initializer quotes repository-derived YAML scalars", async (t) => {
  const root = await repositoryFixture(t, {
    branch: "true",
    origin: "git@github.com:example/123.git"
  });
  const result = initialize(root);
  assert.equal(result.status, 0, result.stderr);
  const config = validateSourceConfig(
    parseYaml(await fs.readFile(path.join(root, "cms.config.yml"), "utf8"))
  );
  assert.equal(config.connectors.default.repo, "example/123");
  assert.equal(config.connectors.default.branch, "true");
  assert.equal(config.site.name, "123");
});

test("initializer rejects conflicts before writing either output", async (t) => {
  const root = await repositoryFixture(t);
  const indexPath = path.join(root, "admin", "index.html");
  await fs.writeFile(indexPath, "existing admin\n");

  const result = initialize(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists with different content/);
  assert.equal(await fs.readFile(indexPath, "utf8"), "existing admin\n");
  await assert.rejects(fs.access(path.join(root, "cms.config.yml")));
});

test("initializer refuses a symlinked target without touching its destination", async (t) => {
  const root = await repositoryFixture(t);
  const external = path.join(root, "outside.yml");
  const configPath = path.join(root, "cms.config.yml");
  await fs.writeFile(external, "keep me\n");
  await fs.symlink(external, configPath);

  const result = initialize(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(await fs.readFile(external, "utf8"), "keep me\n");
  await assert.rejects(fs.access(path.join(root, "admin", "index.html")));
});

test("initializer fails before writes when repository identity is unavailable", async (t) => {
  const root = await repositoryFixture(t, { origin: null });
  const result = initialize(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MINICMS_REPOSITORY/);
  await assert.rejects(fs.access(path.join(root, "cms.config.yml")));
  await assert.rejects(fs.access(path.join(root, "admin", "index.html")));
});

test("initializer fails closed when the README extraction contract is malformed", async (t) => {
  const root = await repositoryFixture(t);
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "minicms-init-source-"));
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  await fs.writeFile(path.join(source, "README.md"), "# no initializer markers\n");
  await fs.copyFile(
    path.join(packageRoot, "cms.config.yml"),
    path.join(source, "cms.config.yml")
  );

  const result = initialize(root, {
    MINICMS_INIT_RAW_BASE: pathToFileURL(source).href.replace(/\/$/, "")
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid marked initializer HTML block/);
  await assert.rejects(fs.access(path.join(root, "cms.config.yml")));
  await assert.rejects(fs.access(path.join(root, "admin", "index.html")));
});
