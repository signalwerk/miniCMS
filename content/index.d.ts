export type UnknownMapping = Record<string, unknown>;
export type ReferenceScalar = string | number | boolean;

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

export interface CmsConfig extends UnknownMapping {
  site?: {
    name?: string;
    locale?: string;
    media_folder?: string;
    public_folder?: string;
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
  resolveMediaUrl?: (value: string) => MaybePromise<string>;
}

export interface ContentAdapterOptions {
  config: CmsConfig;
  source?: ContentSource;
  listRaw?: (collection: string) => MaybePromise<ContentSourceListResult>;
  getRaw?: (
    collection: string,
    id: string
  ) => MaybePromise<ContentSourceRecordResult>;
  resolveMediaUrl?: (value: string) => MaybePromise<string>;
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
