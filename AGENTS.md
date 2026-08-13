# AGENTS.md

This is the reusable miniCMS source of truth for coding agents. Keep it concise
and current. Every agent must update `AGENTS.md` whenever meaningful changes
are made, assumptions are clarified, or new project context is discovered.
Preserve useful guidance and remove stale information.

## Architecture

- `admin/src/`: React 19 editor. `App.jsx` is the state/UI orchestrator and
  `model/` contains shared content/layout/view helpers.
- `admin/src/adapters/`: browser persistence boundary. `api.js` consumes the
  independent miniCMS API and discovers whether its session needs GitHub
  authentication through the configured central auth worker; `github.js` reads
  and atomically commits repository files directly. `connectors.js` exposes
  them as one composite adapter, routes
  collection operations through hydrated local aliases, translates remote
  record/type names, and aggregates only the connector sessions the project
  uses. `AdapterContext.jsx` is the only UI access path to that composite.
  The worker token-delivery allowlist may contain exact HTTP origins only for
  loopback development hosts. A standalone local editor can still need that
  authorization when the project imports a production API connector; its
  exact host and port must therefore be configured by the worker.
- `admin/src/components/<Feature>/`: cohesive feature components with a
  colocated `<Feature>.scss`. Keep related small components together instead
  of creating a folder for every button or row.
- `components/ConfigurationEditor/`: handcrafted, human-first Settings
  overlay. Every supported setting is edited through guided forms; technical
  controls are progressively disclosed, but raw configuration source is never
  shown. Do not reintroduce a meta-configuration that describes this editor.
- `admin/src/styles.scss` contains only global foundations;
  `styles/_typography.scss` owns the shared Sass typography placeholders.
- `core/content.js`: browser/Node-compatible YAML, validation, safe
  repository paths, and record summaries. `media.js` owns the canonical image
  asset `{hash, filename}` contract, Unicode-NFC basename validation, upload
  accept-list parsing/matching, storage-path discovery, and browser SHA-256;
  `image-service.js` owns the shared processing config,
  content-addressed media-path parser, readable operation-stack grammar,
  derivative URL builder and canonical URL parser for
  `/<schema>/media/<collection>/<sha256>/<operations>/<filename>.<format>`,
  and the strict content-addressed raw-media URL mapper. It accepts only the
  canonical two-segment GitHub and three-segment API raw forms and has no
  previous-route compatibility parser;
  `slug.js` owns
  filename templates; `inline-reference.js` owns the strict canonical
  `minicms://reference/<collection>/<encoded-value>` URI grammar plus the
  citation-reference scanner; `inline-link.js` owns the separate stable content
  link grammar `minicms://link/<collection>/<encoded-value>`. The shared
  Markdown-safe link predicate accepts both strict schemes, and both
  duplicate-preserving scanners are exported through the public content entry.
  Content resolution uses those scanners so actual-link/code/image parsing has
  one implementation;
  `id.js` owns the opaque
  generated-ID format and collision-aware generator. These helpers are
  exported as `@signalwerk/minicms/core/*` for infrastructure packages and the
  independent API service; miniCMS contains no HTTP server.
- `core/connectors.js` owns the pure multi-connector contract. Source configs
  contain exact remote stubs, while materialized configs retain those source
  keys beside hydrated definitions. `materializeConfig` returns the effective
  config, its normalized collapsible source form, and bidirectional plain-object
  collection/type route maps. `planConfigWrites` reverses edited hydrated
  definitions into concrete owner configs, preserves unrelated remote schema,
  and returns the exact default aliases plus changed connector list.
  `translateRecord` uses one connector route to clone and recursively translate
  node types. Materialized routes also carry the source and destination field
  schemas so only declared Markdown destinations and internal-link URL values
  are translated; identical custom-URI text in ordinary string fields remains
  literal. Schema-key record migrations seed the same field context directly.
  Service, browser, and static adapters must share these helpers instead of
  duplicating remote-stub tests or name translation.
- Consumer renderers may prepend a validated source-space crop to an existing
  canonical raster derivative with `prependImageServiceOperations`. Crop
  coordinates may be decimal or negative, dimensions are decimal values of at
  least one source pixel, and optional `rotation` is clockwise. Crop is always
  first and cannot coexist with whole-image `rotate`. The helper preserves the
  derivative's origin, schema, collection, SHA-256, output filename, resize,
  quality, and format; raw, GitHub, info, noop, and SVG URLs intentionally
  return `null`.
- `content/`: the complete project-facing read contract. `index.js` resolves
  references, configured Markdown inline references and stable content links,
  and media over an
  abstract raw source; `fs.js` loads validated local YAML, materializes remote
  aliases, and routes named collection reads through connector sources for
  static Node builds. Named API sources are created from their configured
  HTTPS origin; other connector kinds require an explicit source. A default
  API connector gets shared service-media defaults, while default GitHub
  storage retains public static URLs unless the website supplies
  `imageServiceBaseUrl`. Supplied resolvers take precedence. Both return the
  same `{config, collection, item}` or `{config, collection, items}` envelopes.
- The editor recreates its browser content adapter after collection summaries
  change so reference-target caches cannot outlive an editor-owned write.
  Unsaved source-record drafts remain safe to resolve repeatedly.
- `admin/vite.config.js`: editor development configuration and the standalone
  browser build. Development explicitly prebundles every BlockNote entry
  imported by the lazy Markdown editor; consumer admin shells request editor
  modules cross-origin without loading miniCMS's development HTML, so on-demand
  discovery must not invalidate an already loaded dependency generation.
  Production emits only `dist/minicms.js`, a classic IIFE with CSS, assets, and
  dynamic modules inlined. `admin/index.html` is development scaffolding, not a
  deployment template.
- `bin/minicms.mjs`: package CLI. `build` is project-independent and `dev`
  starts only the Vite editor. Its development bootstrap sends API and media
  requests directly to `MINICMS_API_URL` and reads its trusted bootstrap
  configuration from that local service's `/api/config`; the API has its own
  package and process.
- The shared media helper can scope accepted upload types to one collection by
  traversing its allowed record types and nested slot types cycle-safely. The
  filesystem API uses that scope; the GitHub adapter retains its established
  global upload behavior.
- Consumer websites own `/admin/index.html`, config/media copying, deployment,
  and runtime preview registration. Never resolve or bundle consumer preview
  source while building miniCMS.
- `init.sh` is the safe, idempotent new-repository bootstrap. It must be run
  from the consumer's `admin/` directory, extracts the one explicitly marked
  HTML fence from the live README, writes that directory's `index.html`, and
  specializes the reusable root `cms.config.yml` template into the consumer
  repository root. The GitHub adapter owns only that root configuration path;
  never generate a second admin-local config copy. The initializer derives a
  safe GitHub repository and branch, fails before writes on malformed input or
  target conflicts, never follows/overwrites symlinks, and treats an identical
  rerun as a no-op. `init.test.mjs` exercises the shell boundary without the
  network.
- A project registers one optional React preview component before
  `miniCMS.init()`. miniCMS owns the preview root and passes only
  `{data, focus}`. Project preview bundles reuse `miniCMS.React` and
  `miniCMS.jsxRuntime` instead of shipping another React copy.
- `llm.txt` is the end-to-end execution contract for an LLM building a new
  consumer repository: pinned editor/API submodules, the reusable starter
  config, initial content, Astro/React static rendering, the shared project
  preview, loopback development persistence, and GitHub Pages publication. It
  must remain generic rather than reproducing a consumer's private content or
  visual identity, and its preview section must stay aligned with the exact
  `{data, focus}` runtime contract. Its site scaffold requires a dedicated
  React component and colocated Sass file for every configured node type plus
  `Unknown`; `Renderer.tsx` stays traversal/registry-only, `site.scss` stays an
  `@use` manifest, and Astro pages/layouts keep their separate routing/document
  ownership.
- `.github/workflows/pages.yml` publishes `dist/minicms.js` to `gh-pages` and
  updates the immutable, version-pinned `rawcdn.githack.com` URL in `README.md`
  to that deployment commit. `ci/update-readme.sh` is the single owner of that
  pin update; the GitHub Pages URL remains the stable latest-build URL.
- Consumer repositories own their specialized `cms.config.yml` and `content/`.
  The package-root `cms.config.yml` is the sole reusable bootstrap template,
  based on the reference content model but containing no project records,
  remote aliases, or Beowolf-only research collections. Do not turn it into a
  live miniCMS project or add project-specific content. Its accordion template
  seeds one unstyled Summary title for a useful initial disclosure, but the
  Summary slot has a minimum of zero so an editor may remove that title.

The website, editor, and API service are one controlled pre-release stack.
When the shared image contract changes, update every consumer atomically and
remove the replaced route/parser; do not add redirects, dual reads, or legacy
image compatibility unless the user explicitly requests it.

The package is normally linked from a Git submodule with
`"@signalwerk/minicms": "file:./miniCMS"`. It is not a consumer workspace and
must not become part of the website build. Websites may import only the
published `./content` and `./content/fs` entries; infrastructure packages may
consume the stable `./core/*` helpers without importing editor internals.

## Commands

Requires Node.js 24 or newer; `.nvmrc`, package engines, and consumer CI should
stay aligned on that major version.

```sh
npm install
npm run build
npm test
npm run dev
```

`minicms build` always writes the package-owned standalone bundle; it does not
accept project or static-deployment build options. `minicms dev` serves only
the development editor; the development HTML selects the API adapter.
`ADMIN_PORT`, `HOST`, and `MINICMS_API_URL` are supported. Direct cross-origin
HTTP is accepted only when both the editor and API use loopback hosts; every
remote API origin must use HTTPS. Restart the separate API service after
changing shared core modules it has imported.

## Model and persistence

- Root config contains keyed `node_types` and `collections` mappings.
- Root `connectors` contains mandatory `default`, optional reserved
  `development`, and named remote adapters. Browser initialization explicitly
  selects development with `environment: "development"`; only that reserved
  connector may receive an `apiUrl` override through
  `connectorOptions.development`. Production connector origins always come
  from the consumer-owned bootstrap config.
- Remote node types are exact `{connector, remote_type}` source declarations;
  remote collections are exact `{connector, remote_collection}` declarations.
  They may reference named connectors only. Materialized definitions remain
  owned by that connector: Settings may edit them or create a new remote type
  and collection, then the composite writes concrete owner schema before it
  publishes the exact aliases through the active default connector. Removing
  an alias never deletes its remote schema or records, and a new hydrated alias
  must not overwrite an unaliased remote definition. Because records are
  complete atomic units, connector persistence boundaries are collections;
  remote node-type aliases translate schema identity but do not create
  partial-node writes.
- `site.image_processing` configures only the API image-service capability:
  default raster dimensions, fit, output format/quality, and the derivative
  schema embedded in generated URLs. Project dimensions constrain newly
  generated URLs; deployment-owned limits are the service's stable enforcement
  boundary so existing URLs survive later default changes. Legacy cache
  `strategy` and `max_age` settings normalize away when project configuration
  is validated or saved. GitHub image URL behavior must remain unchanged.
  JPEG output accepts distinct `jpg` and `jpeg` format values and preserves
  the selected extension in canonical derivative URLs.
- Named API connectors require a credential-free HTTPS `api_url`. The reserved
  default and development connectors may omit it for same-origin/runtime
  selection; development alone may configure a loopback HTTP origin. Every API
  connector outside loopback development requires an exact HTTPS `auth_url`.
  When its session requires authentication, the adapter uses the central
  worker's established string popup protocol, posts the ephemeral GitHub token
  exactly once as `{token}` to `/api/auth/github` without generic bearer
  injection, discards it, and stores only the returned opaque service bearer.
  Direct GitHub connectors retain their established token storage behavior.
  GitHub auth and API roots are credential-free HTTPS origins.
- Fields use a compact, intentionally custom declarative schema.
- Fields are optional by default. Omit `required` for optional fields and
  persist only `required: true`; legacy `required: false` input normalizes away
  when configuration is validated or saved.
- Records contain `id`, `type`, `order`, `properties`, and typed `slots`.
- A slot may configure an ordered `default` array of flat templates containing
  exactly `{type, properties?}`. Template types must be allowed by that slot;
  optional properties may override only known scalar fields (`string`, `text`,
  `url`, `markdown`, `select`, `boolean`, `datetime`, and `number`) with values
  valid for the field. Generated IDs, uploads, relations, tags, stored child
  IDs, and stored child slots are never configuration defaults. Default-template
  type edges must be acyclic and their count may not exceed a configured slot
  maximum. Every genuinely new root or content node recursively instantiates
  these templates with fresh 15-character node and generated-field IDs; an
  existing reference-creation draft keeps its already-instantiated children
  when finalized. Settings edits templates as an ordered DnD list and removes
  overrides made invalid by later field, widget, option, or allowed-type edits.
  A configured slot `min` is a persisted record invariant: missing slots count
  as empty, record validation rejects too few children, and content deletion or
  cross-slot dragging may not reduce a surviving parent below that minimum.
- Collection folders and media folders must be strict descendants of consumer
  `content/`. Concrete collections owned by one connector may not use equal or
  nested folders, and default collection folders may not overlap the media
  folder.
- YAML uses `js-yaml`’s JSON schema so dates remain strings.
- Saving Settings normalizes YAML formatting and does not preserve source
  comments; keep important project knowledge in `AGENTS.md`, not YAML comments.
- Writes atomically replace complete records; do not add partial field writes.
- API uploads are collection-scoped. The service computes SHA-256 while
  streaming and returns a structured image result plus
  `/media/<collection>/<sha256>/<filename>`; the browser never supplies the
  hash. GitHub computes SHA-256 in the browser and stores media at
  `<media_folder>/<sha256>/<Unicode-NFC-original-filename>`.
- GitHub writes are serialized per adapter and use one Git tree/commit/ref
  transaction per editor operation, so overlapping actions in one editor do
  not race the branch against each other;
  configuration saves first match the loaded `cms.config.yml` blob SHA against
  the exact parent tree before creating Git objects, then preserve non-force
  branch conflict detection through publication. Never expose tokens in config,
  URLs, logs, or persistent local storage.
- If any trusted bootstrap connector is GitHub, expose the persistent
  deployment-skip dropdown beside both Save buttons. Key the project-specific
  browser preference by the stable default connector identity, and propagate
  it to active and lazy GitHub leaves. Every GitHub
  commit boundary appends `[ci skip]` while active, including config, records,
  uploads, renames, and deletes; API adapters ignore it. Disabling the option
  publishes the current Git tree through one marker-free `Resume deployments`
  commit per affected GitHub branch so CI runs against all accumulated changes
  without another content edit. Runtime connector keys must target unique
  GitHub repository branches; separate leaf queues may not write the same
  branch.
- The deployed browser bootstrap's connector definitions are the trust
  boundary; configuration returned by an active connector cannot redirect an
  already deployed editor to another origin.
- Configuration saves materialize and validate all referenced remote schema
  before the default connector writes. A trusted but initially unused bootstrap
  connector may activate lazily when first referenced. Its leaf adapter stays
  private when the first Settings save prepares it. If authentication is
  required, return the typed connector-auth signal and let the existing action
  become Sign in and save. That second user gesture must invoke the cached leaf
  adapter's login synchronously before its first await. Publish it into the
  composite session only after authentication and config loading succeed so the
  root gate cannot unmount Settings or discard its draft. A newly added or
  changed connector must be saved unused and loaded by a fresh bootstrap before
  an alias can reference it.
- Composite authentication advances one pending connector per login action;
  lazy Settings activation likewise opens at most one new connector login per
  Save interaction. Never open a second OAuth popup after awaiting the first
  user gesture.
- GitHub supplies the latest path commit for `$updated_at`, but not file birth
  time; existing GitHub records expose `$created_at` as empty after reload.
- Deletion must not orphan hierarchy children.
- Generated-ID fields, descendant content-node IDs, and image annotation IDs
  regenerate across duplicated subtrees.
- Slug templates support field tokens plus date/time tokens and use
  collision-safe filename suffixes.
- A `slug` widget stores a URL path segment. It requires a non-empty `template`
  string such as `"{{title}}-{{field2}}"`, derives its initial value from those
  sibling field tokens when a record is created, and exposes an explicit
  regenerate action for later changes to those fields. Persisted values are empty or match
  `[a-z0-9]+(?:-[a-z0-9]+)*`; filename slug templates remain a separate
  concern. Full public paths are a renderer concern.

Supported widgets include `string`, `slug`, `url`, `text`, `markdown`, `select`,
`boolean`, `datetime`, `number`, `file`, `image`, `reference`, `tags`, and
`id`. The legacy
`uuid` widget is accepted and normalized to `id` when configuration is loaded.
Slug template tokens may use scalar `string`, `text`, `url`, `markdown`, `select`,
`datetime`, `number`, or generated-ID fields. Slug inputs normalize typing to
lowercase ASCII and hyphens. Their regenerate button uses the same compact
input-action layout as URL fields; configured defaults, self references,
unknown fields, relation/media fields, and slug-to-slug template fields are
invalid. The obsolete `sources` array is rejected; do not introduce a second
slug configuration grammar beside the established double-brace templates.
URL fields normally store empty strings or absolute HTTP(S) URLs. A URL field
may independently configure `internal_links.collections`; it then also accepts
one strict canonical `minicms://link/<collection>/<encoded-value>` value from
that allowlist. The resolved content value is always `{url, link}` for an
opted-in field: external and empty URLs have `link: null`, while canonical
internal values use the same `{collection, ref, record, ancestors}` target
contract as Markdown. Missing targets retain their identity with a null record
and empty ancestors. Unconfigured URL fields remain strings. Shared config,
slot-default, and record validation enforce the same storage contract. URL
fields use the browser's semantic URL input for web values. Valid external URL
values expose a compact external-link action beside Inspector controls and
inside read or edit table cells without increasing their height. The native
anchor opens a new tab and stops table-row click and keyboard propagation;
empty, malformed, relative, and non-HTTP(S) values expose no action. Connector
translation and collection-key migration rewrite exact canonical URL-field
values as well as actual Markdown link destinations, without rewriting custom
schemes embedded in arbitrary plain text. A `tags`
field names one target collection and persists an ordered, unique array of its
opaque generated IDs. The target publishes its generated-ID and string-label
fields through `views.reference.value` and `views.reference.title`; the shared
read adapter resolves each stored ID to the standard reference envelope while
retaining the ID in `ref`. A tag lookup that misses a cached target index
refreshes that collection once, so an inline-created tag resolves in the live
preview immediately. The Inspector uses a creatable React Select: creating a
tag immediately writes a complete target record through the active adapter,
then selects it. Like media upload, that independent write survives discarding
the source record draft. A concurrent filename conflict refreshes the target
collection and retries once unless the same label already exists. Tags have no
configured default or per-type filter;
their published value must be a generated-ID property such as `content_id`,
because `id` and `$id` denote the readable top-level record ID. Inline creation
uses the target collection's `node_type`, which must remain in its
`allowed_types` when that list is configured.
Select options may be scalars or `{label, value}` mappings. Uploads are
immediate. File and image fields use an `accept` array of HTML accept tokens;
MIME types, extensions, and wildcards including `*/*` are supported and
enforced by both adapters. Legacy comma-delimited strings normalize to arrays
when loaded. The
shared image default includes SVG; when TIFF is configured, MIME inference
recognizes both `.tif` and `.tiff`. The file default accepts all types.
Rejected media errors include the normalized MIME type received from the
browser or request header; use the shared media error formatter.
Opaque IDs generated by miniCMS always match `[a-z0-9]{15}`. This covers
generated-ID field values, descendant content nodes, and image annotations.
Top-level record IDs remain readable storage keys/filename stems and are not
part of this opaque-ID contract. Every non-empty image value is strictly
`{hash, filename, ...annotations}`; `hash` is lowercase SHA-256 and `filename`
is the Unicode-NFC original basename. Persisted `src`, `path`, `sha`, and
legacy path strings are invalid. Content resolution adds `src` only to its
transient clone. Always read and compact images through `model/image.js`.
Persisted width and
height define the annotation coordinate space and take precedence over a
browser's `naturalWidth`/`naturalHeight` when an annotated image is reopened;
this is especially important for dimensionless SVGs whose fallback intrinsic
size varies between browsers. API derivatives must obtain unannotated source
dimensions from the public curated info route before enabling annotations.
Metadata URLs always use the canonical `noop` operation so they remain
independent of display-size and quality defaults. Never persist a downsampled
derivative's natural dimensions. Regions may
include a normalized numeric
`rotation`; annotation coordinates remain integers, while rotation may use
decimal degrees. Reference
presentation belongs to the target collection’s `views.reference` and may
configure `value`, `image`, `title`, `description`, and target-published
`selections`. The published mapping defines presentation order; reference
fields treat their selection-name list as an opt-in set. Singular values stay
scalar without selections and expand to `{ref, selections}` when needed; read
both forms through `model/reference.js`. A reference may instead set
`multiple: true`; it then has no configured default or selections and stores an
ordered, unique array of non-empty string, number, or boolean identities. The
shared content adapter resolves that value to an array of standard reference
envelopes in the same order. Reference cards resolve a thumbnail
only when `views.reference.image` explicitly names a field; image-less targets
use their collection icon and never interpret the record ID as media.
Reference fields may limit choices to a target collection subset with
`allowed_types`. Their dialog has separate Select and Create tabs. Create uses
the permitted primary record type and renders every currently applicable
declared field through the normal field widgets, even when a configured
Inspector panel omits that field.
Its stable full-record draft carries defaults, collision-aware generated IDs,
root hierarchy/order, and empty slots. A `slug` widget derives from its template;
for backward compatibility only, an empty plain field named `slug` receives the
final collision-safe record ID. Visible required fields validate before the
active adapter writes it. A successful adapter result is selected
automatically, while a failed write leaves the complete draft mounted. One
filename conflict refresh rebuilds storage identity without reusing an
exact-label record or discarding entered fields. Nested creation cycles are
disabled. BlockNote inline references use the same Select/Create full-record
flow and insert the stored adapter result immediately. The independent target
write survives discarding the source draft. Choosing a different target stores only its scalar
value and therefore clears stale selection IDs; choosing the same target
preserves them. Regular reference misses refresh their cached target index once
so newly created records resolve in live preview. Fields may set
`visible_when: {field, equals}`;
the inspector evaluates the condition against the current node properties and
Settings exposes it as conditional visibility rather than raw configuration.
Optional select fields default to an empty value and retain a clearable `None`
option; required selects may fall back to their first configured option.
Markdown fields lazy-load BlockNote and default to its controlled visual view;
Code exposes the exact Markdown source. `blocknote.inline_reference` may name
one collection and an optional `preview_field`. The picker uses that field for
the inserted link-text snapshot, then the collection's published reference
title and normal record title fallbacks; identity always comes from
`views.reference.value` (or the record ID fallback). Storage is an ordinary
Markdown link whose canonical destination is
`minicms://reference/<collection>/<encoded-value>`. BlockNote accepts only
strict canonical internal destinations in addition to its normal safe link
schemes, and its internal-link toolbar offers Replace/Delete without opening
the custom URI, including in read-only mode. Its picker exposes the same
Select/Create tabs and complete target inspector as ordinary references; after
the adapter stores the target, its published value and configured preview text
are inserted into the paragraph automatically. That target write is independent
and survives discarding the Markdown draft. Inline-reference resolution refreshes
its target index once on a miss so the newly created record reaches live
preview without rebuilding the editor adapter. MarkdownField uses the
explicitly imported `inlineReferenceCreationConfig` only to seed the most
appropriate editable label field when switching from search to Create; never
rely on an implicit browser global.
Serialization escapes Markdown
link-label delimiters on a cloned block tree so the visual text is unchanged;
do not add escapes to the live editor document. Only actual Markdown link
destinations resolve—plain text, code spans/fences, and image destinations do
not. Inline-reference identities must use a text-backed field;
`preview_field` is limited to scalar display fields so structured values are
never stringified into link text. Configured properties resolve for consumers to
`{markdown, references, links}`; `references` is keyed by canonical citation
destination with `{collection, ref, record}` values, while `links` follows the
stable-content contract below. Unresolved targets keep `record: null`,
unconfigured Markdown stays a string, and stored Markdown is never rewritten
by resolution. BlockNote normalizes Markdown only after a visual edit and
cannot represent every source construct losslessly.

`blocknote.internal_links.collections` independently enables stable links to
one or more collections. The link editor offers Web link and Content link;
Content link opens a searchable, select-only target chooser and uses the target
collection's published `views.reference.value` for identity and
`views.reference.title` for its label. Storage is
`[label](minicms://link/<collection>/<encoded-value>)`; paths and slugs are
never persisted. Configured Markdown resolves to
`{markdown, references, links}`. Each `links` entry is keyed by its canonical
destination and contains `{collection, ref, record, ancestors}`; hierarchy
ancestors are ordered root-to-parent and let a consumer derive the target's
current URL after moves. Content links do not enter reference sets, cannot
create targets, and expose Replace/Delete rather than opening the custom URI.
Collection translation and schema-key migrations rewrite only actual canonical
Markdown destinations for both custom schemes.

URL fields may likewise configure `internal_links.collections`. Their
Inspector control switches between a normal HTTP(S) URL and the same searchable
select-only Content link picker, persisting either the web URL or
`minicms://link/<collection>/<encoded-value>`. Configured URL properties always
resolve to `{url, link}`; external URLs have `link: null`, while internal links
use the same exact `{collection, ref, record, ancestors}` metadata as Markdown
content links. The maintained starter uses this contract for the optional
content-image `link`; consumer renderers derive current base-aware page paths,
wrap only the image frame rather than its caption, and fail closed without ever
publishing the custom scheme.

`site.reference_sets` is a keyed document-level presentation contract for
collecting configured Markdown inline references. Each set requires unique
known `collections` and a non-empty safe `item_template`; optional behavior is
document scope, first-occurrence order, deduplication, decimal numbering, and
all backlinks. Templates permit only ordinary brace-free text plus scalar
double-brace paths `number`, `collection`, `ref`, `record.id`, and
`record.properties.<safe field>`; `link_field` is restricted to the latter
property path. A Markdown inline reference may name one compatible set through
`reference_set`. Set keys are immutable after creation because miniCMS cannot
migrate arbitrary stored reference-list values. Settings edits labels and
behavior, clears bindings made incompatible by collection changes, and warns
before deletion. Consumer renderers derive numbers, anchors, and backlinks from
`inlineReferenceOccurrencesInMarkdown`; neither numbers nor anchors are stored.

Detail layout belongs under
`node_types.<type>.views.detail.panels.<panel>.groups.<group>.fields`.
Panel and group order is their mapping order in YAML; do not add or interpret
numeric `position` keys. Inspector panel focus is runtime UI behavior and must
not require a panel or group configuration key.
Collections may set `delete_files_with_record: true`. Deletion then discovers
only `file`/`image` field values, maps them into the configured media folder,
and deletes them with the YAML record. The separate API uses rollback-safe
filesystem renames; GitHub scans all concrete collections and preserves media
paths referenced by another record before its one-tree commit. Deletion
confirmation must name the affected uploaded files.
Collection list layout belongs under `collections.<name>.views.list`.
Table columns may define read/edit mode, display, appearance, alignment,
sorting, and CSS-grid width. System detail fields are `$id`, `$filename`,
`$storage_path`, `$created_at`, and `$updated_at`.
Table collections expose one schema-driven advanced-filter builder immediately
below ordinary search. Applied expressions are ANDed with search and the active
collection scope; draft expressions, disclosure state, and the activated quick
filter candidate stay local. The persisted AST is exactly a root
`{mode: all|any, children}` group containing ordered rule or group children;
rules store stable `field`, `operator`, and optional scalar `value`. Empty and
null are distinct, unary operators omit values, nested empty groups are
invalid, and an empty root means no advanced filter. Evaluation is atomic and
short-circuiting, captures one current time per query, and never consumes
formatted table labels.
Named shortcuts live under `views.list.quick_filters.built_in` and
`views.list.quick_filters.user_created` as keyed mappings of
`{label, expression}`. Built-in keys are readable safe config IDs; user keys
come from `createId()` and match `[a-z0-9]{15}`. Built-ins render first, labels
are unique across both groups, and only user shortcuts expose update, rename,
repair, and delete controls in the table. Runtime shortcut writes replace only
the active collection's `user_created` mapping through `saveConfig`; they do
not reload records, clear search, change the applied expression, or delete
independent shortcuts on reset. Core validation enforces storage grammar but
deliberately retains semantically stale fields/operators so the table can
disable and repair the complete saved expression after schema changes.
Filter keywords remain unresolved strings until evaluation. Matching is exact,
case-sensitive, and whole-input after trimming. Date boundaries and calendar
offsets use the browser's local time zone, weeks run Monday through Sunday,
and `@weekday` follows JavaScript with Sunday equal to zero. Relation and tag
controls display the target's configured reference title but persist and
compare its stable typed value.
Reference and tag table cells resolve their visible text through the target
collection's configured `views.reference.title`; the same labels drive cell
tooltips, filtering, and sorting, while missing and loading targets never expose
stored relation IDs. Editable scalar references use a compact native select
whose labels follow that configuration and whose values retain their scalar
types. Multiple references, tags, references that enable selections, and values
already containing `{ref, selections}` are inspector-only so structured values
cannot be flattened by a table control. Each distinct target collection is
loaded once per table state and refreshed when the displayed relation values
change.
Settings keeps Inspector field assignment to field, custom label, and order;
mode/display/appearance/alignment controls belong to table columns. Runtime
config parsing retains legacy detail-reference presentation compatibility.
Inspector Panel rows in Settings are collapsed by default and expand as
independent accessible disclosures; keep their identity, group count, DnD
grip, and delete action visible while collapsed.

## UI conventions

- Keep the editor compact and dark across trees, tables, previews, inspectors,
  and overlays.
- Any adapter session with `authenticationRequired: true` renders only the
  centered authentication gate until a session exists; do not mount or reveal
  the editor workspace before login. The local API reports
  `authenticationRequired: false` and is immediately usable.
- Typography has exactly three size tokens and three Sass style primitives;
  reuse the `%type-*` placeholders from `styles/_typography.scss`.
- Import each feature stylesheet from its component entry file. Keep selectors
  with the feature that renders them and reserve `styles.scss` for document
  defaults.
- Read-only metadata renders as plain selectable text, not disabled inputs.
- Use shared in-app modals, dismissible with Escape; never browser prompts.
- Shared confirmation and advanced-filter naming dialogs isolate and trap
  keyboard focus, operate only when they are the topmost backdrop, and restore
  the invoking control on close.
- Unsaved-change confirmation offers Cancel, Save, and Discard. Save persists
  the current record and then continues the action that opened the dialog.
  Save is its rightmost/default action and responds to Enter and
  Command/Ctrl+S; destructive confirmation remains a separate action.
- Command/Ctrl+S suppresses the browser save dialog and persists the active
  record; while Settings is open it persists the configuration draft, and
  while a reference Create tab owns focus it stores and selects that target
  draft instead.
- Every active Inspector panel, including the implicit default Inspector,
  exposes a focus action. Panel focus keeps all of its groups and fields mounted
  in a fixed, centered surface below global toasts and dialogs. The global
  Command+Control+Option+Shift+F shortcut opens the active panel; Escape exits
  and restores focus. Do not add field-local focus controls, configuration, or
  persistence; the capture-phase global save shortcut must continue to work in
  BlockNote and Code views.
- A collection load without a record route selects no record. A valid deep
  selection hash restores its record and optional content node after refresh.
- Multiple tree selections show only their selection count in the inspector.
- Inspector panel and field-group headings do not show field-count badges.
- The Inspector pane heading contains only its working panel tabs or selection
  title. Do not add an inert menu/collapse action beside them.
- Content-tree rows use their configured icon as the type indicator; do not
  add a redundant type-name suffix on the right side.
- The Content structure panel heading is title-only. Do not add a node-count
  badge or an inert overflow/options action beside it.
- Collection-tree rows resolve their configured icon from each record’s own
  type, including heterogeneous collections; DnD previews use the same icon.
- Every visible breadcrumb level is keyboard-focusable and clickable. The
  collection level clears record selection; document/content levels select the
  matching tree node and reduce multi-selection to that node.
- Tree action bars and operations must respect multi-selection.
- Hidden tree rows keep their muted treatment when selected and show a small
  crossed badge on the type icon. Do not add a trailing visibility icon or an
  accent/active state to the toolbar visibility action.
- Both tree add actions use the searchable insertion overlay.
- Expanded content nodes with multiple slots show every declared slot label,
  including empty destinations, so editors can distinguish where new children
  will be inserted. Those labels are keyboard-selectable, mutually exclusive
  insertion and paste destinations; selecting one clears real-node selection,
  disables node-only actions, and scopes Inside choices and drops to that exact
  slot without falling back to a sibling slot. Slot selection is transient and
  serializes only the owning record in the URL, never a synthetic content-node
  ID. A single empty slot keeps the compact leaf-row treatment.
- Both trees use `@dnd-kit/core`, identical inside-drop behavior, absolute
  no-layout-shift indicators, and a pointer-offset drag overlay.
- Hierarchy is visible and edited in the collection tree; do not duplicate
  hierarchy or parent information in the inspector.
- Workspace split sizes persist in local storage and remain keyboard operable.
- Column resize handles provide the sole visible pane divider; do not add
  adjacent pane borders that create double separator lines.
- The URL hash stores `#<collection>/<record>/<content-node>`, with the record
  and node segments optional and every segment encoded independently. Keep
  legacy collection-only hashes working. Only the active member of a
  multi-selection is serialized; stale record/node targets canonicalize to
  the nearest valid loaded level. A selected document root is serialized as a
  content node too, so refresh distinguishes it from collection selection.
- A project registers one optional React component before `init()`. miniCMS
  owns its root and calls it with the resolved current-item `data` envelope and
  generic authoring props from `focus(nodeId)`. Do not pass adapters, lists,
  routes, config loaders, or write APIs into the preview. The iframe adds
  hover, focus, and selected outlines; click, Enter, or Space selects the
  matching tree node. Tree selection scrolls the registered boundary without
  moving keyboard focus, including repeated requests for the same ID.
  Registered table collections expose Preview selected without losing table
  sort or scroll state.
- Settings is a full-screen overlay organized around project, collection, and
  content-type tasks. Common changes must be additive and understandable
  without knowing the persisted structure. Fields and table columns use
  compact disclosure rows; technical controls stay collapsed by default.
  Communicate through labels, state, hierarchy, and interaction rather than
  instructional paragraphs, and never expose a raw YAML/source editor.
- New collections and content types choose their owning trusted connector at
  creation time. Collection creation offers only content types owned by that
  connector. Existing ownership and remote identity are read-only in the
  ordinary editor; moving data between connectors is not implied by editing
  schema. Every newly created content type starts with ordered required
  `content_id` (generated `id`, read-only) and `title` (`string`) fields.
  Remote-owned collections and types use the same full forms as local
  definitions, with remote type slots and relations limited to aliases owned by
  that connector.
- Settings can duplicate and rename collection and content-type keys. A
  duplicate is a deep schema-only copy inserted after its source, with a fresh
  `-copy` key (then `-copy2`, and so on); collections receive an empty sibling
  folder and remote-owned copies receive a fresh owner identity. Renames retain
  mapping order and rewrite every schema dependency. Concrete collection
  renames replace the folder basename and pass a composed old-to-new rename
  plan through the configuration save so storage moves atomically; persisted
  remote aliases retain their remote identity and folder. Unsaved duplicate
  renames change their prospective identity/folder without creating a storage
  rename. Deleting persisted schema reserves its old key locally until that
  deletion is saved, so a later rename cannot accidentally target a key that
  still exists in storage. Folder, key, and remote-identity conflicts are
  rejected before save.
- Settings must retain visible keyboard focus, trap focus within the active
  modal, restore focus on close, expose selected/expanded states to assistive
  technology, support reduced motion, and remain usable in its stacked
  small-screen layout.
- Icon settings use the accessible preview picker backed by `ICON_NAMES` and
  `iconFor` in `model/editor.js`. Add supported icons to that shared registry;
  do not reintroduce plain icon-name selects or a second option list.
- Image fields keep a compact inspector preview and open region/point editing
  in a dedicated modal. Regions use the standard eight resize handles plus
  move and rotation. Pointer and keyboard rotation use 1-degree steps normally,
  0.1-degree steps with Option/Alt, and 45-degree snapping with Shift; Shift
  takes precedence when both modifiers are held. Both annotation kinds support
  pointer and keyboard adjustment. Persist
  source-space geometry, never preview percentages or viewport coordinates.
- An empty image field's complete “No image uploaded” stage is a keyboard-
  accessible upload button and retains drag/drop. Once an image exists, the
  preview continues to open annotation editing rather than the file picker.
  The stage alone paints the checkerboard; its nested empty-state button stays
  transparent so the pattern remains continuous without an internal seam.
- Reference selections use a target-published contract and a local-draft modal
  with native `None` controls plus focusable visual overlays. A selected crop
  renders a magnified draft result before Apply; a selected focus point is
  shown in that result. Selection changes also feed a transient record to the
  registered page preview, while Apply alone dirties the record and Cancel
  restores its original rendering. Preserve stale IDs
  with a warning until the editor explicitly replaces or clears them;
  changing the target clears its selections. When both are selected, warn if
  the first focus point is outside the first crop while leaving renderer-side
  clamping authoritative. Keep the modal body scrollable so its header and
  actions remain reachable on short and small screens.
- Selected image references and direct image uploads can always be cleared,
  including fields marked required, so editors can explicitly reset a value
  before choosing its replacement.
- Reorderable Settings lists use `@dnd-kit/core` through their visible grip
  handles. Match tree DnD behavior: keep and fade the source, use the shared
  pointer-offset overlay, and render zero-height absolute insertion lines
  centered in the list-owned gap between items. The grip is the sole reorder
  control and must retain keyboard DnD; do not add adjacent up/down buttons.
- Retain proper modal confirmation for destructive/discard flows.

## Adapters, API, and testing

Every storage adapter implements config read/write, collection list, record
read/create/save/rename/delete, media upload, media URL resolution, and session
methods. The composite routes CRUD and uploads by local collection, while
configuration writes are planned by owner: changed named connectors save first
and the active default connector publishes changed exact two-key aliases last.
Remote-only schema edits do not write the default connector. A partial
cross-connector failure retains private provisional ownership for successful
owner writes so retry skips them, without changing live routes or exposing
aliases before default publication; cross-service atomicity is not implied.
Changing a concrete collection's `folder` is part of its leaf adapter's
configuration save, never a separate operation. GitHub reuses existing blob
SHAs and publishes paths plus config in one non-force commit; empty Git folders
appear only with the first record. Changing `extension` between `yml` and
`yaml` rewrites direct record paths in that same transaction; a simultaneous
folder move must not leave the intermediate old-extension copy behind, and an
existing direct entry with the next extension must be rejected rather than
silently adopted as a record. The API uses its versioned configuration
transaction contract.
Explicit schema-key renames travel with that configuration save as
`{node_types, collections}` old-to-new mappings. The default leaf rewrites
all retained concrete records, including nested types and canonical inline
references, while a renamed remote alias preserves its owner identity and
never renames owner storage. GitHub preflights the verified snapshot, all
record migrations, and configured plus physical folder destinations before
creating Git objects, then publishes config, folder moves, and YAML rewrites in
one commit. The API adapter always sends `{config, schema_renames}` under its
existing `If-Match` transaction.
The composite exposes deployment suppression only when its trusted bootstrap
contains GitHub. It propagates the current choice to every active and lazily
created GitHub leaf, whose single commit boundary owns the `[ci skip]` marker.
The initiating browser tab owns the resume commit; storage synchronization
updates other tabs without publishing duplicate commits.
`resolveMediaUrl` remains the raw file/download path;
`resolveImageUrl` is a separate capability and receives the structured image
asset. A non-image scalar field may still opt into `display: image` or be
published as a reference thumbnail; those presentations resolve the stored
string through `resolveMediaUrl`, while only `widget: image` uses
`resolveImageUrl`. The API implementation builds
transformed routes from the latest loaded config and exposes public curated
`getImageInfo`; GitHub delegates image resolution exactly to its existing raw
resolver and does no info fetch. Media/image/info resolution always carries
the owning local collection so identical relative paths can be dispatched to
different connector origins. UI code must use `AdapterContext`, never call `/api` or GitHub
directly. The independent service's content contract remains under `/api`.
Upload widgets pass the active collection name plus `widget` to `uploadMedia`
and support picker or single-file drag/drop. A duplicate response has exactly
`{duplicate: true, existing, copy}`; the accessible dialog offers Cancel,
Upload another copy, and Use existing, then retries with
`duplicate: "copy" | "reuse"`. API-owned production may silently deduplicate;
an API serving a GitHub-owned development project forwards this choice.
Deployed browser bundles load
`cms.config.yml` relative to the consumer-owned admin document and then use the
configured adapter. API bearers are opaque service credentials stored only in
session storage and sent on protected requests. A GitHub token obtained for an
API connector remains browser-memory-only for its single `/api/auth/github`
exchange and must never enter storage, URLs, logs, or generic authorization
headers. Media URLs remain anonymous because ordinary
`<img>` and download requests cannot attach the bearer.

The independent service owns API integration/auth tests. Keep adapter mock
coverage beside adapters and shared-helper tests under `core/`. Run `npm test`,
`npm run build`, and `npm run check:bundle` after adapter or bundle changes.
Never commit `node_modules/`, `admin/dist/`, `dist/`, logs, or environment
files.
