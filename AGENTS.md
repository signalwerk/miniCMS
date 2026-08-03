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
  identity authentication; `github.js` reads and atomically commits repository
  files directly. `AdapterContext.jsx` is the only UI access path to either.
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
  repository paths, and record summaries. `media.js` owns upload accept-list
  parsing and matching; `image-service.js` owns the shared processing config,
  content-addressed media-path parser, readable operation-stack grammar,
  derivative URL builder and canonical URL parser for
  `/<schema>/media/<collection>/<sha256>/<operations>/<filename>.<format>`,
  and the strict content-addressed API raw-media URL mapper. It has no
  encoded, flat-path, or previous-route compatibility parser;
  `slug.js` owns
  filename templates; `inline-reference.js` owns the strict canonical
  `minicms://reference/<collection>/<encoded-value>` URI grammar plus the
  Markdown-safe link predicate; `id.js` owns the opaque
  generated-ID format and collision-aware generator. These helpers are
  exported as `@signalwerk/minicms/core/*` for infrastructure packages and the
  independent API service; miniCMS contains no HTTP server.
- Consumer renderers may prepend a validated source-space crop to an existing
  canonical raster derivative with `prependImageServiceOperations`. Crop
  coordinates may be decimal or negative, dimensions are decimal values of at
  least one source pixel, and optional `rotation` is clockwise. Crop is always
  first and cannot coexist with whole-image `rotate`. The helper preserves the
  derivative's origin, schema, collection, SHA-256, output filename, resize,
  quality, and format; raw, GitHub, info, noop, and SVG URLs intentionally
  return `null`.
- `content/`: the complete project-facing read contract. `index.js` resolves
  references, configured Markdown inline references, and media over an
  abstract raw source; `fs.js` loads validated YAML
  for static Node builds. An explicit API backend gets shared service-media
  defaults; GitHub/backend-less builds retain public static URLs unless the
  website explicitly supplies `imageServiceBaseUrl`. Supplied resolvers take
  precedence. Both return the same `{config, collection, item}` or
  `{config, collection, items}` envelopes.
- The editor recreates its browser content adapter after collection summaries
  change so reference-target caches cannot outlive an editor-owned write.
  Unsaved source-record drafts remain safe to resolve repeatedly.
- `admin/vite.config.js`: editor development configuration and the standalone
  browser build. Production emits only `dist/minicms.js`, a classic IIFE with
  CSS, assets, and dynamic modules inlined. `admin/index.html` is development
  scaffolding, not a deployment template.
- `bin/minicms.mjs`: package CLI. `build` is project-independent and `dev`
  starts only the Vite editor. Its development bootstrap sends API and media
  requests directly to `MINICMS_API_URL`; the API has its own package and
  process.
- The shared media helper can scope accepted upload types to one collection by
  traversing its allowed record types and nested slot types cycle-safely. The
  filesystem API uses that scope; the GitHub adapter retains its established
  global upload behavior.
- Consumer websites own `/admin/index.html`, config/media copying, deployment,
  and runtime preview registration. Never resolve or bundle consumer preview
  source while building miniCMS.
- A project registers one optional React preview component before
  `miniCMS.init()`. miniCMS owns the preview root and passes only
  `{data, focus}`. Project preview bundles reuse `miniCMS.React` and
  `miniCMS.jsxRuntime` instead of shipping another React copy.
- `.github/workflows/pages.yml` publishes `dist/minicms.js` to `gh-pages` and
  updates the immutable, version-pinned `rawcdn.githack.com` URL in `README.md`
  to that deployment commit. `ci/update-readme.sh` is the single owner of that
  pin update; the GitHub Pages URL remains the stable latest-build URL.
- Consumer repositories own `cms.config.yml` and `content/`; miniCMS must not
  contain project-specific models or records.

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
- Root `backend` selects `api` or `github`; legacy `node` normalizes to `api`.
  API accepts an optional HTTPS `api_url`. GitHub requires `repo`, `base_url`,
  and `branch`; Settings exposes all common and advanced options.
- `site.image_processing` configures only the API image-service capability:
  default raster dimensions, fit, output format/quality, and the derivative
  schema embedded in generated URLs. Project dimensions constrain newly
  generated URLs; deployment-owned limits are the service's stable enforcement
  boundary so existing URLs survive later default changes. Legacy cache
  `strategy` and `max_age` settings normalize away when project configuration
  is validated or saved. GitHub image URL behavior must remain unchanged.
- Non-empty API origins are normalized and validated as credential-free HTTPS
  origins in shared config before browser or static adapters use them.
- Fields use a compact, intentionally custom declarative schema.
- Fields are optional by default. Omit `required` for optional fields and
  persist only `required: true`; legacy `required: false` input normalizes away
  when configuration is validated or saved.
- Records contain `id`, `type`, `order`, `properties`, and typed `slots`.
- Collection folders and media folders must remain inside consumer `content/`.
- YAML uses `js-yaml`’s JSON schema so dates remain strings.
- Saving Settings normalizes YAML formatting and does not preserve source
  comments; keep important project knowledge in `AGENTS.md`, not YAML comments.
- Writes atomically replace complete records; do not add partial field writes.
- API uploads are collection-scoped. The service computes SHA-256 while
  streaming and returns `/media/<collection>/<sha256>/<filename>`; the browser
  never supplies the hash. GitHub upload paths remain unchanged.
- GitHub writes use one Git tree/commit/ref transaction per editor operation;
  preserve non-force branch conflict detection and never expose tokens in
  config, URLs, logs, or persistent local storage.
- The deployed browser bootstrap's GitHub repository and auth settings are the trust
  boundary; live repository config cannot redirect an already deployed editor
  to another backend.
- GitHub supplies the latest path commit for `$updated_at`, but not file birth
  time; existing GitHub records expose `$created_at` as empty after reload.
- Deletion must not orphan hierarchy children.
- Generated-ID fields, descendant content-node IDs, and image annotation IDs
  regenerate across duplicated subtrees.
- Slug templates support field tokens plus date/time tokens and use
  collision-safe filename suffixes.
- A content field named `slug` stores a path segment; new records default it to
  the slash-free record ID. Full public paths are a renderer concern.

Supported widgets include `string`, `url`, `text`, `markdown`, `select`,
`boolean`, `datetime`, `number`, `file`, `image`, `reference`, `tags`, and
`id`. The legacy
`uuid` widget is accepted and normalized to `id` when configuration is loaded.
URL fields store empty strings or absolute HTTP(S) URLs and use the browser's
semantic URL input; shared record validation enforces the same contract. A `tags`
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
part of this opaque-ID contract. Unannotated image values remain path strings;
annotated values use `{src, width, height, regions, points}` with immutable
annotation IDs and labeled integer coordinates in original-image pixels.
Always read images through `model/image.js` so both shapes remain compatible.
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
fields treat their selection-name list as an opt-in set. Values stay
scalar without selections and expand to `{ref, selections}` when needed; read
both forms through `model/reference.js`. Reference cards resolve a thumbnail
only when `views.reference.image` explicitly names a field; image-less targets
use their collection icon and never interpret the record ID as media.
Reference fields may limit choices to a target collection subset with
`allowed_types`. Their dialog has separate Select and Create tabs. Create uses
the permitted primary record type and renders every currently applicable
declared field through the normal field widgets, even when a configured
Inspector panel omits that field.
Its stable full-record draft carries defaults, collision-aware generated IDs,
root hierarchy/order, and empty slots; visible required fields validate before
the active adapter writes it. A successful adapter result is selected
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
`{markdown, references}`, keyed by canonical destination with
`{collection, ref, record}` values; unresolved targets keep `record: null`,
unconfigured Markdown stays a string, and stored Markdown is never rewritten
by resolution. BlockNote normalizes Markdown only after a visual edit and
cannot represent every source construct losslessly.

Detail layout belongs under
`node_types.<type>.views.detail.panels.<panel>.groups.<group>.fields`.
Panel and group order is their mapping order in YAML; do not add or interpret
numeric `position` keys. Inspector panel focus is runtime UI behavior and must
not require a panel or group configuration key.
Collections may set `delete_files_with_record: true`. Deletion then discovers
only `file`/`image` field values, maps them into the configured media folder,
  and deletes them with the YAML record. The separate API uses rollback-safe
  filesystem renames; GitHub uses one tree commit. Deletion confirmation must
  name the affected uploaded files.
Collection list layout belongs under `collections.<name>.views.list`.
Table columns may define read/edit mode, display, appearance, alignment,
sorting, and CSS-grid width. System detail fields are `$id`, `$filename`,
`$storage_path`, `$created_at`, and `$updated_at`.
Scalar reference table cells retain ordinary inline editing; references that
enable selections or already contain `{ref, selections}` are inspector-only so
the structured value cannot be flattened by a text input.
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

Every adapter implements config read/write, collection list, record
read/create/save/rename/delete, media upload, media URL resolution, and session
methods. `resolveMediaUrl` remains the raw file/download path;
`resolveImageUrl` is a separate capability. The API implementation builds
transformed routes from the latest loaded config and exposes public curated
`getImageInfo`; GitHub delegates image resolution exactly to its existing raw
resolver and does no info fetch. UI code must use `AdapterContext`, never call `/api` or GitHub
directly. The independent service's content contract remains under `/api`.
Upload widgets pass the active collection name to `uploadMedia`; storage
adapters may ignore it only when their established backend layout does not use
collection-scoped media (currently GitHub).
Deployed browser bundles load
`cms.config.yml` relative to the consumer-owned admin document and then use the
configured adapter. API bearers are opaque service credentials stored only in
session storage and sent on protected requests; GitHub OAuth access tokens for
the API never enter the browser. Media URLs remain anonymous because ordinary
`<img>` and download requests cannot attach the bearer.

The independent service owns API integration/auth tests. Keep adapter mock
coverage beside adapters and shared-helper tests under `core/`. Run `npm test`,
`npm run build`, and `npm run check:bundle` after adapter or bundle changes.
Never commit `node_modules/`, `admin/dist/`, `dist/`, logs, or environment
files.
