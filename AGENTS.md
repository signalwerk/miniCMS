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
  parsing and matching; `slug.js` owns filename templates; `id.js` owns the
  opaque generated-ID format and collision-aware generator. These helpers are
  exported as `@signalwerk/minicms/core/*` for the independent API service;
  miniCMS contains no HTTP server.
- `content/`: the complete project-facing read contract. `index.js` resolves
  references/media over an abstract raw source; `fs.js` loads validated YAML
  for static Node builds. Both return the same `{config, collection, item}` or
  `{config, collection, items}` envelopes.
- `admin/vite.config.js`: editor development configuration and the standalone
  browser build. Production emits only `dist/minicms.js`, a classic IIFE with
  CSS, assets, and dynamic modules inlined. `admin/index.html` is development
  scaffolding, not a deployment template.
- `bin/minicms.mjs`: package CLI. `build` is project-independent and `dev`
  starts only the Vite editor, proxying API/media requests to
  `MINICMS_API_URL`. The API has its own package and process.
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
`ADMIN_PORT`, `HOST`, and `MINICMS_API_URL` are supported. Restart the separate
API service after changing shared core modules it has imported.

## Model and persistence

- Root config contains keyed `node_types` and `collections` mappings.
- Root `backend` selects `api` or `github`; legacy `node` normalizes to `api`.
  API accepts an optional HTTPS `api_url`. GitHub requires `repo`, `base_url`,
  and `branch`; Settings exposes all common and advanced options.
- Fields use a compact, intentionally custom declarative schema.
- Records contain `id`, `type`, `order`, `properties`, and typed `slots`.
- Collection folders and media folders must remain inside consumer `content/`.
- YAML uses `js-yaml`’s JSON schema so dates remain strings.
- Saving Settings normalizes YAML formatting and does not preserve source
  comments; keep important project knowledge in `AGENTS.md`, not YAML comments.
- Writes atomically replace complete records; do not add partial field writes.
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

Supported widgets include `string`, `text`, `markdown`, `select`, `boolean`,
`datetime`, `number`, `file`, `image`, `reference`, and `id`. The legacy
`uuid` widget is accepted and normalized to `id` when configuration is loaded.
Select options may be scalars or `{label, value}` mappings. Uploads are
immediate. File and image fields use an `accept` array of HTML accept tokens;
MIME types, extensions, and wildcards including `*/*` are supported and
enforced by both adapters. Legacy comma-delimited strings normalize to arrays
when loaded. The
shared image default includes SVG; the file default accepts all types.
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
size varies between browsers. Regions may include a normalized numeric
`rotation`; annotation coordinates remain integers, while rotation may use
decimal degrees. Reference
presentation belongs to the target collection’s `views.reference` and may
configure `value`, `image`, `title`, `description`, and target-published
`selections`. The published mapping defines presentation order; reference
fields treat their selection-name list as an opt-in set. Values stay
scalar without selections and expand to `{ref, selections}` when needed; read
both forms through `model/reference.js`. Reference fields may limit choices to
a target collection subset with `allowed_types`. Fields may set
`visible_when: {field, equals}`;
the inspector evaluates the condition against the current node properties and
Settings exposes it as conditional visibility rather than raw configuration.
Optional select fields default to an empty value and retain a clearable `None`
option; required selects may fall back to their first configured option.
Markdown fields lazy-load BlockNote and default to its controlled visual view;
Code exposes the exact Markdown source. BlockNote normalizes Markdown only
after a visual edit and cannot represent every source construct losslessly.

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
  record; while Settings is open it persists the configuration draft instead.
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
- Content-tree rows use their configured icon as the type indicator; do not
  add a redundant type-name suffix on the right side.
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
  shown in that result. Preserve stale IDs
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
methods. UI code must use `AdapterContext`, never call `/api` or GitHub
directly. The independent service's content contract remains under `/api`.
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
