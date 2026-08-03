import type { ContentAdapter } from "./index.js";

export interface FilesystemContentAdapterOptions {
  projectRoot: string | URL;
  resolveMediaUrl?: (path: string) => string | Promise<string>;
  resolveImageUrl?: (path: string) => string | Promise<string>;
  imageServiceBaseUrl?: string;
  publicBase?: string;
}

export function createFilesystemContentAdapter(
  options: FilesystemContentAdapterOptions
): Promise<ContentAdapter>;
