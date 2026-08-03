import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl
} from "../core/image-service.js";
import { createFilesystemContentAdapter } from "./fs.js";

const IMAGE_SHA = "a".repeat(64);
const FILE_SHA = "b".repeat(64);
const IMAGE_SOURCE = `/media/images/${IMAGE_SHA}/picture.jpg`;
const FILE_SOURCE = `/media/files/${FILE_SHA}/research.pdf`;

const configuration = `site:
  name: Filesystem fixture
node_types:
  page:
    kind: document
    fields:
      title: {widget: string}
    slots:
      content:
        allowed_types: [image]
  image:
    kind: content
    fields:
      asset:
        widget: reference
        collection: images
  media_image:
    kind: document
    fields:
      uuid: {widget: uuid}
      title: {widget: string}
      file: {widget: image}
      download: {widget: file}
  note:
    kind: document
    fields:
      title: {widget: string}
collections:
  pages:
    folder: content/pages
    extension: yml
    node_type: page
  images:
    folder: content/images
    extension: yaml
    node_type: media_image
    views:
      reference:
        value: uuid
  notes:
    folder: content/notes
    extension: yml
    node_type: note
`;

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minicms-content-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "content", "pages"), { recursive: true });
  await mkdir(path.join(root, "content", "images"), { recursive: true });
  await writeFile(path.join(root, "cms.config.yml"), configuration, "utf8");
  await writeFile(
    path.join(root, "content", "pages", "second.yml"),
    `id: second
type: page
order: 2
properties:
  title: Second
slots: {}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "content", "pages", "home.yml"),
    `id: home
type: page
order: 0
properties:
  title: Home
slots:
  content:
    - id: hero
      type: image
      properties:
        asset: image-uuid
      slots: {}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "content", "images", "picture.yaml"),
    `id: picture
type: media_image
order: 0
properties:
  uuid: image-uuid
  title: Picture
  file:
    src: ${IMAGE_SOURCE}
    width: 800
    height: 600
  download: ${FILE_SOURCE}
slots: {}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "content", "images", "ignored.yml"),
    `this: file uses the wrong configured extension
`,
    "utf8"
  );
  return root;
}

test("loads every configured collection and resolves references from YAML", async (t) => {
  const root = await fixture(t);
  const adapter = await createFilesystemContentAdapter({
    projectRoot: pathToFileURL(`${root}/`),
    resolveMediaUrl: (value) => `/research${value}`
  });

  assert.equal(adapter.config().site.name, "Filesystem fixture");
  const pages = await adapter.list("pages");
  assert.equal(pages.config, adapter.config());
  assert.equal(pages.collection.name, "pages");
  assert.deepEqual(pages.items.map((item) => item.id), ["home", "second"]);
  assert.equal(
    pages.items[0].slots.content[0].properties.asset.record.properties.file.src,
    `/research${IMAGE_SOURCE}`
  );
  assert.deepEqual((await adapter.list("notes")).items, []);
  assert.equal((await adapter.list("images")).items.length, 1);
  assert.equal((await adapter.get("pages", "missing")), null);
  assert.deepEqual(
    (await adapter.get("pages", "home")).item,
    pages.items[0]
  );
});

test("accepts a dedicated image resolver without changing file resolution", async (t) => {
  const root = await fixture(t);
  const adapter = await createFilesystemContentAdapter({
    projectRoot: root,
    resolveMediaUrl: (value) => `/raw${value}`,
    resolveImageUrl: (value) => `/image-service${value}`
  });

  const page = await adapter.get("pages", "home");
  assert.equal(
    page.item.slots.content[0].properties.asset.record.properties.file.src,
    `/image-service${IMAGE_SOURCE}`
  );
});

test("can use the image service independently from content persistence", async (t) => {
  const root = await fixture(t);
  const adapter = await createFilesystemContentAdapter({
    projectRoot: root,
    imageServiceBaseUrl: "https://images.example.test"
  });
  const imageRecord = (await adapter.get("pages", "home"))
    .item.slots.content[0].properties.asset.record;

  assert.equal(
    imageRecord.properties.file.src,
    buildImageServiceUrl(IMAGE_SOURCE, {
      baseUrl: "https://images.example.test",
      config: adapter.config(),
      fit: "inside"
    })
  );
  assert.equal(imageRecord.properties.download, FILE_SOURCE);
});

test("keeps GitHub-backed images and files on public media URLs", async (t) => {
  const root = await fixture(t);
  const githubConfig = `backend:
  name: github
  repo: signalwerk/example
  base_url: https://auth.example.test
  branch: main
${configuration}`;
  await writeFile(path.join(root, "cms.config.yml"), githubConfig, "utf8");
  const adapter = await createFilesystemContentAdapter({
    projectRoot: root,
    publicBase: "/project/"
  });
  const imageRecord = (await adapter.get("pages", "home"))
    .item.slots.content[0].properties.asset.record;

  assert.equal(
    imageRecord.properties.file.src,
    `/project${IMAGE_SOURCE}`
  );
  assert.equal(
    imageRecord.properties.download,
    `/project${FILE_SOURCE}`
  );
});

test("uses the shared media service defaults for an explicit API backend", async (t) => {
  const root = await fixture(t);
  const apiConfig = `backend:
  name: api
  api_url: https://content.example.test
${configuration.replace(
  "site:\n  name: Filesystem fixture",
  "site:\n  name: Filesystem fixture\n  image_processing:\n    fit: cover"
)}`;
  await writeFile(path.join(root, "cms.config.yml"), apiConfig, "utf8");
  const adapter = await createFilesystemContentAdapter({ projectRoot: root });
  const imageRecord = (await adapter.get("pages", "home"))
    .item.slots.content[0].properties.asset.record;

  assert.equal(
    imageRecord.properties.file.src,
    buildImageServiceUrl(IMAGE_SOURCE, {
      baseUrl: "https://content.example.test",
      config: adapter.config(),
      fit: "inside"
    })
  );
  assert.equal(
    imageRecord.properties.download,
    buildImageServiceMediaUrl(FILE_SOURCE, {
      baseUrl: "https://content.example.test",
      config: adapter.config()
    })
  );
});

test("supports an absolute public base without changing external media URLs", async (t) => {
  const root = await fixture(t);
  const adapter = await createFilesystemContentAdapter({
    projectRoot: root,
    publicBase: "https://example.test/project/"
  });

  const page = await adapter.get("pages", "home");
  assert.equal(
    page.item.slots.content[0].properties.asset.record.properties.file.src,
    `https://example.test/project${IMAGE_SOURCE}`
  );
});

test("validates YAML records instead of silently returning malformed content", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "content", "pages", "broken.yml"),
    `id: broken
type: unknown
properties: {}
slots: {}
`,
    "utf8"
  );
  const adapter = await createFilesystemContentAdapter({ projectRoot: root });
  await assert.rejects(adapter.list("pages"), /not allowed|Unknown node type/);
});

test("rejects traversal, mismatched record IDs, and symlinked records", async (t) => {
  const root = await fixture(t);
  const adapter = await createFilesystemContentAdapter({ projectRoot: root });

  await assert.rejects(
    adapter.get("pages", "../outside"),
    /Invalid record id/
  );

  await writeFile(
    path.join(root, "content", "pages", "wrong.yml"),
    `id: another-id
type: page
order: 0
properties:
  title: Wrong filename
slots: {}
`,
    "utf8"
  );
  await assert.rejects(
    adapter.get("pages", "wrong"),
    /contains id "another-id"/
  );

  const outside = path.join(root, "outside.yml");
  await writeFile(
    outside,
    `id: linked
type: page
order: 0
properties:
  title: Outside content
slots: {}
`,
    "utf8"
  );
  await symlink(outside, path.join(root, "content", "pages", "linked.yml"));
  await assert.rejects(
    adapter.get("pages", "linked"),
    /must be a regular file/
  );
});
