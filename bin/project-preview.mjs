import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const PROJECT_PREVIEW_MODULE_ID = "virtual:minicms-project-preview";
const RESOLVED_PROJECT_PREVIEW_MODULE_ID = `\0${PROJECT_PREVIEW_MODULE_ID}`;
const PROJECT_PREVIEW_ENTRY_ID = "virtual:minicms-project-preview-entry";

async function resolveProjectPreview(projectRoot) {
  const manifestPath = path.join(projectRoot, "package.json");
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse ${manifestPath}: ${error.message}`);
  }

  if (
    manifest?.minicms !== undefined &&
    (!manifest.minicms ||
      typeof manifest.minicms !== "object" ||
      Array.isArray(manifest.minicms))
  ) {
    throw new Error(`The minicms value in ${manifestPath} must be a mapping.`);
  }
  const specifier = manifest?.minicms?.preview;
  if (specifier === undefined) return null;
  if (typeof specifier !== "string" || !specifier.trim()) {
    throw new Error(
      `The minicms.preview value in ${manifestPath} must be a non-empty module specifier.`
    );
  }

  const normalizedSpecifier = specifier.trim();
  try {
    if (
      normalizedSpecifier.startsWith("./") ||
      normalizedSpecifier.startsWith("../") ||
      path.isAbsolute(normalizedSpecifier)
    ) {
      const candidate = path.resolve(projectRoot, normalizedSpecifier);
      await access(candidate);
      return {
        specifier: normalizedSpecifier,
        importer: manifestPath,
        entryPath: await realpath(candidate)
      };
    }
    return {
      specifier: normalizedSpecifier,
      importer: manifestPath,
      entryPath: null
    };
  } catch (error) {
    throw new Error(
      `Could not resolve miniCMS preview "${normalizedSpecifier}" from ${manifestPath}: ${error.message}`
    );
  }
}

function createProjectPreviewPlugin(configuration) {
  return {
    name: "minicms-project-preview",
    enforce: "pre",
    async resolveId(source) {
      if (source === PROJECT_PREVIEW_MODULE_ID) {
        return RESOLVED_PROJECT_PREVIEW_MODULE_ID;
      }
      if (source === PROJECT_PREVIEW_ENTRY_ID && configuration) {
        if (configuration.entryPath) return configuration.entryPath;
        try {
          const resolved = await this.resolve(
            configuration.specifier,
            configuration.importer,
            { skipSelf: true }
          );
          if (resolved) return resolved;
        } catch (error) {
          this.error(
            `Could not resolve miniCMS preview "${configuration.specifier}" from ${configuration.importer}: ${error.message}`
          );
        }
        this.error(
          `Could not resolve miniCMS preview "${configuration.specifier}" from ${configuration.importer}.`
        );
      }
      return null;
    },
    load(id) {
      if (id !== RESOLVED_PROJECT_PREVIEW_MODULE_ID) return null;
      if (!configuration) {
        return "export default { collections: {}, stylesheet: \"\" };";
      }
      return `import registration from ${JSON.stringify(PROJECT_PREVIEW_ENTRY_ID)};\nexport default registration;`;
    }
  };
}

export {
  PROJECT_PREVIEW_MODULE_ID,
  createProjectPreviewPlugin,
  resolveProjectPreview
};
