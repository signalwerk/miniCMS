import { parseYaml, validateSourceConfig } from "../../../core/content.js";
import { createConnectorAdapter } from "./connectors.js";

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
  return validateSourceConfig(parseYaml(await response.text()));
}

async function createAdapter({
  fetchImpl = fetch,
  bootstrapConfig,
  bootstrapUrl,
  environment = "production",
  connectorOptions = {},
  connectorFactory
} = {}) {
  const config = bootstrapConfig
    ? validateSourceConfig(bootstrapConfig)
    : await loadBootstrapConfig({ fetchImpl, bootstrapUrl });
  return createConnectorAdapter({
    sourceConfig: config,
    environment,
    fetchImpl,
    connectorOptions,
    ...(connectorFactory ? { connectorFactory } : {})
  });
}

export { createAdapter, loadBootstrapConfig };
