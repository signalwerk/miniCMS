import { parseYaml, validateConfig } from "../../../core/content.js";
import { createApiAdapter } from "./api.js";

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
  adapterOverride = "",
  fetchImpl = fetch,
  bootstrapConfig,
  bootstrapUrl,
  apiOptions = {},
  githubOptions = {}
} = {}) {
  if (["api", "node"].includes(adapterOverride)) {
    return createApiAdapter({
      fetchImpl,
      ...apiOptions,
      apiUrl: apiOptions.apiUrl || ""
    });
  }

  const config = bootstrapConfig
    ? validateConfig(bootstrapConfig)
    : await loadBootstrapConfig({ fetchImpl, bootstrapUrl });
  const backend = config.backend || { name: "api" };
  if ((backend.name || "api") === "api") {
    return createApiAdapter({
      fetchImpl,
      ...apiOptions,
      apiUrl: apiOptions.apiUrl ?? backend.api_url ?? ""
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
