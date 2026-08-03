import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  configuredCollectionMediaAccept,
  configuredImageAccept,
  configuredMediaAccept,
  mediaFileMatchesAccept,
  recordMediaSources,
  recordMediaStoragePaths,
  validateMediaAccept
} from "./media.js";

test("matches configurable media MIME types, extensions, and wildcards", () => {
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "image/svg+xml" },
      ["image/svg+xml"]
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "application/octet-stream" },
      [".svg"]
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "image/svg+xml; charset=utf-8" },
      ["image/*"]
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "photo.jpg", type: "image/jpeg" },
      ["image/png", "image/svg+xml"]
    ),
    false
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "archive.zip", type: "application/zip" },
      ["*/*"]
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "scan.tif", type: "application/octet-stream" },
      ["image/tiff"]
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "scan.tiff", type: "" },
      ["image/tiff"]
    ),
    true
  );
});

test("collects accepted image types from configured image fields", () => {
  const accepted = configuredImageAccept({
    node_types: {
      page: {
        fields: {
          hero: { widget: "image", accept: ["image/png", ".svg"] },
          thumbnail: { widget: "image", accept: ["image/webp", "image/png"] },
          title: { widget: "string" }
        }
      }
    }
  });

  assert.deepEqual(accepted, ["image/png", ".svg", "image/webp"]);
  assert.ok(acceptTokens(DEFAULT_IMAGE_ACCEPT).includes("image/svg+xml"));
});

test("collects image and file upload types from configuration", () => {
  assert.deepEqual(
    configuredMediaAccept({
      node_types: {
        asset: {
          fields: {
            preview: { widget: "image", accept: ["image/png"] },
            download: { widget: "file", accept: ["application/pdf", ".zip"] }
          }
        }
      }
    }),
    ["image/png", "application/pdf", ".zip"]
  );
});

test("scopes upload types to node types reachable from one collection", () => {
  const config = {
    node_types: {
      page: {
        slots: { content: { allowed_types: ["gallery"] } }
      },
      gallery: {
        fields: {
          image: { widget: "image", accept: ["image/png", ".tiff"] }
        },
        slots: { nested: { allowed_types: ["page"] } }
      },
      download: {
        fields: { file: { widget: "file", accept: ["*/*"] } }
      },
      child: {
        fields: { attachment: { widget: "file", accept: [".zip"] } }
      }
    },
    collections: {
      pages: {
        node_type: "page",
        allowed_types: ["page"],
        hierarchy: {
          enabled: true,
          allowed_child_types: ["child"]
        }
      },
      files: { node_type: "download", allowed_types: ["download"] },
      empty: { node_type: "download", allowed_types: [] }
    }
  };

  assert.deepEqual(
    configuredCollectionMediaAccept(config, config.collections.pages),
    [".zip", "image/png", ".tiff"]
  );
  assert.deepEqual(
    configuredCollectionMediaAccept(
      config,
      config.collections.pages,
      "image"
    ),
    ["image/png", ".tiff"]
  );
  assert.deepEqual(
    configuredCollectionMediaAccept(config, config.collections.files),
    ["*/*"]
  );
  assert.deepEqual(
    configuredCollectionMediaAccept(config, config.collections.empty),
    []
  );
});

test("resolves only configured upload fields inside the media folder", () => {
  const config = {
    site: {
      media_folder: "content/media",
      public_folder: "/media"
    },
    node_types: {
      asset: {
        fields: {
          image: { widget: "image" },
          file: { widget: "file" },
          reference: { widget: "reference" }
        }
      }
    }
  };
  const record = {
    type: "asset",
    properties: {
      image: { src: "/media/preview.png", regions: [] },
      file: "/media/report.pdf",
      reference: "/media/shared.pdf"
    }
  };

  assert.deepEqual(recordMediaSources(record, config), [
    "/media/preview.png",
    "/media/report.pdf"
  ]);
  assert.deepEqual(recordMediaStoragePaths(record, config), [
    "content/media/preview.png",
    "content/media/report.pdf"
  ]);
});

test("validates array accept-list syntax and reads the legacy string shape", () => {
  assert.equal(
    validateMediaAccept([
      "image/png",
      "image/svg+xml",
      ".svg",
      "image/*",
      "*/*"
    ]),
    true
  );
  assert.deepEqual(acceptTokens("image/png,image/svg+xml"), [
    "image/png",
    "image/svg+xml"
  ]);
  assert.equal(validateMediaAccept(["image/png", ""]), false);
  assert.equal(validateMediaAccept(["svg"]), false);
});
