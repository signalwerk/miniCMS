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
import { createFilesystemContentAdapter } from "./fs.js";

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
    src: /media/picture.jpg
    width: 800
    height: 600
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
    "/research/media/picture.jpg"
  );
  assert.deepEqual((await adapter.list("notes")).items, []);
  assert.equal((await adapter.list("images")).items.length, 1);
  assert.equal((await adapter.get("pages", "missing")), null);
  assert.deepEqual(
    (await adapter.get("pages", "home")).item,
    pages.items[0]
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
    "https://example.test/project/media/picture.jpg"
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
