import type { ImageProcessingConfig } from "../core/image-service.js";
export { prependImageServiceOperations } from "../core/image-service.js";
export type { ImageOperation } from "../core/image-service.js";
export {
  INLINE_REFERENCE_PREFIX,
  buildInlineReferenceUrl,
  isAllowedMarkdownLink,
  isInlineReferenceUrl,
  parseInlineReferenceUrl
} from "../core/inline-reference.js";
export type { InlineReference } from "../core/inline-reference.js";

export type UnknownMapping = Record<string, unknown>;
export type ReferenceScalar = string | number | boolean;

export interface CmsConnector extends UnknownMapping {
  name: "api" | "github";
  api_url?: string;
  auth_url?: string;
}

export interface ContentNode {
  id: string;
  type: string;
  order?: number;
  properties: UnknownMapping;
  slots: Record<string, ContentNode[]>;
  [key: string]: unknown;
}

export interface ContentRecord extends ContentNode {
  order: number;
}

export interface ResolvedSelection<T = unknown> {
  ref: unknown;
  value: T | null;
}

export interface ResolvedReference<T extends ContentRecord = ContentRecord> {
  ref: ReferenceScalar;
  record: T | null;
  selections: Record<string, ResolvedSelection>;
}

export interface ResolvedMarkdownReference<
  T extends ContentRecord = ContentRecord
> {
  collection: string;
  ref: string;
  record: T | null;
}

export interface ResolvedMarkdown<T extends ContentRecord = ContentRecord> {
  markdown: string;
  references: Record<string, ResolvedMarkdownReference<T>>;
}

export type ResolvedTags<T extends ContentRecord = ContentRecord> =
  ResolvedReference<T>[];

export interface CmsConfig extends UnknownMapping {
  connectors: Record<string, CmsConnector> & {
    default: CmsConnector;
    development?: CmsConnector;
  };
  site?: {
    name?: string;
    locale?: string;
    media_folder?: string;
    public_folder?: string;
    image_processing?: ImageProcessingConfig;
    [key: string]: unknown;
  };
  collections: Record<string, UnknownMapping>;
  node_types: Record<string, UnknownMapping>;
}

export interface CmsCollection extends UnknownMapping {
  name: string;
}

export interface ContentData<T extends ContentRecord = ContentRecord> {
  config: CmsConfig;
  collection: CmsCollection;
  item: T;
}

export interface ContentListData<T extends ContentRecord = ContentRecord> {
  config: CmsConfig;
  collection: CmsCollection;
  items: T[];
}

export type MaybePromise<T> = T | Promise<T>;

export interface MediaResolutionContext {
  collection: string;
}

export type ContentSourceListResult =
  | ContentRecord[]
  | { items: UnknownMapping[]; [key: string]: unknown };

export type ContentSourceRecordResult =
  | ContentRecord
  | { item?: ContentRecord | null; record?: ContentRecord | null }
  | null;

export interface ContentSource {
  list(collection: string): MaybePromise<ContentSourceListResult>;
  get?: (
    collection: string,
    id: string
  ) => MaybePromise<ContentSourceRecordResult>;
  record?: (
    collection: string,
    id: string
  ) => MaybePromise<ContentSourceRecordResult>;
  resolveMediaUrl?: (
    value: string,
    context: MediaResolutionContext
  ) => MaybePromise<string>;
  resolveImageUrl?: (
    value: string,
    context: MediaResolutionContext
  ) => MaybePromise<string>;
}

export interface ContentAdapterOptions {
  config: CmsConfig;
  source?: ContentSource;
  listRaw?: (collection: string) => MaybePromise<ContentSourceListResult>;
  getRaw?: (
    collection: string,
    id: string
  ) => MaybePromise<ContentSourceRecordResult>;
  resolveMediaUrl?: (
    value: string,
    context: MediaResolutionContext
  ) => MaybePromise<string>;
  resolveImageUrl?: (
    value: string,
    context: MediaResolutionContext
  ) => MaybePromise<string>;
}

export interface ContentAdapter {
  config(): CmsConfig;
  get(
    collection: string,
    idOrRecord: string | ContentRecord
  ): Promise<ContentData | null>;
  list(collection: string): Promise<ContentListData>;
}

export function createContentAdapter(
  options: ContentAdapterOptions
): ContentAdapter;
