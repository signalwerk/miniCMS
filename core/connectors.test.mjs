import test from "node:test";
import assert from "node:assert/strict";
import {
  collapseConfig,
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  translateInlineReferences,
  translateRecord
} from "./connectors.js";
import { buildInlineReferenceUrl } from "./inline-reference.js";

function sourceConfig() {
  return {
    connectors: {
      default: { name: "api", auth_url: "https://auth.example.test" },
      development: { name: "api" },
      central: {
        name: "api",
        api_url: "https://content.example.test",
        auth_url: "https://auth.example.test"
      }
    },
    site: {
      media_folder: "content/media",
      public_folder: "/media"
    },
    node_types: {
      page: {
        fields: {
          title: { widget: "string", required: false },
          gallery: { widget: "reference", collection: "central_galleries" }
        }
      },
      central_gallery: {
        connector: "central",
        remote_type: "gallery"
      },
      central_image: {
        connector: "central",
        remote_type: "image"
      }
    },
    collections: {
      pages: {
        folder: "content/pages",
        node_type: "page",
        allowed_types: ["page"]
      },
      central_galleries: {
        connector: "central",
        remote_collection: "galleries"
      },
      central_images: {
        connector: "central",
        remote_collection: "images"
      }
    }
  };
}

function remoteConfig() {
  return {
    connectors: {
      default: {
        name: "api",
        api_url: "https://content.example.test",
        auth_url: "https://auth.example.test"
      }
    },
    site: {
      media_folder: "content/media",
      public_folder: "/media"
    },
    node_types: {
      gallery: {
        fields: {
          title: { widget: "string" },
          lead: {
            widget: "reference",
            collection: "images",
            allowed_types: ["image"]
          },
          copy: {
            widget: "markdown",
            blocknote: {
              inline_reference: {
                collection: "images",
                preview_field: "title"
              }
            }
          }
        },
        slots: {
          images: { allowed_types: ["image"] }
        }
      },
      image: {
        fields: {
          content_id: { widget: "id", required: true },
          title: { widget: "string", required: true },
          image: { widget: "image" }
        }
      }
    },
    collections: {
      galleries: {
        folder: "content/galleries",
        node_type: "gallery",
        allowed_types: ["gallery"],
        views: { list: { type: "table", columns: ["title"] } }
      },
      images: {
        folder: "content/images",
        node_type: "image",
        allowed_types: ["image"],
        views: {
          list: { type: "table", columns: ["title", "image"] },
          reference: { value: "content_id", title: "title", image: "image" }
        }
      }
    }
  };
}

test("materializes remote definitions and exposes deterministic routing maps", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  const originalSource = structuredClone(source);
  const originalRemote = structuredClone(remote);
  const materialized = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });

  assert.deepEqual(source, originalSource);
  assert.deepEqual(remote, originalRemote);
  assert.equal(
    materialized.config.node_types.central_gallery.connector,
    "central"
  );
  assert.equal(
    materialized.config.node_types.central_gallery.remote_type,
    "gallery"
  );
  assert.deepEqual(
    materialized.config.node_types.central_gallery.slots.images.allowed_types,
    ["central_image"]
  );
  assert.equal(
    materialized.config.node_types.central_gallery.fields.lead.collection,
    "central_images"
  );
  assert.deepEqual(
    materialized.config.node_types.central_gallery.fields.lead.allowed_types,
    ["central_image"]
  );
  assert.equal(
    materialized.config.node_types.central_gallery.fields.copy.blocknote
      .inline_reference.collection,
    "central_images"
  );
  assert.equal(
    materialized.config.collections.central_galleries.node_type,
    "central_gallery"
  );
  assert.deepEqual(
    materialized.config.collections.central_galleries.allowed_types,
    ["central_gallery"]
  );
  assert.deepEqual(materialized.routes.collections.central_images, {
    connector: "central",
    remote_collection: "images"
  });
  assert.deepEqual(materialized.routes.node_types.page, {
    connector: "default",
    remote_type: "page"
  });
  assert.equal(
    materialized.routes.connectors.central.collections.remote_to_local.images,
    "central_images"
  );
  assert.equal(
    materialized.routes.connectors.central.node_types.local_to_remote
      .central_gallery,
    "gallery"
  );
  assert.equal(
    Object.hasOwn(
      materialized.sourceConfig.node_types.page.fields.title,
      "required"
    ),
    false
  );
  assert.deepEqual(materialized.sourceConfig.node_types.central_gallery, {
    connector: "central",
    remote_type: "gallery"
  });
  assert.deepEqual(materialized.sourceConfig.collections.central_images, {
    connector: "central",
    remote_collection: "images"
  });
});

test("collapses hydrated aliases and recognizes only complete remote declarations", () => {
  const { config } = materializeConfig({
    sourceConfig: sourceConfig(),
    remoteConfigs: { central: remoteConfig() }
  });
  assert.equal(isRemoteNodeType(config.node_types.central_image), true);
  assert.equal(isRemoteNodeType({ connector: "central" }), false);
  assert.equal(isRemoteCollection(config.collections.central_images), true);
  assert.equal(isRemoteCollection({ remote_collection: "images" }), false);
  assert.deepEqual(collapseConfig(config).collections.central_galleries, {
    connector: "central",
    remote_collection: "galleries"
  });
});

test("translates recursive record types and canonical inline-reference links", () => {
  const { routes } = materializeConfig({
    sourceConfig: sourceConfig(),
    remoteConfigs: { central: remoteConfig() }
  });
  const localLink = buildInlineReferenceUrl("central_images", "img-1");
  const remoteLink = buildInlineReferenceUrl("images", "img-1");
  const record = {
    id: "gallery-1",
    type: "central_gallery",
    order: 0,
    properties: {
      title: "Gallery",
      copy: `[Image](${localLink}) and \`[code](${localLink})\``
    },
    slots: {
      images: [
        {
          id: "abcdefghijklmno",
          type: "central_image",
          properties: { title: "Image" },
          slots: {}
        }
      ]
    }
  };
  const translated = translateRecord(
    record,
    routes.connectors.central,
    "local_to_remote"
  );
  assert.equal(translated.type, "gallery");
  assert.equal(translated.slots.images[0].type, "image");
  assert.equal(
    translated.properties.copy,
    `[Image](${remoteLink}) and \`[code](${localLink})\``
  );
  assert.deepEqual(
    translateRecord(
      translated,
      routes.connectors.central,
      "remote_to_local"
    ),
    record
  );
  assert.equal(record.type, "central_gallery");

  const summary = translateRecord(
    { id: "gallery-1", type: "gallery", title: "Gallery" },
    routes.connectors.central,
    "remote_to_local"
  );
  assert.deepEqual(summary, {
    id: "gallery-1",
    type: "central_gallery",
    title: "Gallery"
  });

  const markdown = `plain ${localLink} ![image](${localLink}) [link](<${localLink}>)`;
  assert.equal(
    translateInlineReferences(markdown, { central_images: "images" }),
    `plain ${localLink} ![image](${localLink}) [link](<${remoteLink}>)`
  );
});

test("ignores unrelated aliases declared by a remote project", () => {
  const remote = remoteConfig();
  remote.connectors.archive = {
    name: "api",
    api_url: "https://archive.example.test",
    auth_url: "https://auth.example.test"
  };
  remote.node_types.archived_asset = {
    connector: "archive",
    remote_type: "asset"
  };
  remote.collections.archived_assets = {
    connector: "archive",
    remote_collection: "assets"
  };

  const materialized = materializeConfig({
    sourceConfig: sourceConfig(),
    remoteConfigs: { central: remote }
  });
  assert.equal(
    materialized.config.collections.central_images.node_type,
    "central_image"
  );
  assert.equal(
    Object.hasOwn(materialized.config.collections, "archived_assets"),
    false
  );
});

test("fails closed for missing, ambiguous, and incomplete remote dependencies", () => {
  assert.throws(
    () => materializeConfig({ sourceConfig: sourceConfig() }),
    /configuration was not provided/
  );

  const missingType = remoteConfig();
  delete missingType.node_types.image;
  assert.throws(
    () =>
      materializeConfig({
        sourceConfig: sourceConfig(),
        remoteConfigs: { central: missingType }
      }),
    /unknown node type|no node type/
  );

  const missingAliasSource = sourceConfig();
  delete missingAliasSource.node_types.central_image;
  assert.throws(
    () =>
      materializeConfig({
        sourceConfig: missingAliasSource,
        remoteConfigs: { central: remoteConfig() }
      }),
    /no explicit local alias/
  );

  const duplicateAlias = sourceConfig();
  duplicateAlias.collections.more_images = {
    connector: "central",
    remote_collection: "images"
  };
  assert.throws(
    () =>
      materializeConfig({
        sourceConfig: duplicateAlias,
        remoteConfigs: { central: remoteConfig() }
      }),
    /aliased by both/
  );
});
