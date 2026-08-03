export type ImageFit = "cover" | "contain" | "fill" | "inside";
export type ImageFormat = "avif" | "gif" | "jpeg" | "jpg" | "png" | "tiff" | "webp";
export type ImageOperationType =
  | "resize"
  | "rotate"
  | "flatten"
  | "crop"
  | "quality"
  | "noop";

export interface ImageCacheConfig {
  schema?: string;
}

export interface ImageProcessingConfig {
  width?: number;
  height?: number;
  fit?: ImageFit;
  format?: ImageFormat;
  quality?: number;
  cache?: ImageCacheConfig;
}

export interface NormalizedImageProcessingConfig {
  readonly width: number;
  readonly height: number;
  readonly fit: ImageFit;
  readonly format: Exclude<ImageFormat, "jpg">;
  readonly quality: number;
  readonly cache: Readonly<Required<ImageCacheConfig>>;
}

export interface ImageOperation {
  type: ImageOperationType;
  options?: Record<string, string | number>;
}

export interface ContentAddressedMediaPath {
  readonly collection: string;
  readonly sha: string;
  readonly filename: string;
  readonly path: string;
}

export interface ParsedImageServiceUrl {
  readonly baseUrl: string;
  readonly schema: string;
  readonly collection: string;
  readonly sha: string;
  readonly operations: readonly ImageOperation[];
  readonly filename: string;
  readonly format: ImageFormat | "json" | "svg";
}

export type ImageSource = string | { src: string; [key: string]: unknown };

export interface ImageServiceOptions {
  baseUrl?: string;
  config?:
    | ImageProcessingConfig
    | { image_processing?: ImageProcessingConfig }
    | {
        site?: {
          image_processing?: ImageProcessingConfig;
          media_folder?: string;
          public_folder?: string;
        };
      };
  width?: number | null;
  height?: number | null;
  fit?: ImageFit;
  format?: ImageFormat;
  quality?: number;
  operations?: string | ImageOperation[];
  info?: boolean;
}

export const DEFAULT_IMAGE_PROCESSING: Readonly<NormalizedImageProcessingConfig>;
export const IMAGE_FITS: readonly ImageFit[];
export const IMAGE_FORMATS: readonly Exclude<ImageFormat, "jpg">[];

export function buildImageServiceUrl(
  value: ImageSource,
  options?: ImageServiceOptions
): string;
export function buildImageServiceMediaUrl(
  value: string,
  options?: Pick<ImageServiceOptions, "baseUrl" | "config">
): string;
export function imageServiceMediaPath(
  value: string,
  config?: ImageServiceOptions["config"]
): string;
export function imageServicePath(
  value: ImageSource,
  options?: ImageServiceOptions
): string;
export function parseContentAddressedMediaPath(
  value: string,
  config?: ImageServiceOptions["config"]
): ContentAddressedMediaPath | null;
export function parseImageServiceUrl(
  value: string
): ParsedImageServiceUrl | null;
export function imageServiceSlug(value: ImageSource): string;
export function isExternalImageSource(value: ImageSource): boolean;
export function isSvgImageSource(value: ImageSource): boolean;
export function normalizeHttpOrigin(value: string, label?: string): string;
export function normalizeImageProcessingConfig(
  config?: ImageServiceOptions["config"]
): NormalizedImageProcessingConfig;
export function validateImageProcessingConfig(
  config?: ImageServiceOptions["config"]
): ImageProcessingConfig;
export function parseImageOperations(value: string): ImageOperation[];
export function prependImageServiceOperations(
  value: string,
  operations: ImageOperation[]
): string | null;
export function serializeImageOperations(operations: ImageOperation[]): string;
