import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInlineReferenceUrl,
  createContentAdapter,
  inlineReferenceOccurrencesInMarkdown
} from "./index.js";

const config = {
  site: { name: "Adapter fixture" },
  node_types: {
    page: {
      fields: {
        title: { widget: "string" },
        hero: {
          widget: "reference",
          collection: "images",
          selections: ["crop", "focus"]
        },
        hero_by_id: {
          widget: "reference",
          collection: "images",
          value_field: "$id"
        },
        hero_by_title: {
          widget: "reference",
          collection: "images",
          value_field: "title"
        },
        gallery: {
          widget: "reference",
          collection: "images",
          multiple: true
        },
        missing: { widget: "reference", collection: "images" },
        peer: {
          widget: "reference",
          collection: "pages",
          value_field: "$id"
        },
        download: { widget: "file" },
        poster: { widget: "image" }
      },
      slots: { content: { allowed_types: ["image"] } }
    },
    image: {
      fields: {
        asset: { widget: "reference", collection: "images" }
      }
    },
    media_image: {
      fields: {
        uuid: { widget: "uuid" },
        title: { widget: "string" },
        file: { widget: "image" }
      }
    }
  },
  collections: {
    pages: {
      folder: "content/pages",
      node_type: "page",
      views: { reference: { value: "id" } }
    },
    images: {
      folder: "content/images",
      node_type: "media_image",
      views: {
        reference: {
          value: "uuid",
          selections: {
            crop: {
              kind: "image_region",
              options: {
                field: "file",
                path: "regions",
                value: "id",
                label: "label"
              }
            },
            focus: {
              kind: "image_point",
              options: {
                field: "file",
                path: "points",
                value: "id",
                label: "label"
              }
            }
          }
        }
      }
    }
  }
};

test("exports the inline-reference occurrence scanner", () => {
  const href = buildInlineReferenceUrl("sources", "source-id");
  assert.deepEqual(
    inlineReferenceOccurrencesInMarkdown(`[source](${href})`),
    [{ href, collection: "sources", ref: "source-id", offset: 0 }]
  );
});

const image = {
  id: "hero-file",
  type: "media_image",
  order: 0,
  properties: {
    uuid: "hero-uuid",
    title: "Hero",
    file: {
      src: "/media/hero.jpg",
      width: 1200,
      height: 800,
      regions: [
        {
          id: "crop-wide",
          label: "Wide",
          x: 10,
          y: 20,
          width: 900,
          height: 500
        }
      ],
      points: [{ id: "focus-face", label: "Face", x: 450, y: 260 }]
    }
  },
  slots: {}
};

const home = {
  id: "home",
  type: "page",
  order: 0,
  properties: {
    title: "Home",
    hero: {
      ref: "hero-uuid",
      selections: {
        focus: "missing-focus",
        crop: "crop-wide",
        legacy: "old-selection"
      }
    },
    hero_by_id: "hero-file",
    hero_by_title: "Hero",
    gallery: ["missing-uuid", "hero-uuid"],
    missing: {
      ref: "missing-uuid",
      selections: { crop: "missing-crop" }
    },
    download: "/media/research.pdf",
    poster: {
      src: "/media/poster.png",
      width: 640,
      height: 480,
      regions: []
    }
  },
  slots: {
    content: [
      {
        id: "nested-image",
        type: "image",
        properties: { asset: "hero-uuid" },
        slots: {}
      }
    ]
  }
};

function sourceAdapter(
  records = { pages: [home], images: [image] },
  options = {}
) {
  const counters = { list: new Map(), get: new Map() };
  const byCollection = new Map(
    Object.entries(records).map(([name, entries]) => [
      name,
      new Map(entries.map((record) => [record.id, record]))
    ])
  );
  const adapter = createContentAdapter({
    config: options.config ?? config,
    listRaw(collectionName) {
      counters.list.set(
        collectionName,
        (counters.list.get(collectionName) ?? 0) + 1
      );
      return {
        collection: collectionName,
        items: [...(byCollection.get(collectionName)?.values() ?? [])].map(
          (record) => ({
            id: record.id,
            type: record.type,
            order: record.order,
            title: record.properties?.title || record.id,
            properties: record.properties
          })
        )
      };
    },
    getRaw(collectionName, id) {
      const key = `${collectionName}:${id}`;
      counters.get.set(key, (counters.get.get(key) ?? 0) + 1);
      return byCollection.get(collectionName)?.get(id) ?? null;
    },
    resolveMediaUrl(value) {
      return /^(?:https?:|data:|blob:)/i.test(value)
        ? value
        : `/project${value}`;
    },
    ...(options.resolveImageUrl
      ? { resolveImageUrl: options.resolveImageUrl }
      : {})
  });
  return { adapter, counters, records: byCollection };
}

test("returns one stable data envelope with deeply resolved content", async () => {
  const originalHome = structuredClone(home);
  const originalImage = structuredClone(image);
  const { adapter, counters } = sourceAdapter();
  const data = await adapter.get("pages", "home");

  assert.equal(data.config.site.name, "Adapter fixture");
  assert.equal(data.collection.name, "pages");
  assert.equal(data.item.id, "home");
  assert.ok(Object.isFrozen(data));
  assert.ok(Object.isFrozen(data.item));

  const hero = data.item.properties.hero;
  assert.equal(hero.ref, "hero-uuid");
  assert.equal(hero.record.id, "hero-file");
  assert.equal(hero.record.properties.file.src, "/project/media/hero.jpg");
  assert.deepEqual(Object.keys(hero.selections), ["crop", "focus", "legacy"]);
  assert.equal(hero.selections.crop.ref, "crop-wide");
  assert.deepEqual(hero.selections.crop.value, image.properties.file.regions[0]);
  assert.deepEqual(hero.selections.focus, {
    ref: "missing-focus",
    value: null
  });
  assert.deepEqual(hero.selections.legacy, {
    ref: "old-selection",
    value: null
  });

  assert.equal(data.item.properties.hero_by_id.record.id, "hero-file");
  assert.deepEqual(data.item.properties.hero_by_id.selections, {});
  assert.equal(data.item.properties.hero_by_title.record.id, "hero-file");
  assert.deepEqual(
    data.item.properties.gallery.map(({ ref, record, selections }) => ({
      ref,
      record: record?.id ?? null,
      selections
    })),
    [
      { ref: "missing-uuid", record: null, selections: {} },
      { ref: "hero-uuid", record: "hero-file", selections: {} }
    ]
  );
  assert.deepEqual(data.item.properties.missing, {
    ref: "missing-uuid",
    record: null,
    selections: { crop: { ref: "missing-crop", value: null } }
  });
  assert.equal(data.item.properties.download, "/project/media/research.pdf");
  assert.deepEqual(data.item.properties.poster, {
    src: "/project/media/poster.png",
    width: 640,
    height: 480,
    regions: []
  });
  assert.equal(
    data.item.slots.content[0].properties.asset.record.id,
    "hero-file"
  );

  await adapter.get("pages", "home");
  assert.equal(counters.get.get("pages:home"), 1);
  assert.equal(counters.get.get("images:hero-file"), 1);
  assert.equal(counters.list.get("images"), 2);
  assert.deepEqual(home, originalHome);
  assert.deepEqual(image, originalImage);
});

test("resolves images independently while files keep the raw media resolver", async () => {
  const { adapter } = sourceAdapter(undefined, {
    resolveImageUrl(value) {
      return `/processed${value}.webp`;
    }
  });
  const data = await adapter.get("pages", "home");

  assert.equal(data.item.properties.download, "/project/media/research.pdf");
  assert.equal(
    data.item.properties.poster.src,
    "/processed/media/poster.png.webp"
  );
  assert.equal(
    data.item.properties.hero.record.properties.file.src,
    "/processed/media/hero.jpg.webp"
  );
});

test("passes the owning collection to file and image resolvers", async () => {
  const calls = [];
  const adapter = createContentAdapter({
    config,
    listRaw(collectionName) {
      return collectionName === "pages" ? [home] : [image];
    },
    getRaw(collectionName, id) {
      if (collectionName === "pages" && id === home.id) return home;
      if (collectionName === "images" && id === image.id) return image;
      return null;
    },
    resolveMediaUrl(value, context) {
      calls.push({ kind: "file", value, ...context });
      return value;
    },
    resolveImageUrl(value, context) {
      calls.push({ kind: "image", value, ...context });
      return value;
    }
  });

  await adapter.get("pages", "home");

  assert.ok(
    calls.some(
      (call) =>
        call.kind === "file" &&
        call.value === "/media/research.pdf" &&
        call.collection === "pages"
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.kind === "image" &&
        call.value === "/media/poster.png" &&
        call.collection === "pages"
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.kind === "image" &&
        call.value === "/media/hero.jpg" &&
        call.collection === "images"
    )
  );
});

test("list returns resolved records in the same envelope shape as get", async () => {
  const { adapter, counters } = sourceAdapter();
  const listed = await adapter.list("pages");
  const selected = await adapter.get("pages", "home");

  assert.equal(listed.config, adapter.config());
  assert.equal(listed.collection.name, "pages");
  assert.deepEqual(listed.items, [selected.item]);
  assert.equal(counters.list.get("pages"), 1);
  assert.equal(counters.get.get("pages:home"), 1);
});

test("get accepts an unsaved record without caching over later drafts", async () => {
  const { adapter } = sourceAdapter();
  const first = await adapter.get("pages", {
    ...structuredClone(home),
    properties: { ...structuredClone(home.properties), title: "First draft" }
  });
  const second = await adapter.get("pages", {
    ...structuredClone(home),
    properties: { ...structuredClone(home.properties), title: "Second draft" }
  });

  assert.equal(first.item.properties.title, "First draft");
  assert.equal(second.item.properties.title, "Second draft");
});

function markdownReferenceFixture() {
  const fixtureConfig = {
    site: {
      reference_sets: {
        footnotes: {
          collections: ["sources"],
          item_template: "{{number}}. {{record.properties.title}}"
        }
      }
    },
    node_types: {
      article: {
        fields: {
          body: {
            widget: "markdown",
            blocknote: {
              inline_reference: {
                collection: "sources",
                reference_set: "footnotes"
              }
            }
          },
          plain: { widget: "markdown" }
        }
      },
      source: {
        fields: {
          content_id: { widget: "id" },
          title: { widget: "string" },
          image: { widget: "image" }
        }
      }
    },
    collections: {
      articles: { folder: "content/articles", node_type: "article" },
      sources: {
        folder: "content/sources",
        node_type: "source",
        views: {
          reference: { value: "content_id", title: "title" }
        }
      }
    }
  };
  const firstSource = {
    id: "first-source",
    type: "source",
    order: 0,
    properties: {
      content_id: "aaaaaaaaaaaaaaa",
      title: "First source",
      image: "/media/first-source.jpg"
    },
    slots: {}
  };
  const secondSource = {
    id: "second-source",
    type: "source",
    order: 1,
    properties: {
      content_id: "bbbbbbbbbbbbbbb",
      title: "Second source",
      image: ""
    },
    slots: {}
  };
  const article = {
    id: "article",
    type: "article",
    order: 0,
    properties: { body: "", plain: "" },
    slots: {}
  };
  const hrefs = {
    first: buildInlineReferenceUrl("sources", "aaaaaaaaaaaaaaa"),
    second: buildInlineReferenceUrl("sources", "bbbbbbbbbbbbbbb"),
    missing: buildInlineReferenceUrl("sources", "ccccccccccccccc"),
    otherCollection: buildInlineReferenceUrl("articles", "article")
  };

  return {
    config: fixtureConfig,
    records: {
      articles: [article],
      sources: [firstSource, secondSource]
    },
    article,
    firstSource,
    hrefs
  };
}

test("resolves configured inline Markdown references without changing storage", async () => {
  const fixture = markdownReferenceFixture();
  const { hrefs } = fixture;
  const markdown = [
    `Read [the source](${hrefs.first})`,
    `and [the same source again](${hrefs.first}).`,
    `Keep [a missing source](${hrefs.missing}),`,
    `ignore [another collection](${hrefs.otherCollection}),`,
    `ignore [a malformed reference](${hrefs.first}?draft=true),`,
    `plain text ${hrefs.second},`,
    `inline code \`[source](${hrefs.second})\`,`,
    `and ![an image](${hrefs.second}).`,
    `\n\n\`\`\`md\n[source](${hrefs.second})\n\`\`\``
  ].join(" ");
  fixture.article.properties.body = markdown;
  fixture.article.properties.plain = `Plain [source](${hrefs.first}).`;
  const originalArticle = structuredClone(fixture.article);
  const originalSource = structuredClone(fixture.firstSource);
  const { adapter, counters } = sourceAdapter(fixture.records, {
    config: fixture.config
  });

  const data = await adapter.get("articles", "article");
  const resolved = data.item.properties.body;

  assert.equal(resolved.markdown, markdown);
  assert.deepEqual(Object.keys(resolved.references), [
    hrefs.first,
    hrefs.missing
  ]);
  assert.equal(resolved.references[hrefs.first].collection, "sources");
  assert.equal(resolved.references[hrefs.first].ref, "aaaaaaaaaaaaaaa");
  assert.equal(
    resolved.references[hrefs.first].record.properties.title,
    "First source"
  );
  assert.equal(
    resolved.references[hrefs.first].record.properties.image,
    "/project/media/first-source.jpg"
  );
  assert.deepEqual(resolved.references[hrefs.missing], {
    collection: "sources",
    ref: "ccccccccccccccc",
    record: null
  });
  assert.equal(data.item.properties.plain, fixture.article.properties.plain);
  assert.equal(counters.list.get("sources"), 2);
  assert.equal(counters.get.get("sources:first-source"), 1);
  assert.deepEqual(fixture.article, originalArticle);
  assert.deepEqual(fixture.firstSource, originalSource);
});

test("resolves inline references independently for each unsaved Markdown draft", async () => {
  const fixture = markdownReferenceFixture();
  const { adapter } = sourceAdapter(fixture.records, {
    config: fixture.config
  });
  const firstMarkdown = `Draft [one](${fixture.hrefs.first}).`;
  const secondMarkdown = `Draft [two](${fixture.hrefs.second}).`;
  const firstDraft = structuredClone(fixture.article);
  firstDraft.properties.body = firstMarkdown;
  const secondDraft = structuredClone(fixture.article);
  secondDraft.properties.body = secondMarkdown;

  const first = await adapter.get("articles", firstDraft);
  const second = await adapter.get("articles", secondDraft);

  assert.equal(first.item.properties.body.markdown, firstMarkdown);
  assert.deepEqual(Object.keys(first.item.properties.body.references), [
    fixture.hrefs.first
  ]);
  assert.equal(
    first.item.properties.body.references[fixture.hrefs.first].record.id,
    "first-source"
  );
  assert.equal(second.item.properties.body.markdown, secondMarkdown);
  assert.deepEqual(Object.keys(second.item.properties.body.references), [
    fixture.hrefs.second
  ]);
  assert.equal(
    second.item.properties.body.references[fixture.hrefs.second].record.id,
    "second-source"
  );
});

test("refreshes a cached Markdown reference index after inline creation", async () => {
  const fixture = markdownReferenceFixture();
  const { adapter, counters, records } = sourceAdapter(fixture.records, {
    config: fixture.config
  });
  const firstDraft = structuredClone(fixture.article);
  firstDraft.properties.body = `Read [one](${fixture.hrefs.first}).`;
  await adapter.get("articles", firstDraft);

  const createdSource = {
    id: "created-source",
    type: "source",
    order: 2,
    properties: {
      content_id: "ccccccccccccccc",
      title: "Created source",
      image: ""
    },
    slots: {}
  };
  records.get("sources").set(createdSource.id, createdSource);
  const createdHref = buildInlineReferenceUrl(
    "sources",
    createdSource.properties.content_id
  );
  const secondDraft = structuredClone(fixture.article);
  secondDraft.properties.body = `Read [created](${createdHref}).`;

  const data = await adapter.get("articles", secondDraft);

  assert.equal(
    data.item.properties.body.references[createdHref].record.properties.title,
    "Created source"
  );
  assert.equal(counters.list.get("sources"), 2);
});

test("accepts a storage source object and preserves its method receiver", async () => {
  const records = new Map([[home.id, home]]);
  const source = {
    prefix: "/source",
    list() {
      return [...records.values()];
    },
    record(_collectionName, id) {
      return records.get(id) ?? null;
    },
    resolveMediaUrl(value) {
      return `${this.prefix}${value}`;
    }
  };
  const adapter = createContentAdapter({ config, source });
  const data = await adapter.get("pages", "home");

  assert.equal(data.item.properties.download, "/source/media/research.pdf");
});

test("configured reference values do not fall back to colliding record IDs", async () => {
  const collision = {
    ...structuredClone(image),
    id: "hero-uuid",
    properties: {
      ...structuredClone(image.properties),
      uuid: "different-uuid",
      title: "Wrong record"
    }
  };
  const { adapter } = sourceAdapter({
    pages: [home],
    images: [collision, image]
  });
  const data = await adapter.get("pages", "home");

  assert.equal(data.item.properties.hero.record.id, "hero-file");
});

test("refreshes a cached regular reference index after target creation", async () => {
  const referenceConfig = {
    site: {},
    node_types: {
      page: {
        fields: {
          hero: { widget: "reference", collection: "images" }
        }
      },
      media_image: {
        fields: {
          content_id: { widget: "id" },
          title: { widget: "string" }
        }
      }
    },
    collections: {
      pages: { folder: "content/pages", node_type: "page" },
      images: {
        folder: "content/images",
        node_type: "media_image",
        views: {
          reference: { value: "content_id", title: "title" }
        }
      }
    }
  };
  const firstImage = {
    id: "first-image",
    type: "media_image",
    order: 0,
    properties: { content_id: "aaaaaaaaaaaaaaa", title: "First" },
    slots: {}
  };
  const createdImage = {
    id: "created-image",
    type: "media_image",
    order: 1,
    properties: { content_id: "bbbbbbbbbbbbbbb", title: "Created" },
    slots: {}
  };
  const page = {
    id: "page",
    type: "page",
    order: 0,
    properties: { hero: "aaaaaaaaaaaaaaa" },
    slots: {}
  };
  const { adapter, counters, records } = sourceAdapter(
    { pages: [page], images: [firstImage] },
    { config: referenceConfig }
  );

  await adapter.get("pages", page);
  records.get("images").set(createdImage.id, createdImage);
  const draft = structuredClone(page);
  draft.properties.hero = "bbbbbbbbbbbbbbb";
  const data = await adapter.get("pages", draft);

  assert.equal(data.item.properties.hero.record.properties.title, "Created");
  assert.deepEqual(data.item.properties.hero.selections, {});
  assert.equal(counters.list.get("images"), 2);
});

test("treats explicit null record envelopes as missing", async () => {
  const adapter = createContentAdapter({
    config,
    listRaw: () => [],
    getRaw: () => ({ item: null })
  });

  assert.equal(await adapter.get("pages", "missing"), null);
});

test("guards recursive references while preserving the reference value", async () => {
  const first = {
    id: "first",
    type: "page",
    order: 0,
    properties: { title: "First", peer: "second" },
    slots: {}
  };
  const second = {
    id: "second",
    type: "page",
    order: 1,
    properties: { title: "Second", peer: "first" },
    slots: {}
  };
  const { adapter } = sourceAdapter({ pages: [first, second], images: [] });
  const data = await adapter.get("pages", "first");

  assert.equal(data.item.properties.peer.record.id, "second");
  assert.deepEqual(data.item.properties.peer.record.properties.peer, {
    ref: "first",
    record: null,
    selections: {}
  });
  assert.equal(await adapter.get("pages", "unknown"), null);
});

test("resolves ordered tag ID arrays through the standard relation envelope", async () => {
  const tagConfig = {
    site: {},
    node_types: {
      article: {
        fields: {
          title: { widget: "string" },
          tags: { widget: "tags", collection: "tags" }
        }
      },
      tag: {
        fields: {
          content_id: { widget: "id" },
          name: { widget: "string" }
        }
      }
    },
    collections: {
      articles: { folder: "content/articles", node_type: "article" },
      tags: {
        folder: "content/tags",
        node_type: "tag",
        views: {
          reference: { value: "content_id", title: "name" }
        }
      }
    }
  };
  const firstTag = {
    id: "research",
    type: "tag",
    order: 0,
    properties: { content_id: "aaaaaaaaaaaaaaa", name: "Research" },
    slots: {}
  };
  const article = {
    id: "article",
    type: "article",
    order: 0,
    properties: {
      title: "Article",
      tags: ["aaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbb"]
    },
    slots: {}
  };
  const { adapter } = sourceAdapter(
    { articles: [article], tags: [firstTag] },
    { config: tagConfig }
  );
  const data = await adapter.get("articles", "article");

  assert.deepEqual(data.item.properties.tags, [
    { ref: "aaaaaaaaaaaaaaa", record: firstTag, selections: {} },
    { ref: "bbbbbbbbbbbbbbb", record: null, selections: {} }
  ]);
  assert.deepEqual(article.properties.tags, [
    "aaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbb"
  ]);
});

test("refreshes a cached tag index after inline tag creation", async () => {
  const tagConfig = {
    site: {},
    node_types: {
      article: {
        fields: { tags: { widget: "tags", collection: "tags" } }
      },
      tag: {
        fields: {
          content_id: { widget: "id" },
          name: { widget: "string" }
        }
      }
    },
    collections: {
      articles: { folder: "content/articles", node_type: "article" },
      tags: {
        folder: "content/tags",
        node_type: "tag",
        views: {
          reference: { value: "content_id", title: "name" }
        }
      }
    }
  };
  const firstTag = {
    id: "research",
    type: "tag",
    order: 0,
    properties: { content_id: "aaaaaaaaaaaaaaa", name: "Research" },
    slots: {}
  };
  const secondTag = {
    id: "typography",
    type: "tag",
    order: 1,
    properties: { content_id: "bbbbbbbbbbbbbbb", name: "Typography" },
    slots: {}
  };
  const thirdTag = {
    id: "legibility",
    type: "tag",
    order: 2,
    properties: { content_id: "ccccccccccccccc", name: "Legibility" },
    slots: {}
  };
  const article = {
    id: "article",
    type: "article",
    order: 0,
    properties: { tags: ["aaaaaaaaaaaaaaa"] },
    slots: {}
  };
  const { adapter, counters, records } = sourceAdapter(
    { articles: [article], tags: [firstTag] },
    { config: tagConfig }
  );

  await adapter.get("articles", article);
  records.get("tags").set(secondTag.id, secondTag);
  records.get("tags").set(thirdTag.id, thirdTag);
  const draft = structuredClone(article);
  draft.properties.tags.push("bbbbbbbbbbbbbbb", "ccccccccccccccc");
  const data = await adapter.get("articles", draft);

  assert.equal(data.item.properties.tags[1].record.properties.name, "Typography");
  assert.equal(data.item.properties.tags[2].record.properties.name, "Legibility");
  assert.equal(counters.list.get("tags"), 2);
});

test("validates the core source contract and unknown collections", async () => {
  assert.throws(() => createContentAdapter(), /configuration mapping/);
  assert.throws(
    () => createContentAdapter({ config, listRaw() {} }),
    /listRaw and getRaw/
  );
  const { adapter } = sourceAdapter();
  await assert.rejects(adapter.list("unknown"), /does not exist/);
});

test("publishes one project-facing content entry", async () => {
  const content = await import("@signalwerk/minicms/content");

  assert.deepEqual(Object.keys(content), [
    "INLINE_REFERENCE_PREFIX",
    "buildInlineReferenceUrl",
    "createContentAdapter",
    "inlineReferenceOccurrencesInMarkdown",
    "isAllowedMarkdownLink",
    "isInlineReferenceUrl",
    "parseInlineReferenceUrl",
    "prependImageServiceOperations"
  ]);
});
