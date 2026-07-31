import { parseYaml, validateConfig } from "../../shared/content.js";
import { createNodeAdapter } from "./node.js";

function configuredOverride() {
  return typeof __MINICMS_ADAPTER_OVERRIDE__ === "undefined"
    ? ""
    : __MINICMS_ADAPTER_OVERRIDE__;
}

async function loadBootstrapConfig({
  fetchImpl = fetch,
  bootstrapUrl = new URL("./cms.config.yml", document.baseURI)
} = {}) {
  const response = await fetchImpl(bootstrapUrl);
  if (!response.ok) {
    throw new Error(
      `Could not load the miniCMS bootstrap configuration (${response.status}).`
    );
  }
  return validateConfig(parseYaml(await response.text()));
}

async function createAdapter({
  adapterOverride = configuredOverride(),
  fetchImpl = fetch,
  bootstrapConfig,
  bootstrapUrl,
  githubOptions = {}
} = {}) {
  if (adapterOverride === "node") {
    return createNodeAdapter({ fetchImpl });
  }

  const config =
    bootstrapConfig ||
    (await loadBootstrapConfig({ fetchImpl, bootstrapUrl }));
  const backend = config.backend || { name: "node" };
  if ((backend.name || "node") === "node") {
    return createNodeAdapter({
      apiUrl: backend.api_url || "",
      fetchImpl
    });
  }
  if (backend.name === "github") {
    const { createGitHubAdapter } = await import("./github.js");
    return createGitHubAdapter({
      config,
      fetchImpl,
      ...githubOptions
    });
  }
  throw new Error(`Unsupported miniCMS backend "${backend.name}".`);
}

export { createAdapter, loadBootstrapConfig };
