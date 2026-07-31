import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { sanitizeFilenameStem } from "../shared/slug.js";
import {
  configuredImageAccept,
  mediaFileMatchesAccept
} from "../shared/media.js";
import {
  assertSafeName as assertSharedSafeName,
  dumpYaml,
  hierarchyValue,
  parseYaml,
  summarizeRecord,
  validateConfig as validateSharedConfig,
  validateRecord as validateSharedRecord
} from "../shared/content.js";

const packageAdminDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readYaml(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  return parseYaml(source);
}

async function writeYamlAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const output = dumpYaml(value);
  await fs.writeFile(temporaryFile, output, "utf8");
  await fs.rename(temporaryFile, filePath);
}

function summarize(record, stat, collection) {
  return summarizeRecord(
    record,
    { birthtime: stat.birthtime, mtime: stat.mtime },
    collection
  );
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
      validateSharedConfig(config);
      cachedConfig = config;
      cachedConfigMtime = stat.mtimeMs;
    }
    return cachedConfig;
  }

  async function getCollection(name) {
    assertSharedSafeName(name, "collection name");
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
    assertSharedSafeName(id, "record id");
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

  app.put("/api/config", async (request, response, next) => {
    try {
      const config = validateSharedConfig(request.body, 400);
      const mediaFolder = path.resolve(
        rootDir,
        config.site?.media_folder || "content/media"
      );
      if (!isInside(contentRoot, mediaFolder)) {
        throw httpError(400, "site.media_folder must be inside content/.");
      }
      for (const [name, collection] of Object.entries(config.collections)) {
        if (typeof collection.folder !== "string" || !collection.folder) {
          throw httpError(400, `Collection "${name}" must define a folder.`);
        }
        const folder = path.resolve(rootDir, collection.folder);
        if (!isInside(contentRoot, folder)) {
          throw httpError(
            400,
            `Collection "${name}" must use a folder inside content/.`
          );
        }
        const extension = String(collection.extension || "yml").replace(
          /^\./,
          ""
        );
        if (!["yml", "yaml"].includes(extension)) {
          throw httpError(
            400,
            `Collection "${name}" uses unsupported extension "${extension}".`
          );
        }
      }
      await writeYamlAtomic(configFile, config);
      const stat = await fs.stat(configFile);
      cachedConfig = config;
      cachedConfigMtime = stat.mtimeMs;
      response.json({ saved: true, config });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/media",
    express.raw({
      type: "*/*",
      limit: "20mb"
    }),
    async (request, response, next) => {
      try {
        const config = await getConfig();
        const originalName = String(request.query.filename || "");
        const extension = path.extname(originalName).toLowerCase();
        const acceptedTypes = configuredImageAccept(config);
        if (!mediaFileMatchesAccept(
          {
            filename: originalName,
            mimeType: request.headers["content-type"]
          },
          acceptedTypes
        )) {
          throw httpError(
            400,
            `The image must match a configured accepted file type (${acceptedTypes.join(", ")}).`
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
        validateSharedRecord(request.body, collection, config);
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
        assertSharedSafeName(newId, "record id");
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
        validateSharedRecord(renamedRecord, collection, config);
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
      validateSharedRecord(request.body, collection, config);
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
