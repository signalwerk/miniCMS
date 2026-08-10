export type ConnectorName = "api" | "github";

export interface ApiConnector {
  name: "api";
  api_url?: string;
  auth_url?: string;
  [key: string]: unknown;
}

export interface GitHubConnector {
  name: "github";
  repo: string;
  branch: string;
  base_url: string;
  api_root?: string;
  [key: string]: unknown;
}

export type Connector = ApiConnector | GitHubConnector;

export interface SourceConfig {
  connectors: {
    default: Connector;
    development?: Connector;
    [name: string]: Connector | undefined;
  };
  node_types: Record<string, Record<string, unknown>>;
  collections: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CollectionRoute {
  connector: string;
  remote_collection: string;
}

export interface NodeTypeRoute {
  connector: string;
  remote_type: string;
}

export interface NameRoutes {
  local_to_remote: Record<string, string>;
  remote_to_local: Record<string, string>;
}

export interface ConnectorRoutes {
  collections: NameRoutes;
  node_types: NameRoutes;
}

export interface MaterializedRoutes {
  collections: Record<string, CollectionRoute>;
  node_types: Record<string, NodeTypeRoute>;
  connectors: Record<string, ConnectorRoutes>;
}

export interface MaterializedConfig {
  config: SourceConfig;
  sourceConfig: SourceConfig;
  routes: MaterializedRoutes;
}

export interface PlannedConfigWrites extends MaterializedConfig {
  remoteConfigs: Record<string, SourceConfig>;
  changedConnectors: string[];
  schemaRenames: SchemaRenames;
  sourceChanged: boolean;
}

export interface SchemaRenames {
  node_types: Record<string, string>;
  collections: Record<string, string>;
}

export function validateSourceConfig(
  config: SourceConfig,
  status?: number
): SourceConfig;

export function collapseConfig(
  effectiveConfig: SourceConfig,
  status?: number
): SourceConfig;

export function materializeConfig(options: {
  sourceConfig: SourceConfig;
  remoteConfigs?: Record<string, SourceConfig>;
  status?: number;
}): MaterializedConfig;

export function planConfigWrites(options: {
  effectiveConfig: SourceConfig;
  sourceConfig: SourceConfig;
  ownershipSourceConfig?: SourceConfig;
  remoteConfigs?: Record<string, SourceConfig>;
  schemaRenames?: SchemaRenames;
  status?: number;
}): PlannedConfigWrites;

export function normalizeSchemaRenames(
  schemaRenames: SchemaRenames | undefined,
  currentConfig: SourceConfig,
  nextConfig: SourceConfig,
  status?: number
): SchemaRenames;

export function migrateRecordSchemaKeys<
  T extends Record<string, unknown>
>(
  record: T,
  currentConfig: SourceConfig,
  nextConfig: SourceConfig,
  schemaRenames: SchemaRenames,
  options: { storage: "api" | "github" }
): T;

export function isRemoteCollection(
  value: unknown
): value is { connector: string; remote_collection: string };

export function isRemoteNodeType(
  value: unknown
): value is { connector: string; remote_type: string };

export function translateInlineReferences(
  markdown: string,
  collectionNames: Record<string, string>
): string;

export function translateRecord<T extends Record<string, unknown>>(
  record: T,
  connectorRoute: ConnectorRoutes,
  direction: "local_to_remote" | "remote_to_local"
): T;
