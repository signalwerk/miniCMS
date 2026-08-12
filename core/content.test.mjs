import test from "node:test";
import assert from "node:assert/strict";
import {
  dumpYaml,
  isInternalLinkCollectionCompatible,
  parseYaml,
  summarizeRecord,
  validateConfig,
  validateSourceConfig,
  validateRecord
} from "./content.js";

function fixtureConfig() {
  return {
    connectors: {
      default: {
        name: "github",
        repo: "signalwerk/example",
        base_url: "https://auth.example.com",
        branch: "main"
      }
    },
    site: {
      media_folder: "content/media",
      public_folder: "/media"
    },
    node_types: {
      page: {
        fields: {
          title: { widget: "string" }
        }
      }
    },
    collections: {
      pages: {
        folder: "content/pages",
        extension: "yml",
        node_type: "page",
        allowed_types: ["page"]
      }
    }
  };
}

test("parses and writes deterministic JSON-schema YAML", () => {
  const source = dumpYaml({
    published: "2026-07-31",
    enabled: true
  });
  assert.match(source, /published: "2026-07-31"/);
  assert.equal(parseYaml(source).published, "2026-07-31");
});

test("validates the default GitHub connector and repository content paths", () => {
  assert.equal(
    validateConfig(fixtureConfig()).connectors.default.name,
    "github"
  );

  const invalidRepository = fixtureConfig();
  invalidRepository.connectors.default.repo = "missing-owner";
  assert.throws(
    () => validateConfig(invalidRepository, 400),
    /owner\/repository/
  );

  const escapedFolder = fixtureConfig();
  escapedFolder.collections.pages.folder = "../outside";
  assert.throws(
    () => validateConfig(escapedFolder, 400),
    /Invalid Collection "pages" folder/
  );
});

function slotDefaultConfig() {
  const config = fixtureConfig();
  config.node_types.page.slots = {
    content: {
      allowed_types: ["section"],
      max: 2,
      default: [
        {
          type: "section",
          properties: {
            title: "",
            body: "[Source](minicms://reference/pages/home)",
            element: "none",
            enabled: false,
            count: 0,
            published_at: "2026-08-12",
            website: ""
          }
        }
      ]
    }
  };
  config.node_types.section = {
    fields: {
      title: { widget: "string", required: true },
      body: { widget: "markdown" },
      element: { widget: "select", options: ["none", "h2"] },
      enabled: { widget: "boolean" },
      count: { widget: "number" },
      published_at: { widget: "datetime" },
      website: { widget: "url" },
      content_id: { widget: "id" },
      image: { widget: "image" },
      file: { widget: "file" },
      related: { widget: "reference", collection: "pages" }
    }
  };
  return config;
}

test("validates ordered flat slot default templates and scalar overrides", () => {
  const config = slotDefaultConfig();
  assert.deepEqual(
    validateConfig(config).node_types.page.slots.content.default,
    config.node_types.page.slots.content.default
  );

  const invalidCases = [
    [
      (slot) => { slot.default = { type: "section" }; },
      /default must be an array/
    ],
    [
      (slot) => { slot.default[0].id = "stored"; },
      /only type and properties/
    ],
    [
      (slot) => { slot.default[0].type = "page"; },
      /must be one of the slot's allowed content types/
    ],
    [
      (slot) => { slot.default[0].properties.unknown = "value"; },
      /unknown field "unknown"/
    ],
    [
      (slot) => { slot.default[0].properties.content_id = "aaaaaaaaaaaaaaa"; },
      /cannot override id field/
    ],
    [
      (slot) => { slot.default[0].properties.image = ""; },
      /cannot override image field/
    ],
    [
      (slot) => { slot.default[0].properties.file = ""; },
      /cannot override file field/
    ],
    [
      (slot) => { slot.default[0].properties.related = "home"; },
      /cannot override reference field/
    ],
    [
      (slot, config) => {
        config.node_types.section.fields.tags = { widget: "tags" };
        slot.default[0].properties.tags = [];
      },
      /cannot override tags field/
    ],
    [
      (slot) => { slot.default[0].properties.element = "missing"; },
      /invalid select value/
    ],
    [
      (slot) => { slot.default[0].properties.enabled = "false"; },
      /invalid boolean value/
    ],
    [
      (slot) => { slot.default[0].properties.website = "/relative"; },
      /invalid url value/
    ],
    [
      (slot) => { slot.default.push(structuredClone(slot.default[0]), structuredClone(slot.default[0])); },
      /exceeds its maximum/
    ]
  ];

  for (const [mutate, expected] of invalidCases) {
    const invalid = slotDefaultConfig();
    mutate(invalid.node_types.page.slots.content, invalid);
    assert.throws(() => validateConfig(invalid, 400), expected);
  }
});

test("rejects recursive slot default template cycles", () => {
  const config = slotDefaultConfig();
  config.node_types.section.slots = {
    nested: {
      allowed_types: ["page"],
      default: [{ type: "page" }]
    }
  };
  assert.throws(
    () => validateConfig(config, 400),
    /content-type cycle: page -> section -> page/
  );
});

test("enforces configured slot minimums for missing and short record slots", () => {
  const config = fixtureConfig();
  config.node_types.page.slots = {
    content: {
      allowed_types: ["section"],
      min: 2,
      max: 3
    }
  };
  config.node_types.section = { fields: {} };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const section = (id) => ({
    id,
    type: "section",
    properties: {},
    slots: {}
  });
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: { title: "Home" }
  };

  assert.throws(
    () => validateRecord(record, collection, config),
    /Slot "content" requires at least 2 items/
  );
  assert.throws(
    () => validateRecord(
      { ...record, slots: { content: [section("first")] } },
      collection,
      config
    ),
    /Slot "content" requires at least 2 items/
  );
  const valid = {
    ...record,
    slots: { content: [section("first"), section("second")] }
  };
  assert.equal(validateRecord(valid, collection, config), valid);
});

test("rejects overlapping collection and media storage folders", () => {
  const duplicate = fixtureConfig();
  duplicate.collections.archive = {
    folder: duplicate.collections.pages.folder,
    node_type: "page"
  };
  assert.throws(
    () => validateConfig(duplicate),
    /folder overlaps collection/
  );

  const nested = fixtureConfig();
  nested.collections.archive = {
    folder: `${nested.collections.pages.folder}/archive`,
    node_type: "page"
  };
  assert.throws(() => validateConfig(nested), /folder overlaps collection/);

  const media = fixtureConfig();
  media.site.media_folder = `${media.collections.pages.folder}/media`;
  assert.throws(() => validateConfig(media), /media_folder overlaps/);

  const root = fixtureConfig();
  root.collections.pages.folder = "content";
  assert.throws(() => validateConfig(root), /must be below content/);
});

test("accepts secure API connectors and rejects the removed backend contract", () => {
  const apiConfig = fixtureConfig();
  apiConfig.connectors.default = {
    name: "api",
    api_url: "https://content.example.com",
    auth_url: "https://auth.example.com"
  };
  assert.equal(validateConfig(apiConfig).connectors.default.name, "api");
  assert.equal(
    validateConfig(apiConfig).connectors.default.api_url,
    "https://content.example.com"
  );

  const legacyConfig = fixtureConfig();
  legacyConfig.backend = { name: "node", api_url: "" };
  assert.throws(() => validateConfig(legacyConfig), /singular backend/);

  const whitespaceConfig = fixtureConfig();
  whitespaceConfig.connectors.default = {
    name: "api",
    api_url: "   ",
    auth_url: "https://auth.example.com"
  };
  assert.equal(
    validateConfig(whitespaceConfig).connectors.default.api_url,
    ""
  );

  const invalidConfig = fixtureConfig();
  invalidConfig.connectors.default = {
    name: "api",
    api_url: 42,
    auth_url: "https://auth.example.com"
  };
  assert.throws(
    () => validateConfig(invalidConfig, 400),
    /miniCMS API URL must be a string/
  );

  for (const apiUrl of [
    "http://content.example.com",
    "ftp://content.example.com",
    "https://user@content.example.com",
    "https://content.example.com/api",
    "https://content.example.com?project=other"
  ]) {
    const invalidOrigin = fixtureConfig();
    invalidOrigin.connectors.default = {
      name: "api",
      api_url: apiUrl,
      auth_url: "https://auth.example.com"
    };
    assert.throws(
      () => validateConfig(invalidOrigin, 400),
      /miniCMS API URL/
    );
  }
});

test("validates source connectors and remote declaration stubs", () => {
  const config = fixtureConfig();
  config.connectors.development = {
    name: "api",
    api_url: "http://127.0.0.1:8787"
  };
  config.connectors.central = {
    name: "api",
    api_url: "https://content.example.com/",
    auth_url: "https://auth.example.com/"
  };
  config.node_types.central_image = {
    connector: "central",
    remote_type: "image"
  };
  config.collections.central_images = {
    connector: "central",
    remote_collection: "images"
  };

  const validated = validateSourceConfig(config);
  assert.equal(
    validated.connectors.development.api_url,
    "http://127.0.0.1:8787"
  );
  assert.equal(
    validated.connectors.central.api_url,
    "https://content.example.com"
  );
  assert.equal(
    validated.connectors.central.auth_url,
    "https://auth.example.com"
  );

  const missingAuth = structuredClone(config);
  delete missingAuth.connectors.central.auth_url;
  assert.throws(
    () => validateSourceConfig(missingAuth),
    /must define an HTTPS auth_url/
  );

  for (const authUrl of [
    "",
    42,
    "http://auth.example.com",
    "https://auth.example.com/path",
    "https://user@auth.example.com"
  ]) {
    const invalidAuth = structuredClone(config);
    invalidAuth.connectors.central.auth_url = authUrl;
    assert.throws(
      () => validateSourceConfig(invalidAuth),
      /authentication URL/
    );
  }

  const noDefault = structuredClone(config);
  delete noDefault.connectors.default;
  assert.throws(() => validateSourceConfig(noDefault), /"default" connector/);

  const namedWithoutOrigin = structuredClone(config);
  namedWithoutOrigin.connectors.central = { name: "api" };
  assert.throws(
    () => validateSourceConfig(namedWithoutOrigin),
    /must define an HTTPS api_url/
  );

  const insecureNamed = structuredClone(config);
  insecureNamed.connectors.central.api_url = "http://127.0.0.1:8787";
  assert.throws(
    () => validateSourceConfig(insecureNamed),
    /must use HTTPS/
  );

  const insecureDevelopment = structuredClone(config);
  insecureDevelopment.connectors.development.api_url =
    "http://content.example.com";
  assert.throws(
    () => validateSourceConfig(insecureDevelopment),
    /loopback HTTP origin/
  );

  const authenticatedDevelopment = structuredClone(config);
  authenticatedDevelopment.connectors.development.api_url =
    "https://content.example.com";
  assert.throws(
    () => validateSourceConfig(authenticatedDevelopment),
    /must define an HTTPS auth_url/
  );

  const reservedAlias = structuredClone(config);
  reservedAlias.node_types.central_image.connector = "development";
  assert.throws(
    () => validateSourceConfig(reservedAlias),
    /named connector.*reserved connector/
  );

  const expandedStub = structuredClone(config);
  expandedStub.collections.central_images.label = "Copied schema";
  assert.throws(
    () => validateSourceConfig(expandedStub),
    /may define only connector and remote_collection/
  );
});

test("source validation remains strict for local definitions beside aliases", () => {
  const config = fixtureConfig();
  config.connectors.central = {
    name: "api",
    api_url: "https://content.example.com",
    auth_url: "https://auth.example.com"
  };
  config.node_types.central_image = {
    connector: "central",
    remote_type: "image"
  };
  config.collections.central_images = {
    connector: "central",
    remote_collection: "images"
  };

  const unsupportedWidget = structuredClone(config);
  unsupportedWidget.node_types.page.fields.title.widget = "mystery";
  assert.throws(
    () => validateSourceConfig(unsupportedWidget, 400),
    /unsupported widget/
  );

  const unknownSearchField = structuredClone(config);
  unknownSearchField.collections.pages.views = {
    list: { type: "table", search: { fields: ["missing"] } }
  };
  assert.throws(
    () => validateSourceConfig(unknownSearchField, 400),
    /references unknown field "missing"/
  );

  const invalidImageConfig = structuredClone(config);
  invalidImageConfig.site.image_processing = { width: -1 };
  assert.throws(
    () => validateSourceConfig(invalidImageConfig, 400),
    /width/
  );

  const crossConnectorSlot = structuredClone(config);
  crossConnectorSlot.node_types.page.slots = {
    content: { allowed_types: ["central_image"] }
  };
  assert.throws(
    () => validateSourceConfig(crossConnectorSlot, 400),
    /from another connector/
  );
});

test("validates quick-filter storage without rejecting stale schema semantics", () => {
  const config = fixtureConfig();
  config.collections.pages.views = {
    list: {
      type: "table",
      quick_filters: {
        built_in: {
          current: {
            label: "Current",
            expression: {
              mode: "all",
              children: [
                {
                  field: "field_removed_later",
                  operator: "operator_removed_later",
                  value: "@days(-30)"
                }
              ]
            }
          }
        },
        user_created: {
          abcdefghijklmno: {
            label: "Editorial review",
            expression: {
              mode: "any",
              children: [
                { field: "title", operator: "contains", value: "Beowolf" },
                {
                  mode: "all",
                  children: [
                    { field: "$updated_at", operator: "is_not_null" }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  };

  const validated = validateConfig(config, 400);
  assert.equal(
    validated.collections.pages.views.list.quick_filters.built_in.current
      .expression.children[0].value,
    "@days(-30)"
  );
  const roundTripped = parseYaml(dumpYaml(validated));
  assert.deepEqual(
    roundTripped.collections.pages.views.list.quick_filters,
    validated.collections.pages.views.list.quick_filters
  );
});

test("rejects malformed quick-filter configuration", () => {
  function quickFilterConfig() {
    const config = fixtureConfig();
    config.collections.pages.views = {
      list: {
        type: "table",
        quick_filters: {
          user_created: {
            abcdefghijklmno: {
              label: "Review",
              expression: {
                mode: "all",
                children: [
                  { field: "title", operator: "contains", value: "draft" }
                ]
              }
            }
          }
        }
      }
    };
    return config;
  }

  const cases = [
    [
      (config) => {
        config.collections.pages.views.list.quick_filters = [];
      },
      /quick_filters must be a mapping/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.other = {};
      },
      /unsupported key "other"/
    ],
    [
      (config) => {
        const filters =
          config.collections.pages.views.list.quick_filters.user_created;
        filters.short = filters.abcdefghijklmno;
        delete filters.abcdefghijklmno;
      },
      /quick filter ID "short" is invalid/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.built_in = {
          abcdefghijklmno: {
            label: "Built in",
            expression: {
              mode: "all",
              children: [{ field: "title", operator: "is_not_empty" }]
            }
          }
        };
      },
      /quick filter IDs must be unique/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.label = " ";
      },
      /label must be non-empty/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.built_in = {
          duplicate: {
            label: " review ",
            expression: {
              mode: "all",
              children: [{ field: "title", operator: "is_not_empty" }]
            }
          }
        };
      },
      /labels must be unique/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.expression = {
          field: "title",
          operator: "contains",
          value: "draft"
        };
      },
      /expression root must be a group/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.expression.children = [];
      },
      /must contain at least one rule or group/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.expression.children[0] = {
          field: "title",
          children: [],
          operator: "contains"
        };
      },
      /either a group or a rule/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.expression.children[0].value = { raw: "draft" };
      },
      /value must be a scalar/
    ],
    [
      (config) => {
        config.collections.pages.views.list.quick_filters.user_created
          .abcdefghijklmno.expression.ui_id = "transient";
      },
      /unsupported key "ui_id"/
    ]
  ];

  for (const [change, expected] of cases) {
    const config = quickFilterConfig();
    change(config);
    assert.throws(() => validateConfig(config, 400), expected);
  }

  const cyclic = quickFilterConfig();
  const expression =
    cyclic.collections.pages.views.list.quick_filters.user_created
      .abcdefghijklmno.expression;
  expression.children = [expression];
  assert.throws(
    () => validateConfig(cyclic, 400),
    /must not contain a cycle/
  );
});

test("validates the image processing and cache contract", () => {
  const config = fixtureConfig();
  config.site.image_processing = {
    width: 1600,
    height: 1200,
    fit: "inside",
    format: "avif",
    quality: 75,
    cache: {
      schema: "images_2",
      strategy: "immutable",
      max_age: 31_536_000
    }
  };
  assert.equal(
    validateConfig(config).site.image_processing.cache.schema,
    "images_2"
  );
  assert.deepEqual(config.site.image_processing.cache, {
    schema: "images_2"
  });

  const invalid = structuredClone(config);
  invalid.site.image_processing.cache.schema = "../../images";
  assert.throws(
    () => validateConfig(invalid, 400),
    /cache\.schema must match/
  );
});

test("normalizes legacy image accept strings to the array config shape", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.image = {
    widget: "image",
    accept: "image/png,image/svg+xml"
  };

  assert.deepEqual(validateConfig(config).node_types.page.fields.image.accept, [
    "image/png",
    "image/svg+xml"
  ]);
});

test("requires canonical image defaults without persisted source keys", () => {
  const hash = "a".repeat(64);
  const config = fixtureConfig();
  config.node_types.page.fields.image = {
    widget: "image",
    default: { hash, filename: "Grüße.png" }
  };
  assert.deepEqual(validateConfig(config).node_types.page.fields.image.default, {
    hash,
    filename: "Grüße.png"
  });

  for (const defaultValue of [
    "/media/legacy.png",
    { src: "/media/legacy.png" },
    { hash, filename: "Gru\u0308ße.png" },
    { hash, filename: "image.png", src: "/resolved.png" },
    { hash, filename: "image.png", path: "/legacy.png" },
    { hash, filename: "image.png", sha: hash }
  ]) {
    const invalid = fixtureConfig();
    invalid.node_types.page.fields.image = {
      widget: "image",
      default: defaultValue
    };
    assert.throws(() => validateConfig(invalid, 400), /canonical hash/);
  }
});

test("accepts generated ID fields and normalizes the legacy UUID widget", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.content_id = { widget: "id" };
  config.node_types.page.fields.legacy_id = { widget: "uuid" };

  const validated = validateConfig(config);
  assert.equal(validated.node_types.page.fields.content_id.widget, "id");
  assert.equal(validated.node_types.page.fields.legacy_id.widget, "id");
});

test("keeps fields optional by default and omits explicit false", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.optional = {
    widget: "string",
    required: false
  };
  config.node_types.page.fields.required = {
    widget: "string",
    required: true
  };

  const validated = validateConfig(config);
  assert.equal(
    Object.hasOwn(validated.node_types.page.fields.optional, "required"),
    false
  );
  assert.equal(validated.node_types.page.fields.required.required, true);
  assert.doesNotMatch(dumpYaml(validated), /required: false/);

  const invalid = fixtureConfig();
  invalid.node_types.page.fields.title.required = "yes";
  assert.throws(
    () => validateConfig(invalid, 400),
    /required must be true when configured/
  );
});

test("validates and normalizes multiple reference configuration", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.authors = {
    widget: "reference",
    collection: "pages",
    multiple: true
  };
  config.node_types.page.fields.related = {
    widget: "reference",
    collection: "pages",
    multiple: false
  };

  const validated = validateConfig(config);
  assert.equal(validated.node_types.page.fields.authors.multiple, true);
  assert.equal(
    Object.hasOwn(validated.node_types.page.fields.related, "multiple"),
    false
  );

  for (const [configure, message] of [
    [
      (field) => {
        field.multiple = "yes";
      },
      /multiple must be true only for a reference widget/
    ],
    [
      (field) => {
        field.widget = "string";
        delete field.collection;
      },
      /multiple must be true only for a reference widget/
    ],
    [
      (field) => {
        field.default = [];
      },
      /cannot define a default/
    ],
    [
      (field) => {
        field.selections = [];
      },
      /cannot define selections/
    ]
  ]) {
    const invalid = fixtureConfig();
    invalid.node_types.page.fields.authors = {
      widget: "reference",
      collection: "pages",
      multiple: true
    };
    configure(invalid.node_types.page.fields.authors);
    assert.throws(() => validateConfig(invalid, 400), message);
  }
});

test("validates markdown BlockNote inline reference configuration", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.body = {
    widget: "markdown",
    blocknote: {
      inline_reference: {
        collection: "pages",
        preview_field: "title"
      }
    }
  };

  const validated = validateConfig(config);
  assert.deepEqual(
    validated.node_types.page.fields.body.blocknote.inline_reference,
    { collection: "pages", preview_field: "title" }
  );
  assert.match(dumpYaml(validated), /inline_reference:/);

  const fallbackTitle = structuredClone(config);
  delete fallbackTitle.node_types.page.fields.body.blocknote.inline_reference
    .preview_field;
  assert.equal(
    validateConfig(fallbackTitle).node_types.page.fields.body.blocknote
      .inline_reference.collection,
    "pages"
  );

  const wrongWidget = structuredClone(config);
  wrongWidget.node_types.page.fields.body.widget = "text";
  assert.throws(
    () => validateConfig(wrongWidget, 400),
    /configure BlockNote only for a markdown widget/
  );

  for (const [property, value, expected] of [
    ["blocknote", [], /blocknote must be a mapping/],
    ["inline_reference", [], /inline_reference must be a mapping/]
  ]) {
    const invalid = structuredClone(config);
    if (property === "blocknote") {
      invalid.node_types.page.fields.body.blocknote = value;
    } else {
      invalid.node_types.page.fields.body.blocknote[property] = value;
    }
    assert.throws(() => validateConfig(invalid, 400), expected);
  }

  const missingCollectionName = structuredClone(config);
  missingCollectionName.node_types.page.fields.body.blocknote.inline_reference
    .collection = "";
  assert.throws(
    () => validateConfig(missingCollectionName, 400),
    /must define a collection/
  );

  const unknownCollection = structuredClone(config);
  unknownCollection.node_types.page.fields.body.blocknote.inline_reference
    .collection = "missing";
  assert.throws(
    () => validateConfig(unknownCollection, 400),
    /inline reference uses unknown collection "missing"/
  );

  const emptyPreviewField = structuredClone(config);
  emptyPreviewField.node_types.page.fields.body.blocknote.inline_reference
    .preview_field = "";
  assert.throws(
    () => validateConfig(emptyPreviewField, 400),
    /preview_field must be a non-empty field name/
  );

  const unknownPreviewField = structuredClone(config);
  unknownPreviewField.node_types.page.fields.body.blocknote.inline_reference
    .preview_field = "missing";
  assert.throws(
    () => validateConfig(unknownPreviewField, 400),
    /inline reference preview references unknown field "missing"/
  );

  const structuredPreviewField = structuredClone(config);
  structuredPreviewField.node_types.page.fields.poster = { widget: "image" };
  structuredPreviewField.node_types.page.fields.body.blocknote.inline_reference
    .preview_field = "poster";
  assert.throws(
    () => validateConfig(structuredPreviewField, 400),
    /inline reference preview field "poster" must store scalar text/
  );

  const numericValueField = structuredClone(config);
  numericValueField.node_types.page.fields.sequence = { widget: "number" };
  numericValueField.collections.pages.views = {
    reference: { value: "sequence" }
  };
  assert.throws(
    () => validateConfig(numericValueField, 400),
    /inline reference value field "sequence" must store text/
  );
});

test("validates configurable Markdown internal-link collections", () => {
  const config = fixtureConfig();
  config.collections.articles = {
    folder: "content/articles",
    node_type: "page"
  };
  config.node_types.page.fields.body = {
    widget: "markdown",
    blocknote: {
      internal_links: {
        collections: ["pages", "articles"]
      }
    }
  };

  assert.deepEqual(
    validateConfig(config).node_types.page.fields.body.blocknote.internal_links,
    { collections: ["pages", "articles"] }
  );
  assert.match(dumpYaml(validateConfig(config)), /internal_links:/);

  const notMapping = structuredClone(config);
  notMapping.node_types.page.fields.body.blocknote.internal_links = [];
  assert.throws(
    () => validateConfig(notMapping, 400),
    /internal_links must be a mapping/
  );

  const empty = structuredClone(config);
  empty.node_types.page.fields.body.blocknote.internal_links.collections = [];
  assert.throws(
    () => validateConfig(empty, 400),
    /must define at least one collection/
  );

  const duplicate = structuredClone(config);
  duplicate.node_types.page.fields.body.blocknote.internal_links.collections = [
    "pages",
    "pages"
  ];
  assert.throws(
    () => validateConfig(duplicate, 400),
    /repeat collection "pages"/
  );

  const unknown = structuredClone(config);
  unknown.node_types.page.fields.body.blocknote.internal_links.collections = [
    "missing"
  ];
  assert.throws(
    () => validateConfig(unknown, 400),
    /internal links use unknown collection "missing"/
  );

  const numericValue = structuredClone(config);
  numericValue.node_types.page.fields.sequence = { widget: "number" };
  numericValue.collections.pages.views = {
    reference: { value: "sequence" }
  };
  assert.throws(
    () => validateConfig(numericValue, 400),
    /internal link collection "pages" value field "sequence" must store strings for allowed node type "page"/
  );

  const stringSelect = structuredClone(config);
  stringSelect.node_types.page.fields.link_id = {
    widget: "select",
    options: ["first", { label: "Second", value: "second" }]
  };
  stringSelect.collections.pages.views = {
    reference: { value: "link_id" }
  };
  assert.equal(
    isInternalLinkCollectionCompatible(stringSelect, "pages"),
    true
  );
  assert.doesNotThrow(() => validateConfig(stringSelect, 400));

  for (const invalidOption of [2, true]) {
    const mixedSelect = structuredClone(stringSelect);
    mixedSelect.node_types.page.fields.link_id.options.push(invalidOption);
    assert.equal(
      isInternalLinkCollectionCompatible(mixedSelect, "pages"),
      false
    );
    assert.throws(
      () => validateConfig(mixedSelect, 400),
      /must store strings for allowed node type "page"/
    );
  }

  const heterogeneous = structuredClone(config);
  heterogeneous.node_types.page.fields.link_id = { widget: "string" };
  heterogeneous.node_types.shortcut = {
    fields: { link_id: { widget: "number" } }
  };
  heterogeneous.collections.pages.allowed_types = ["page", "shortcut"];
  heterogeneous.collections.pages.views = {
    reference: { value: "link_id" }
  };
  assert.equal(
    isInternalLinkCollectionCompatible(heterogeneous, "pages"),
    false
  );
  assert.throws(
    () => validateConfig(heterogeneous, 400),
    /must store strings for allowed node type "shortcut"/
  );
});

test("validates named inline-reference sets and safe item templates", () => {
  const config = fixtureConfig();
  config.site.reference_sets = {
    footnotes: {
      label: "Footnotes",
      collections: ["pages"],
      scope: "document",
      order: "first_occurrence",
      deduplicate: true,
      number_style: "lower-roman",
      item_template:
        "{{ number }}. {{record.properties.title}} ({{collection}}/{{ref}})",
      link_field: "record.properties.website",
      backlinks: "all"
    }
  };
  config.node_types.page.fields.body = {
    widget: "markdown",
    blocknote: {
      inline_reference: {
        collection: "pages",
        reference_set: "footnotes"
      }
    }
  };

  assert.deepEqual(validateConfig(config).site.reference_sets, {
    footnotes: config.site.reference_sets.footnotes
  });

  const concise = structuredClone(config);
  for (const key of [
    "label",
    "scope",
    "order",
    "deduplicate",
    "number_style",
    "link_field",
    "backlinks"
  ]) {
    delete concise.site.reference_sets.footnotes[key];
  }
  assert.deepEqual(validateConfig(concise).site.reference_sets.footnotes, {
    collections: ["pages"],
    item_template:
      "{{ number }}. {{record.properties.title}} ({{collection}}/{{ref}})"
  });

  for (const [change, expected] of [
    [(set) => { set.collections = []; }, /at least one collection/],
    [(set) => { set.collections = ["missing"]; }, /unknown collection "missing"/],
    [(set) => { set.collections = ["pages", "pages"]; }, /repeats collection/],
    [(set) => { set.scope = "site"; }, /scope must be "document"/],
    [(set) => { set.order = "alphabetical"; }, /order must be "first_occurrence"/],
    [(set) => { set.deduplicate = "yes"; }, /deduplicate must be boolean/],
    [(set) => { set.number_style = "ordinal"; }, /number_style must be one of/],
    [(set) => { set.item_template = "{{record.properties}}"; }, /item_template may use only/],
    [(set) => { set.item_template = "{{Record.id}}"; }, /item_template may use only/],
    [(set) => { set.item_template = "{{{record.id}}}"; }, /item_template may use only/],
    [(set) => { set.item_template = "{{#each record}}x{{/each}}"; }, /item_template may use only/],
    [(set) => { set.item_template = "Source {"; }, /item_template may use only/],
    [(set) => { set.link_field = "record.id"; }, /link_field must use record\.properties/],
    [(set) => { set.backlinks = "last"; }, /backlinks must be one of/]
  ]) {
    const invalid = structuredClone(config);
    change(invalid.site.reference_sets.footnotes);
    assert.throws(() => validateConfig(invalid, 400), expected);
  }

  const unknownSet = structuredClone(config);
  unknownSet.node_types.page.fields.body.blocknote.inline_reference.reference_set =
    "citations";
  assert.throws(
    () => validateConfig(unknownSet, 400),
    /uses unknown reference set "citations"/
  );

  const incompatibleSet = structuredClone(config);
  incompatibleSet.collections.sources = {
    folder: "content/sources",
    node_type: "page"
  };
  incompatibleSet.site.reference_sets.footnotes.collections = ["sources"];
  assert.throws(
    () => validateConfig(incompatibleSet, 400),
    /collection "pages" is not included in reference set "footnotes"/
  );
});

test("validates URL fields and tag collection relations", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.website = {
    widget: "url",
    default: "https://example.com/archive"
  };
  config.node_types.page.fields.tags = {
    widget: "tags",
    collection: "tags"
  };
  config.node_types.tag = {
    fields: {
      content_id: { widget: "id" },
      name: { widget: "string" }
    }
  };
  config.collections.tags = {
    folder: "content/tags",
    extension: "yml",
    node_type: "tag",
    allowed_types: ["tag"],
    views: {
      reference: {
        value: "content_id",
        title: "name"
      }
    }
  };

  const validated = validateConfig(config);
  assert.equal(validated.node_types.page.fields.website.widget, "url");
  assert.equal(validated.node_types.page.fields.tags.collection, "tags");

  const missingCollection = structuredClone(config);
  missingCollection.node_types.page.fields.tags.collection = "missing";
  assert.throws(
    () => validateConfig(missingCollection, 400),
    /tags field "tags" uses unknown collection "missing"/
  );

  const invalidIdentity = structuredClone(config);
  invalidIdentity.node_types.tag.fields.content_id.widget = "string";
  assert.throws(
    () => validateConfig(invalidIdentity, 400),
    /tags value field "content_id" must use the id widget/
  );

  const recordIdentity = structuredClone(config);
  recordIdentity.node_types.tag.fields.id = { widget: "id" };
  recordIdentity.collections.tags.views.reference.value = "id";
  assert.throws(
    () => validateConfig(recordIdentity, 400),
    /not its record ID/
  );

  const referenceOnlyOption = structuredClone(config);
  referenceOnlyOption.node_types.page.fields.tags.allowed_types = ["tag"];
  assert.throws(
    () => validateConfig(referenceOnlyOption, 400),
    /only its collection relation/
  );

  const missingTitle = structuredClone(config);
  delete missingTitle.collections.tags.views.reference.title;
  assert.throws(
    () => validateConfig(missingTitle, 400),
    /must publish a reference title field for tags/
  );

  const invalidDefault = structuredClone(config);
  invalidDefault.node_types.page.fields.tags.default = "aaaaaaaaaaaaaaa";
  assert.throws(
    () => validateConfig(invalidDefault, 400),
    /cannot define a default/
  );

  for (const defaultValue of ["/archive", "javascript:alert(1)"]) {
    const invalidUrlDefault = structuredClone(config);
    invalidUrlDefault.node_types.page.fields.website.default = defaultValue;
    assert.throws(
      () => validateConfig(invalidUrlDefault, 400),
      /default must be an absolute HTTP or HTTPS URL/
    );
  }

  const invalidDefaultTagType = structuredClone(config);
  invalidDefaultTagType.node_types.alternate_tag = structuredClone(
    invalidDefaultTagType.node_types.tag
  );
  invalidDefaultTagType.collections.tags.allowed_types = ["alternate_tag"];
  assert.throws(
    () => validateConfig(invalidDefaultTagType, 400),
    /must allow its node type "tag"/
  );
});

test("validates slug widget template configuration", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.subtitle = { widget: "string" };
  config.node_types.page.fields.slug = {
    widget: "slug",
    template: "{{title}}-{{subtitle}}"
  };
  assert.equal(
    validateConfig(config).node_types.page.fields.slug.template,
    "{{title}}-{{subtitle}}"
  );

  const missingTemplate = structuredClone(config);
  delete missingTemplate.node_types.page.fields.slug.template;
  assert.throws(
    () => validateConfig(missingTemplate, 400),
    /must define a valid template/
  );

  const malformedTemplate = structuredClone(config);
  malformedTemplate.node_types.page.fields.slug.template = "{{title";
  assert.throws(
    () => validateConfig(malformedTemplate, 400),
    /must define a valid template/
  );

  const unknownSource = structuredClone(config);
  unknownSource.node_types.page.fields.slug.template = "{{missing}}";
  assert.throws(
    () => validateConfig(unknownSource, 400),
    /incompatible source field "missing"/
  );

  const foreignSources = structuredClone(config);
  foreignSources.node_types.page.fields.title.sources = ["subtitle"];
  assert.throws(
    () => validateConfig(foreignSources, 400),
    /sources is not supported/
  );

  const foreignTemplate = structuredClone(config);
  foreignTemplate.node_types.page.fields.title.template = "{{subtitle}}";
  assert.throws(
    () => validateConfig(foreignTemplate, 400),
    /may define a template only for a slug widget/
  );
});

test("requires persisted URL values to be empty or use HTTP(S)", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.website = { widget: "url" };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: { title: "Home", website: "https://example.com/research" },
    slots: {}
  };

  assert.equal(validateRecord(record, collection, config), record);
  assert.equal(
    validateRecord(
      { ...record, properties: { ...record.properties, website: "" } },
      collection,
      config
    ).properties.website,
    ""
  );

  for (const website of [
    "example.com",
    "/research",
    "javascript:alert(1)",
    "data:text/plain,unsafe",
    42
  ]) {
    assert.throws(
      () =>
        validateRecord(
          { ...record, properties: { ...record.properties, website } },
          collection,
          config
        ),
      /must be empty or contain an absolute HTTP or HTTPS URL/
    );
  }
});

test("requires persisted slug values to use lowercase URL slug characters", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.slug = {
    widget: "slug",
    template: "{{title}}"
  };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: { title: "Home", slug: "research-2026" },
    slots: {}
  };

  assert.equal(validateRecord(record, collection, config), record);
  for (const slug of ["", "Research", "research_page", "research--page", 42]) {
    if (slug === "") {
      assert.equal(
        validateRecord(
          { ...record, properties: { ...record.properties, slug } },
          collection,
          config
        ).properties.slug,
        ""
      );
      continue;
    }
    assert.throws(
      () => validateRecord(
        { ...record, properties: { ...record.properties, slug } },
        collection,
        config
      ),
      /must be empty or contain lowercase letters and numbers/
    );
  }
});

test("requires canonical persisted image assets and rejects legacy source keys", () => {
  const hash = "a".repeat(64);
  const config = fixtureConfig();
  config.node_types.page.fields.image = { widget: "image" };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: {
      title: "Home",
      image: {
        hash,
        filename: "Grüße.png",
        width: 1200,
        height: 800,
        regions: []
      }
    },
    slots: {}
  };
  assert.equal(validateRecord(record, collection, config), record);
  assert.equal(
    validateRecord(
      { ...record, properties: { ...record.properties, image: "" } },
      collection,
      config
    ).properties.image,
    ""
  );

  for (const image of [
    "/media/legacy.png",
    { src: "/media/legacy.png" },
    { hash, filename: "Gru\u0308ße.png" },
    { hash, filename: "image.png", src: "/resolved.png" },
    { hash, filename: "image.png", path: "/legacy.png" },
    { hash, filename: "image.png", sha: hash }
  ]) {
    assert.throws(
      () => validateRecord(
        { ...record, properties: { ...record.properties, image } },
        collection,
        config
      ),
      /hash and original filename/
    );
  }
});

test("requires persisted tag values to be unique generated-ID arrays", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.tags = {
    widget: "tags",
    collection: "tags"
  };
  config.node_types.tag = {
    fields: {
      content_id: { widget: "id" },
      name: { widget: "string" }
    }
  };
  config.collections.tags = {
    folder: "content/tags",
    extension: "yml",
    node_type: "tag",
    views: {
      reference: { value: "content_id", title: "name" }
    }
  };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: { tags: ["aaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbb"] },
    slots: {}
  };

  assert.equal(validateRecord(record, collection, config), record);
  for (const tags of [
    "aaaaaaaaaaaaaaa",
    ["short"],
    ["aaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaa"]
  ]) {
    assert.throws(
      () =>
        validateRecord(
          { ...record, properties: { tags } },
          collection,
          config
        ),
      /array of unique generated IDs/
    );
  }
});

test("requires persisted multiple references to be unique scalar arrays", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.authors = {
    widget: "reference",
    collection: "pages",
    multiple: true
  };
  validateConfig(config);
  const collection = { name: "pages", ...config.collections.pages };
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: {
      authors: ["first", 0, false, "0"]
    },
    slots: {}
  };

  assert.equal(validateRecord(record, collection, config), record);
  assert.equal(
    validateRecord(
      { ...record, properties: { authors: [] } },
      collection,
      config
    ).properties.authors.length,
    0
  );

  for (const authors of [
    "first",
    [""],
    [null],
    [{ ref: "first" }],
    ["first", "first"],
    [false, false]
  ]) {
    assert.throws(
      () =>
        validateRecord(
          { ...record, properties: { authors } },
          collection,
          config
        ),
      /array of unique non-empty scalar values/
    );
  }
});

test("validates conditional fields and type-restricted references", () => {
  const config = fixtureConfig();
  config.node_types.shortcut = {
    fields: {
      title: { widget: "string" },
      mode: {
        widget: "select",
        options: ["first_child", "selected_target"]
      },
      target: {
        widget: "reference",
        collection: "pages",
        allowed_types: ["page"],
        visible_when: { field: "mode", equals: "selected_target" }
      }
    }
  };
  config.collections.pages.allowed_types.push("shortcut");

  assert.equal(
    validateConfig(config).node_types.shortcut.fields.target.visible_when.equals,
    "selected_target"
  );

  const invalidCondition = structuredClone(config);
  invalidCondition.node_types.shortcut.fields.target.visible_when.field =
    "missing";
  assert.throws(
    () => validateConfig(invalidCondition, 400),
    /unknown controlling field/
  );

  const invalidTargetType = structuredClone(config);
  invalidTargetType.node_types.shortcut.fields.target.allowed_types = [
    "article"
  ];
  assert.throws(
    () => validateConfig(invalidTargetType, 400),
    /outside its target collection/
  );
});

test("validates target-published reference selections", () => {
  const config = fixtureConfig();
  config.node_types.image = {
    fields: {
      uuid: { widget: "uuid" },
      file: { widget: "image" }
    }
  };
  config.collections.images = {
    folder: "content/images",
    extension: "yml",
    node_type: "image",
    views: {
      reference: {
        value: "uuid",
        image: "file",
        selections: {
          crop: {
            label: "Crop region",
            kind: "image_region",
            options: {
              field: "file",
              path: "regions",
              value: "id",
              label: "label"
            }
          },
          focus: {
            label: "Focus point",
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
  };
  config.node_types.page.fields.hero = {
    widget: "reference",
    collection: "images",
    selections: ["crop", "focus"]
  };

  assert.deepEqual(
    validateConfig(config).node_types.page.fields.hero.selections,
    ["crop", "focus"]
  );

  const unknownSelection = structuredClone(config);
  unknownSelection.node_types.page.fields.hero.selections.push("missing");
  assert.throws(
    () => validateConfig(unknownSelection, 400),
    /unknown selection "missing"/
  );

  const invalidSource = structuredClone(config);
  invalidSource.collections.images.views.reference.selections.crop.options.field =
    "uuid";
  assert.throws(
    () => validateConfig(invalidSource, 400),
    /must use an image field/
  );

  const invalidKind = structuredClone(config);
  invalidKind.collections.images.views.reference.selections.crop.kind =
    "rectangle";
  assert.throws(
    () => validateConfig(invalidKind, 400),
    /unsupported kind "rectangle"/
  );

  const labelValue = structuredClone(config);
  labelValue.collections.images.views.reference.selections.crop.options.value =
    "label";
  assert.throws(
    () => validateConfig(labelValue, 400),
    /must use annotation IDs/
  );

  const mixedSources = structuredClone(config);
  mixedSources.node_types.image.fields.alternate = { widget: "image" };
  mixedSources.collections.images.views.reference.selections.focus.options.field =
    "alternate";
  assert.throws(
    () => validateConfig(mixedSources, 400),
    /must use the same source field/
  );
});

test("summarizes records consistently across storage adapters", () => {
  const summary = summarizeRecord(
    {
      id: "home",
      type: "page",
      order: 2,
      properties: {
        title: "Home",
        hidden: true
      }
    },
    {
      created_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-31T11:00:00Z"
    },
    { name: "pages" }
  );
  assert.equal(summary.title, "Home");
  assert.equal(summary.hidden, true);
  assert.equal(summary.order, 2);
  assert.equal(summary.updated_at, "2026-07-31T11:00:00.000Z");
});

test("uses reference presentation for collection summary titles", () => {
  const summary = summarizeRecord(
    {
      id: "research-2026-08",
      type: "tag",
      order: 0,
      properties: { content_id: "aaaaaaaaaaaaaaa", name: "Research" }
    },
    {},
    { name: "tags", views: { reference: { title: "name" } } }
  );

  assert.equal(summary.title, "Research");
});
