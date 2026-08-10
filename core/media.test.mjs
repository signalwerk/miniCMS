import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  configuredCollectionMediaAccept,
  configuredImageAccept,
  configuredMediaAccept,
  imageAsset,
  imageAssetMediaPath,
  isCanonicalImageAsset,
  mediaFilenameWithSuffix,
  mediaFileMatchesAccept,
  normalizedMediaFilename,
  recordMediaSources,
  recordMediaStoragePaths,
  sha256Hex,
  validateMediaAccept
} from "./media.js";

test("normalizes safe image identities and builds encoded storage URLs", async () => {
  const hash = "a".repeat(64);
  const decomposed = "Gru\u0308ße (final).png";
  const filename = "Grüße (final).png";
  assert.equal(normalizedMediaFilename(decomposed), filename);
  assert.deepEqual(imageAsset({ hash, filename: decomposed }), {
    hash,
    filename
  });
  assert.equal(isCanonicalImageAsset({ hash, filename: decomposed }), false);
  assert.equal(isCanonicalImageAsset({ hash, filename }), true);
  assert.equal(
    imageAssetMediaPath({ hash, filename }, { storage: "github" }),
    `/media/${hash}/Gr%C3%BC%C3%9Fe%20%28final%29.png`
  );
  assert.equal(mediaFilenameWithSuffix(filename, 2), "Grüße (final)-2.png");
  assert.equal(
    mediaFilenameWithSuffix(`a.${"x".repeat(252)}`, 2),
    "a-2"
  );
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

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
      image: {
        hash: "c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc",
        filename: "preview.png",
        regions: []
      },
      file: "/media/assets/c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc/report.pdf",
      reference: "/media/shared.pdf"
    }
  };

  assert.deepEqual(recordMediaSources(record, config), [
    {
      widget: "image",
      value: {
        hash: "c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc",
        filename: "preview.png"
      }
    },
    {
      widget: "file",
      value: "/media/assets/c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc/report.pdf"
    }
  ]);
  assert.deepEqual(
    recordMediaStoragePaths(record, config, {
      storage: "github",
      collection: "assets"
    }),
    [
      "content/media/c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc/preview.png",
      "content/media/assets/c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc/report.pdf"
    ]
  );
  assert.deepEqual(
    recordMediaStoragePaths(record, config, {
      storage: "api",
      collection: "assets"
    }),
    [
      "content/media/assets/c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc/asset.dat"
    ]
  );
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
