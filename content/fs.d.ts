import type {
  CmsConfig,
  ContentAdapter,
  ContentSource,
  ImageAsset,
  MediaResolutionContext
} from "./index.js";

export interface FilesystemConnectorSource extends ContentSource {
  config(): CmsConfig | Promise<CmsConfig>;
}

export interface FilesystemConnectorOptions {
  token?: string;
  headers?: Record<string, string>;
}

export interface FilesystemContentAdapterOptions {
  projectRoot: string | URL;
  resolveMediaUrl?: (
    path: string,
    context: MediaResolutionContext
  ) => string | Promise<string>;
  resolveImageUrl?: (
    asset: ImageAsset,
    context: MediaResolutionContext
  ) => string | Promise<string>;
  imageServiceBaseUrl?: string;
  publicBase?: string;
  connectorSources?: Record<string, FilesystemConnectorSource>;
  connectorOptions?: Record<string, FilesystemConnectorOptions>;
  fetchImpl?: typeof fetch;
}

export function createFilesystemContentAdapter(
  options: FilesystemContentAdapterOptions
): Promise<ContentAdapter>;
