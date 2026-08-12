import test from "node:test";
import assert from "node:assert/strict";
import {
  collapseConfig,
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  migrateRecordSchemaKeys,
  normalizeSchemaRenames,
  planConfigWrites,
  translateInlineReferences,
  translateRecord
} from "./connectors.js";
import { buildInlineReferenceUrl } from "./inline-reference.js";
import { buildInlineLinkUrl } from "./inline-link.js";

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
              },
              internal_links: {
                collections: ["galleries", "images"]
              }
            }
          }
        },
        slots: {
          images: {
            allowed_types: ["image"],
            default: [{
              type: "image",
              properties: {
                title: "[Lead](minicms://reference/images/lead)"
              }
            }]
          }
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
  assert.deepEqual(
    materialized.config.node_types.central_gallery.slots.images.default,
    [{
      type: "central_image",
      properties: {
        title: "[Lead](minicms://reference/central_images/lead)"
      }
    }]
  );
  assert.equal(
    materialized.config.node_types.central_gallery.fields.lead.collection,
    "central_images"
  );
  assert.deepEqual(
    materialized.config.node_types.central_gallery.fields.copy.blocknote
      .internal_links.collections,
    ["central_galleries", "central_images"]
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
  const localContentLink = buildInlineLinkUrl("central_galleries", "gallery-2");
  const remoteContentLink = buildInlineLinkUrl("galleries", "gallery-2");
  const record = {
    id: "gallery-1",
    type: "central_gallery",
    order: 0,
    properties: {
      title: "Gallery",
      copy: `[Image](${localLink}), [Gallery](${localContentLink}), and \`[code](${localLink})\``
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
    `[Image](${remoteLink}), [Gallery](${remoteContentLink}), and \`[code](${localLink})\``
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

test("migrates explicit schema keys through records without mutating image assets", () => {
  const hash = "a".repeat(64);
  const current = {
    node_types: {
      page: {
        fields: {
          copy: { widget: "markdown" },
          attachment: { widget: "file" },
          image: { widget: "image" }
        }
      },
      card: {
        fields: {
          attachment: { widget: "file" }
        }
      }
    },
    collections: {
      pages: { folder: "content/pages", node_type: "page" },
      assets: { folder: "content/assets", node_type: "card" }
    }
  };
  const next = {
    node_types: {
      article: structuredClone(current.node_types.page),
      tile: structuredClone(current.node_types.card)
    },
    collections: {
      articles: { folder: "content/articles", node_type: "article" },
      media: { folder: "content/media-items", node_type: "tile" }
    }
  };
  const renames = {
    node_types: { page: "article", card: "tile" },
    collections: { pages: "articles", assets: "media" }
  };
  const oldLink = buildInlineReferenceUrl("assets", "asset-1");
  const nextLink = buildInlineReferenceUrl("media", "asset-1");
  const oldContentLink = buildInlineLinkUrl("pages", "home");
  const nextContentLink = buildInlineLinkUrl("articles", "home");
  const image = { hash, filename: "hero.png", width: 640, height: 480 };
  const record = {
    id: "home",
    type: "page",
    properties: {
      copy: `[Asset](${oldLink}) [Home](${oldContentLink})`,
      attachment: `/media/assets/${hash}/brief.pdf`,
      image
    },
    slots: {
      cards: [{
        id: "abcdefghijklmno",
        type: "card",
        properties: {
          attachment: `/media/assets/${hash}/nested.pdf`
        },
        slots: {}
      }]
    }
  };

  const migrated = migrateRecordSchemaKeys(
    record,
    current,
    next,
    renames,
    { storage: "api" }
  );
  assert.equal(migrated.type, "article");
  assert.equal(migrated.slots.cards[0].type, "tile");
  assert.equal(
    migrated.properties.copy,
    `[Asset](${nextLink}) [Home](${nextContentLink})`
  );
  assert.equal(
    migrated.properties.attachment,
    `/media/media/${hash}/brief.pdf`
  );
  assert.equal(
    migrated.slots.cards[0].properties.attachment,
    `/media/media/${hash}/nested.pdf`
  );
  assert.deepEqual(migrated.properties.image, image);
  assert.notEqual(migrated.properties.image, image);
  assert.deepEqual(record.properties.image, image);

  const github = migrateRecordSchemaKeys(
    record,
    current,
    next,
    renames,
    { storage: "github" }
  );
  assert.equal(github.type, "article");
  assert.equal(
    github.properties.attachment,
    `/media/assets/${hash}/brief.pdf`
  );
});

test("migrates API file URLs between configured public folders", () => {
  const hash = "b".repeat(64);
  const current = {
    site: { public_folder: "/assets" },
    node_types: {
      page: {
        fields: {
          attachment: { widget: "file" },
          noncanonical: { widget: "file" }
        }
      }
    },
    collections: {
      files: { folder: "content/files", node_type: "page" }
    }
  };
  const next = {
    site: { public_folder: "/downloads" },
    node_types: structuredClone(current.node_types),
    collections: {
      library: { folder: "content/library", node_type: "page" }
    }
  };
  const record = {
    id: "home",
    type: "page",
    properties: {
      attachment: `/assets/files/${hash}/brief%20report.pdf`,
      noncanonical: `/media/files/${hash}/brief%20report.pdf`
    },
    slots: {}
  };

  const migrated = migrateRecordSchemaKeys(
    record,
    current,
    next,
    {
      node_types: {},
      collections: { files: "library" }
    },
    { storage: "api" }
  );

  assert.equal(
    migrated.properties.attachment,
    `/downloads/library/${hash}/brief%20report.pdf`
  );
  assert.equal(
    migrated.properties.noncanonical,
    `/media/files/${hash}/brief%20report.pdf`
  );
});

test("validates schema rename provenance as explicit one-to-one rekeys", () => {
  const current = {
    node_types: {
      page: { fields: {} },
      card: { fields: {} },
      remote_image: { connector: "central", remote_type: "image" }
    },
    collections: {
      pages: { folder: "content/pages", node_type: "page" },
      remote_images: {
        connector: "central",
        remote_collection: "images"
      }
    }
  };
  const next = {
    node_types: {
      article: { fields: {} },
      tile: { fields: {} },
      library_image: { connector: "central", remote_type: "image" }
    },
    collections: {
      articles: { folder: "content/articles", node_type: "article" },
      library_images: {
        connector: "central",
        remote_collection: "images"
      }
    }
  };
  assert.deepEqual(
    normalizeSchemaRenames(
      {
        node_types: {
          page: "article",
          card: "tile",
          remote_image: "library_image"
        },
        collections: {
          pages: "articles",
          remote_images: "library_images"
        }
      },
      current,
      next
    ),
    {
      node_types: {
        page: "article",
        card: "tile",
        remote_image: "library_image"
      },
      collections: {
        pages: "articles",
        remote_images: "library_images"
      }
    }
  );

  assert.throws(
    () => normalizeSchemaRenames(
      { node_types: { page: "card", card: "tile" }, collections: {} },
      current,
      next
    ),
    /chains or swaps|already exists/
  );
  const changedOwner = structuredClone(next);
  changedOwner.node_types.library_image.remote_type = "asset";
  assert.throws(
    () => normalizeSchemaRenames(
      {
        node_types: { remote_image: "library_image" },
        collections: {}
      },
      current,
      changedOwner
    ),
    /preserve its connector and remote identity/
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

test("plans edited remote schema back to its owning connector", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  remote.site.unrelated = "preserved";
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.central_gallery.label = "Edited gallery";
  effective.collections.central_galleries.folder = "content/edited-galleries";
  effective.collections.central_galleries.views.list.quick_filters = {
    user_created: {
      abcdefghijklmno: {
        label: "Named gallery",
        expression: {
          mode: "all",
          children: [
            { field: "title", operator: "contains", value: "Beowolf" }
          ]
        }
      }
    }
  };

  const planned = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });

  assert.deepEqual(planned.changedConnectors, ["central"]);
  assert.equal(planned.sourceChanged, false);
  assert.equal(
    planned.remoteConfigs.central.node_types.gallery.label,
    "Edited gallery"
  );
  assert.equal(
    planned.remoteConfigs.central.node_types.gallery.fields.lead.collection,
    "images"
  );
  assert.deepEqual(
    planned.remoteConfigs.central.node_types.gallery.slots.images.allowed_types,
    ["image"]
  );
  assert.deepEqual(
    planned.remoteConfigs.central.node_types.gallery.slots.images.default,
    remote.node_types.gallery.slots.images.default
  );
  assert.equal(
    planned.remoteConfigs.central.collections.galleries.folder,
    "content/edited-galleries"
  );
  assert.equal(
    planned.remoteConfigs.central.collections.galleries.views.list
      .quick_filters.user_created.abcdefghijklmno.label,
    "Named gallery"
  );
  assert.equal(planned.remoteConfigs.central.site.unrelated, "preserved");
  assert.equal(
    planned.config.collections.central_galleries.folder,
    "content/edited-galleries"
  );
  assert.deepEqual(planned.sourceConfig.collections.central_galleries, {
    connector: "central",
    remote_collection: "galleries"
  });
});

test("plans a new remote content type and collection together", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.central_feature = {
    connector: "central",
    remote_type: "feature",
    label: "Feature",
    fields: {
      title: { widget: "string" },
      image: { widget: "reference", collection: "central_images" }
    },
    slots: {
      gallery: { allowed_types: ["central_gallery"] }
    }
  };
  effective.collections.central_features = {
    connector: "central",
    remote_collection: "features",
    label: "Features",
    folder: "content/features",
    node_type: "central_feature",
    allowed_types: ["central_feature"],
    hierarchy: {
      enabled: true,
      allowed_child_types: ["central_feature"]
    }
  };

  const planned = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });

  assert.equal(planned.sourceChanged, true);
  assert.equal(
    planned.remoteConfigs.central.node_types.feature.fields.image.collection,
    "images"
  );
  assert.deepEqual(
    planned.remoteConfigs.central.node_types.feature.slots.gallery.allowed_types,
    ["gallery"]
  );
  assert.equal(
    planned.remoteConfigs.central.collections.features.node_type,
    "feature"
  );
  assert.deepEqual(
    planned.remoteConfigs.central.collections.features.hierarchy.allowed_child_types,
    ["feature"]
  );
  assert.equal(
    planned.config.collections.central_features.node_type,
    "central_feature"
  );
});

test("uses provisional aliases to retry publication after an owner saved", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.central_feature = {
    connector: "central",
    remote_type: "feature",
    fields: { title: { widget: "string" } }
  };
  effective.collections.central_features = {
    connector: "central",
    remote_collection: "features",
    folder: "content/features",
    node_type: "central_feature"
  };

  const first = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });
  const retry = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    ownershipSourceConfig: first.sourceConfig,
    remoteConfigs: { central: first.remoteConfigs.central }
  });

  assert.deepEqual(retry.changedConnectors, []);
  assert.equal(retry.sourceChanged, true);
  assert.equal(
    retry.config.node_types.central_feature.fields.title.widget,
    "string"
  );
  assert.deepEqual(retry.sourceConfig.collections.central_features, {
    connector: "central",
    remote_collection: "features"
  });
});

test("imports exact remote stubs without rewriting their owner", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  remote.node_types.video = { fields: { title: { widget: "string" } } };
  remote.collections.videos = {
    folder: "content/videos",
    node_type: "video"
  };
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.central_video = {
    connector: "central",
    remote_type: "video"
  };
  effective.collections.central_videos = {
    connector: "central",
    remote_collection: "videos"
  };

  const planned = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });
  assert.deepEqual(planned.changedConnectors, []);
  assert.equal(planned.config.collections.central_videos.node_type, "central_video");
});

test("rekeys local remote aliases without renaming their owner schema", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.media_image = effective.node_types.central_image;
  delete effective.node_types.central_image;
  effective.collections.media_images = effective.collections.central_images;
  delete effective.collections.central_images;
  effective.node_types.central_gallery.fields.lead.collection = "media_images";
  effective.node_types.central_gallery.fields.lead.allowed_types = [
    "media_image"
  ];
  effective.node_types.central_gallery.fields.copy.blocknote.inline_reference.collection =
    "media_images";
  effective.node_types.central_gallery.fields.copy.blocknote.internal_links.collections = [
    "central_galleries",
    "media_images"
  ];
  effective.node_types.central_gallery.slots.images.allowed_types = [
    "media_image"
  ];
  effective.node_types.central_gallery.slots.images.default[0].type =
    "media_image";
  effective.node_types.central_gallery.slots.images.default[0].properties.title =
    "[Lead](minicms://reference/media_images/lead)";
  effective.collections.media_images.node_type = "media_image";
  effective.collections.media_images.allowed_types = ["media_image"];

  const planned = planConfigWrites({
    effectiveConfig: effective,
    sourceConfig: source,
    remoteConfigs: { central: remote },
    schemaRenames: {
      node_types: { central_image: "media_image" },
      collections: { central_images: "media_images" }
    }
  });

  assert.deepEqual(planned.changedConnectors, []);
  assert.equal(planned.sourceChanged, true);
  assert.deepEqual(planned.sourceConfig.node_types.media_image, {
    connector: "central",
    remote_type: "image"
  });
  assert.deepEqual(planned.sourceConfig.collections.media_images, {
    connector: "central",
    remote_collection: "images"
  });
  assert.deepEqual(
    planned.config.node_types.central_gallery.fields.copy.blocknote
      .internal_links.collections,
    ["central_galleries", "media_images"]
  );
  assert.deepEqual(planned.remoteConfigs.central, remote);
  assert.deepEqual(planned.schemaRenames, {
    node_types: { central_image: "media_image" },
    collections: { central_images: "media_images" }
  });
});

test("never overwrites an unaliased remote definition or deletes an unlinked one", () => {
  const source = sourceConfig();
  const remote = remoteConfig();
  remote.node_types.archive = { fields: { title: { widget: "string" } } };
  remote.collections.archive = {
    folder: "content/archive",
    node_type: "archive"
  };
  const effective = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  effective.node_types.central_archive = {
    connector: "central",
    remote_type: "archive",
    fields: { title: { widget: "string", label: "Overwrite" } }
  };
  effective.collections.central_archive = {
    connector: "central",
    remote_collection: "archive",
    folder: "content/archive-new",
    node_type: "central_archive"
  };
  assert.throws(
    () =>
      planConfigWrites({
        effectiveConfig: effective,
        sourceConfig: source,
        remoteConfigs: { central: remote }
      }),
    /already has node type "archive"/
  );

  const withoutGallery = materializeConfig({
    sourceConfig: source,
    remoteConfigs: { central: remote }
  }).config;
  delete withoutGallery.collections.central_galleries;
  delete withoutGallery.node_types.central_gallery;
  withoutGallery.node_types.page.fields.gallery.collection = "central_images";
  const planned = planConfigWrites({
    effectiveConfig: withoutGallery,
    sourceConfig: source,
    remoteConfigs: { central: remote }
  });
  assert.ok(planned.remoteConfigs.central.collections.galleries);
  assert.ok(planned.remoteConfigs.central.node_types.gallery);
});
