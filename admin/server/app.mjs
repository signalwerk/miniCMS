import express from "express";
import yaml from "js-yaml";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { sanitizeFilenameStem } from "../shared/slug.js";

const packageAdminDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const YAML_OPTIONS = {
  schema: yaml.JSON_SCHEMA
};

const DUMP_OPTIONS = {
  noRefs: true,
  lineWidth: 100,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false
};

const SYSTEM_FIELDS = new Set([
  "$id",
  "$filename",
  "$storage_path",
  "$updated_at",
  "$created_at"
]);
const FIELD_MODES = new Set(["read", "edit"]);
const FIELD_DISPLAYS = new Set([
  "text",
  "date",
  "datetime",
  "toggle",
  "select",
  "badge",
  "code",
  "image"
]);
const FIELD_APPEARANCES = new Set(["title", "muted", "monospace"]);
const FIELD_ALIGNMENTS = new Set(["left", "center", "right"]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw httpError(400, `Invalid ${label}.`);
  }
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateFieldReference(reference, fields, context) {
  const configuration =
    typeof reference === "string" ? { field: reference } : reference;
  if (!isMapping(configuration) || typeof configuration.field !== "string") {
    throw httpError(500, `${context} must contain field references.`);
  }
  if (
    !SYSTEM_FIELDS.has(configuration.field) &&
    !fields[configuration.field]
  ) {
    throw httpError(
      500,
      `${context} references unknown field "${configuration.field}".`
    );
  }
  if (
    configuration.mode !== undefined &&
    !FIELD_MODES.has(configuration.mode)
  ) {
    throw httpError(
      500,
      `${context} uses unsupported mode "${configuration.mode}".`
    );
  }
  if (
    configuration.display !== undefined &&
    !FIELD_DISPLAYS.has(configuration.display)
  ) {
    throw httpError(
      500,
      `${context} uses unsupported display "${configuration.display}".`
    );
  }
  if (
    configuration.appearance !== undefined &&
    !FIELD_APPEARANCES.has(configuration.appearance)
  ) {
    throw httpError(
      500,
      `${context} uses unsupported appearance "${configuration.appearance}".`
    );
  }
  if (
    configuration.align !== undefined &&
    !FIELD_ALIGNMENTS.has(configuration.align)
  ) {
    throw httpError(
      500,
      `${context} uses unsupported alignment "${configuration.align}".`
    );
  }
}

async function readYaml(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  return yaml.load(source, YAML_OPTIONS);
}

async function writeYamlAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const output = `${yaml.dump(value, DUMP_OPTIONS).trimEnd()}\n`;
  await fs.writeFile(temporaryFile, output, "utf8");
  await fs.rename(temporaryFile, filePath);
}

function collectNodes(record, visit) {
  const walk = (node) => {
    visit(node);
    for (const children of Object.values(node?.slots ?? {})) {
      if (Array.isArray(children)) children.forEach(walk);
    }
  };
  walk(record);
}

function validateRecord(record, collection, config) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw httpError(400, "The request body must be a complete record object.");
  }
  assertSafeName(record.id, "record id");

  const allowedRootTypes = collection.allowed_types ?? [collection.node_type];
  if (!allowedRootTypes.includes(record.type)) {
    throw httpError(
      400,
      `Record type "${record.type ?? ""}" is not allowed in collection "${collection.name}".`
    );
  }

  const seenIds = new Set();
  collectNodes(record, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw httpError(400, "Every content node must be an object.");
    }
    assertSafeName(node.id, "node id");
    if (!config.node_types?.[node.type]) {
      throw httpError(400, `Unknown node type "${node.type ?? ""}".`);
    }
    if (seenIds.has(node.id)) {
      throw httpError(400, `Node id "${node.id}" occurs more than once.`);
    }
    seenIds.add(node.id);

    for (const [slotName, children] of Object.entries(node.slots ?? {})) {
      const slot = config.node_types[node.type]?.slots?.[slotName];
      if (!slot) throw httpError(400, `Type "${node.type}" has no slot "${slotName}".`);
      if (!Array.isArray(children)) throw httpError(400, `Slot "${slotName}" must be an array.`);
      if (slot.max && children.length > slot.max) {
        throw httpError(400, `Slot "${slotName}" accepts at most ${slot.max} items.`);
      }
      for (const child of children) {
        if (!slot.allowed_types?.includes(child.type)) {
          throw httpError(
            400,
            `Type "${child.type}" is not allowed in ${node.type}.${slotName}.`
          );
        }
      }
    }
  });
}

function hierarchyValue(record, collection, fieldName, fallback) {
  const configuredField = collection.hierarchy?.[fieldName];
  if (!configuredField) return fallback;
  return record.properties?.[configuredField] ?? record[configuredField] ?? fallback;
}

function summarize(record, stat, collection) {
  const hierarchyId = hierarchyValue(record, collection, "id_field", record.id);
  const parent = hierarchyValue(record, collection, "parent_field", record.parent ?? null);
  return {
    id: record.id,
    hierarchy_id: hierarchyId,
    type: record.type,
    parent,
    order: Number.isFinite(record.order) ? record.order : 0,
    title: record.properties?.title || record.id,
    hidden: Boolean(record.properties?.hidden),
    properties: record.properties ?? {},
    created_at: stat.birthtime.toISOString(),
    updated_at: stat.mtime.toISOString()
  };
}

export function createApp({
  rootDir,
  configFile = path.join(rootDir, "cms.config.yml"),
  serveAdmin = false,
  adminDist = path.join(packageAdminDirectory, "dist")
}) {
  const app = express();
  const contentRoot = path.resolve(rootDir, "content");

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  let cachedConfig = null;
  let cachedConfigMtime = 0;

  async function getConfig() {
    let stat;
    try {
      stat = await fs.stat(configFile);
    } catch (error) {
      if (error.code === "ENOENT") throw httpError(500, "cms.config.yml was not found.");
      throw error;
    }
    if (!cachedConfig || cachedConfigMtime !== stat.mtimeMs) {
      const config = await readYaml(configFile);
      if (!isMapping(config?.collections)) {
        throw httpError(500, "cms.config.yml must define collections as a mapping.");
      }
      if (!isMapping(config?.node_types)) {
        throw httpError(500, "cms.config.yml must define node_types as a mapping.");
      }
      for (const [typeName, type] of Object.entries(config.node_types)) {
        if (!isMapping(type?.fields)) {
          throw httpError(
            500,
            `Node type "${typeName}" must define fields as a mapping.`
          );
        }
        for (const [panelName, panel] of Object.entries(
          type.views?.detail?.panels ?? {}
        )) {
          if (!isMapping(panel?.groups)) {
            throw httpError(
              500,
              `Node type "${typeName}" detail panel "${panelName}" must define groups as a mapping.`
            );
          }
          for (const [groupName, group] of Object.entries(panel.groups)) {
            if (!Array.isArray(group?.fields)) {
              throw httpError(
                500,
                `Node type "${typeName}" detail group "${groupName}" must define a fields array.`
              );
            }
            for (const reference of group.fields) {
              validateFieldReference(
                reference,
                type.fields,
                `Node type "${typeName}" detail group "${groupName}"`
              );
            }
          }
        }
      }
      for (const [collectionName, collection] of Object.entries(
        config.collections
      )) {
        if (
          collection.slug !== undefined &&
          (typeof collection.slug !== "string" || !collection.slug.trim())
        ) {
          throw httpError(
            500,
            `Collection "${collectionName}" must define slug as a non-empty template string.`
          );
        }
        if (!config.node_types[collection.node_type]) {
          throw httpError(
            500,
            `Collection "${collectionName}" references unknown node type "${collection.node_type}".`
          );
        }
        const list = collection.views?.list;
        if (list?.type && !["tree", "table"].includes(list.type)) {
          throw httpError(
            500,
            `Collection "${collectionName}" uses unsupported list type "${list.type}".`
          );
        }
        const rootFields = config.node_types[collection.node_type].fields;
        if (list?.columns !== undefined && !Array.isArray(list.columns)) {
          throw httpError(
            500,
            `Collection "${collectionName}" list columns must be an array.`
          );
        }
        for (const reference of list?.columns ?? []) {
          validateFieldReference(
            reference,
            rootFields,
            `Collection "${collectionName}" list columns`
          );
        }
        for (const reference of list?.search?.fields ?? []) {
          validateFieldReference(
            reference,
            rootFields,
            `Collection "${collectionName}" search fields`
          );
        }
        if (list?.sort?.field) {
          validateFieldReference(
            list.sort.field,
            rootFields,
            `Collection "${collectionName}" list sort`
          );
        }
        const referenceView = collection.views?.reference;
        if (referenceView) {
          for (const [name, reference] of [
            ["value", referenceView.value],
            ["image", referenceView.image],
            ["title", referenceView.title],
            ...(
              Array.isArray(referenceView.description)
                ? referenceView.description
                : referenceView.description
                  ? [referenceView.description]
                  : []
            ).map((reference) => ["description", reference])
          ]) {
            if (!reference) continue;
            validateFieldReference(
              reference,
              rootFields,
              `Collection "${collectionName}" reference ${name}`
            );
          }
        }
      }
      for (const [typeName, type] of Object.entries(config.node_types)) {
        for (const [fieldName, field] of Object.entries(type.fields)) {
          if (field.widget !== "reference") continue;
          if (!config.collections[field.collection]) {
            throw httpError(
              500,
              `Node type "${typeName}" reference field "${fieldName}" uses unknown collection "${field.collection}".`
            );
          }
          if (field.value_field) {
            const targetCollection = config.collections[field.collection];
            validateFieldReference(
              field.value_field,
              config.node_types[targetCollection.node_type].fields,
              `Node type "${typeName}" reference field "${fieldName}"`
            );
          }
        }
      }
      cachedConfig = config;
      cachedConfigMtime = stat.mtimeMs;
    }
    return cachedConfig;
  }

  async function getCollection(name) {
    assertSafeName(name, "collection name");
    const config = await getConfig();
    const configuredCollection = config.collections[name];
    if (!configuredCollection) {
      throw httpError(404, `Collection "${name}" does not exist.`);
    }
    const collection = { name, ...configuredCollection };

    const folder = path.resolve(rootDir, collection.folder);
    if (!isInside(contentRoot, folder)) {
      throw httpError(500, `Collection "${name}" must use a folder inside content/.`);
    }
    return { config, collection, folder };
  }

  function recordPath(folder, collection, id) {
    assertSafeName(id, "record id");
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    if (!["yml", "yaml"].includes(extension)) {
      throw httpError(500, `Unsupported extension "${extension}".`);
    }
    return path.join(folder, `${id}.${extension}`);
  }

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/config", async (_request, response, next) => {
    try {
      response.json(await getConfig());
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/media",
    express.raw({
      type: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/avif",
        "application/octet-stream"
      ],
      limit: "20mb"
    }),
    async (request, response, next) => {
      try {
        const config = await getConfig();
        const originalName = String(request.query.filename || "");
        const extension = path.extname(originalName).toLowerCase();
        const allowedExtensions = new Set([
          ".jpg",
          ".jpeg",
          ".png",
          ".gif",
          ".webp",
          ".avif"
        ]);
        if (!allowedExtensions.has(extension)) {
          throw httpError(
            400,
            "Images must use jpg, jpeg, png, gif, webp, or avif."
          );
        }
        if (!Buffer.isBuffer(request.body) || !request.body.length) {
          throw httpError(400, "The uploaded image is empty.");
        }

        const mediaFolder = path.resolve(
          rootDir,
          config.site?.media_folder || "content/media"
        );
        if (!isInside(contentRoot, mediaFolder)) {
          throw httpError(500, "site.media_folder must be inside content/.");
        }
        await fs.mkdir(mediaFolder, { recursive: true });
        const existingNames = new Set(
          (await fs.readdir(mediaFolder)).map((name) => name.toLowerCase())
        );
        const base = sanitizeFilenameStem(
          path.basename(originalName, extension),
          "image"
        );
        let filename = `${base}${extension}`;
        let suffix = 2;
        while (existingNames.has(filename.toLowerCase())) {
          filename = `${base}-${suffix}${extension}`;
          suffix += 1;
        }
        while (true) {
          try {
            await fs.writeFile(path.join(mediaFolder, filename), request.body, {
              flag: "wx"
            });
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            existingNames.add(filename.toLowerCase());
            filename = `${base}-${suffix}${extension}`;
            suffix += 1;
            while (existingNames.has(filename.toLowerCase())) {
              filename = `${base}-${suffix}${extension}`;
              suffix += 1;
            }
          }
        }

        const publicFolder = String(
          config.site?.public_folder || "/media"
        ).replace(/\/$/, "");
        response.status(201).json({
          filename,
          path: `${publicFolder}/${filename}`,
          storage_path: `${String(
            config.site?.media_folder || "content/media"
          ).replace(/\/$/, "")}/${filename}`
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/collections", async (_request, response, next) => {
    try {
      const config = await getConfig();
      response.json({
        collections: Object.fromEntries(
          Object.entries(config.collections).map(
            ([
              name,
              {
                label,
                label_singular,
                icon,
                node_type,
                hierarchy,
                views,
                slug,
                identifier_field
              }
            ]) => [
              name,
              {
                label,
                label_singular,
                icon,
                node_type,
                hierarchy,
                views,
                slug,
                identifier_field
              }
            ]
          )
        )
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections/:collectionName", async (request, response, next) => {
    try {
      const { collection, folder } = await getCollection(request.params.collectionName);
      await fs.mkdir(folder, { recursive: true });
      const entries = await fs.readdir(folder, { withFileTypes: true });
      const extensions = new Set([".yml", ".yaml"]);
      const files = entries.filter(
        (entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())
      );

      const items = await Promise.all(
        files.map(async (entry) => {
          const filePath = path.join(folder, entry.name);
          const [record, stat] = await Promise.all([readYaml(filePath), fs.stat(filePath)]);
          return summarize(record, stat, collection);
        })
      );
      items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      response.json({ collection: collection.name, items });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/collections/:collectionName/:recordId",
    async (request, response, next) => {
      try {
        const { collection, folder } = await getCollection(request.params.collectionName);
        const filePath = recordPath(folder, collection, request.params.recordId);
        response.json(await readYaml(filePath));
      } catch (error) {
        if (error.code === "ENOENT") {
          next(httpError(404, `Record "${request.params.recordId}" does not exist.`));
        } else {
          next(error);
        }
      }
    }
  );

  app.put(
    "/api/collections/:collectionName/:recordId",
    async (request, response, next) => {
      try {
        const { config, collection, folder } = await getCollection(
          request.params.collectionName
        );
        if (request.body?.id !== request.params.recordId) {
          throw httpError(400, "The record id must match the URL.");
        }
        validateRecord(request.body, collection, config);
        const filePath = recordPath(folder, collection, request.params.recordId);
        await writeYamlAtomic(filePath, request.body);
        const stat = await fs.stat(filePath);
        response.json({ saved: true, item: summarize(request.body, stat, collection) });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/collections/:collectionName/:recordId/rename",
    async (request, response, next) => {
      try {
        const { config, collection, folder } = await getCollection(
          request.params.collectionName
        );
        const oldId = request.params.recordId;
        const newId = request.body?.id;
        assertSafeName(newId, "record id");
        if (newId === oldId) {
          throw httpError(400, "The new record id must be different.");
        }

        const oldPath = recordPath(folder, collection, oldId);
        const newPath = recordPath(folder, collection, newId);
        let record;
        try {
          record = await readYaml(oldPath);
        } catch (error) {
          if (error.code === "ENOENT") {
            throw httpError(404, `Record "${oldId}" does not exist.`);
          }
          throw error;
        }
        try {
          await fs.access(newPath);
          throw httpError(409, `Record "${newId}" already exists.`);
        } catch (error) {
          if (error.status === 409) throw error;
          if (error.code !== "ENOENT") throw error;
        }

        if (collection.hierarchy?.enabled && !collection.hierarchy?.id_field) {
          const entries = await fs.readdir(folder, { withFileTypes: true });
          const yamlFiles = entries.filter(
            (entry) =>
              entry.isFile() &&
              [".yml", ".yaml"].includes(path.extname(entry.name).toLowerCase())
          );
          for (const entry of yamlFiles) {
            if (path.join(folder, entry.name) === oldPath) continue;
            const candidate = await readYaml(path.join(folder, entry.name));
            const candidateParent = hierarchyValue(
              candidate,
              collection,
              "parent_field",
              candidate?.parent ?? null
            );
            if (candidateParent === oldId) {
              throw httpError(
                409,
                `Record "${oldId}" has child records and its hierarchy uses the filename as its id.`
              );
            }
          }
        }

        const renamedRecord = { ...record, id: newId };
        validateRecord(renamedRecord, collection, config);
        await writeYamlAtomic(newPath, renamedRecord);
        try {
          await fs.unlink(oldPath);
        } catch (error) {
          await fs.unlink(newPath).catch(() => {});
          throw error;
        }
        const stat = await fs.stat(newPath);
        response.json({
          saved: true,
          record: renamedRecord,
          item: summarize(renamedRecord, stat, collection)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.delete(
    "/api/collections/:collectionName/:recordId",
    async (request, response, next) => {
      try {
        const { collection, folder } = await getCollection(request.params.collectionName);
        const filePath = recordPath(folder, collection, request.params.recordId);
        try {
          await fs.access(filePath);
        } catch (error) {
          if (error.code === "ENOENT") {
            throw httpError(404, `Record "${request.params.recordId}" does not exist.`);
          }
          throw error;
        }

        const entries = await fs.readdir(folder, { withFileTypes: true });
        const yamlFiles = entries.filter(
          (entry) =>
            entry.isFile() && [".yml", ".yaml"].includes(path.extname(entry.name).toLowerCase())
        );
        const deletingRecord = await readYaml(filePath);
        const deletingHierarchyId = hierarchyValue(
          deletingRecord,
          collection,
          "id_field",
          deletingRecord.id
        );
        for (const entry of yamlFiles) {
          if (path.join(folder, entry.name) === filePath) continue;
          const candidate = await readYaml(path.join(folder, entry.name));
          const candidateParent = hierarchyValue(
            candidate,
            collection,
            "parent_field",
            candidate?.parent ?? null
          );
          if (candidateParent === deletingHierarchyId) {
            throw httpError(
              409,
              `Record "${request.params.recordId}" still has child records. Move or delete them first.`
            );
          }
        }

        await fs.unlink(filePath);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    }
  );

  app.post("/api/collections/:collectionName", async (request, response, next) => {
    try {
      const { config, collection, folder } = await getCollection(request.params.collectionName);
      validateRecord(request.body, collection, config);
      const filePath = recordPath(folder, collection, request.body.id);
      try {
        await fs.access(filePath);
        throw httpError(409, `Record "${request.body.id}" already exists.`);
      } catch (error) {
        if (error.status === 409) throw error;
        if (error.code !== "ENOENT") throw error;
      }
      await writeYamlAtomic(filePath, request.body);
      const stat = await fs.stat(filePath);
      response
        .status(201)
        .json({ saved: true, item: summarize(request.body, stat, collection) });
    } catch (error) {
      next(error);
    }
  });

  app.use("/media", express.static(path.join(contentRoot, "media")));

  if (serveAdmin) {
    app.use(express.static(adminDist));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
      response.sendFile(path.join(adminDist, "index.html"));
    });
  }

  app.use((error, _request, response, _next) => {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(error);
    response.status(status).json({
      error: status >= 500 ? "Server error" : "Request error",
      message: error.message || "An unexpected error occurred."
    });
  });

  return app;
}
