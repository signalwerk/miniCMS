import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  configuredImageAccept,
  mediaFileMatchesAccept,
  validateMediaAccept
} from "./media.js";

test("matches configurable media MIME types, extensions, and wildcards", () => {
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "image/svg+xml" },
      "image/svg+xml"
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "application/octet-stream" },
      ".svg"
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "diagram.svg", type: "image/svg+xml; charset=utf-8" },
      "image/*"
    ),
    true
  );
  assert.equal(
    mediaFileMatchesAccept(
      { name: "photo.jpg", type: "image/jpeg" },
      "image/png,image/svg+xml"
    ),
    false
  );
});

test("collects accepted image types from configured image fields", () => {
  const accepted = configuredImageAccept({
    node_types: {
      page: {
        fields: {
          hero: { widget: "image", accept: "image/png, .svg" },
          thumbnail: { widget: "image", accept: "image/webp,image/png" },
          title: { widget: "string" }
        }
      }
    }
  });

  assert.deepEqual(accepted, ["image/png", ".svg", "image/webp"]);
  assert.ok(acceptTokens(DEFAULT_IMAGE_ACCEPT).includes("image/svg+xml"));
});

test("validates HTML accept-list syntax", () => {
  assert.equal(validateMediaAccept("image/png,image/svg+xml,.svg,image/*"), true);
  assert.equal(validateMediaAccept("image/png,"), false);
  assert.equal(validateMediaAccept("svg"), false);
});
