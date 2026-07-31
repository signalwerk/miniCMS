# AGENTS.md

This is the reusable miniCMS source of truth for coding agents. Keep it concise
and current. Every agent must update `AGENTS.md` whenever meaningful changes
are made, assumptions are clarified, or new project context is discovered.
Preserve useful guidance and remove stale information.

## Architecture

- `admin/src/`: React 19 editor. `App.jsx` is the state/UI orchestrator and
  `model/` contains shared content/layout/view helpers.
- `admin/src/adapters/`: browser persistence boundary. `node.js` consumes the
  Express routes; `github.js` reads and atomically commits repository files;
  `AdapterContext.jsx` is the only UI access path to an adapter.
- `admin/src/components/<Feature>/`: cohesive feature components with a
  colocated `<Feature>.scss`. Keep related small components together instead
  of creating a folder for every button or row.
- `components/ConfigurationEditor/`: handcrafted, human-first Settings
  overlay. Every supported setting is edited through guided forms; technical
  controls are progressively disclosed, but raw configuration source is never
  shown. Do not reintroduce a meta-configuration that describes this editor.
- `admin/src/styles.scss` contains only global foundations;
  `styles/_typography.scss` owns the shared Sass typography placeholders.
- `admin/server/`: Express 5 API for config, complete YAML records, and media.
- `admin/shared/content.js`: browser/Node-compatible YAML, validation, safe
  repository paths, and record summaries. `slug.js` owns filename templates.
- `admin/vite.config.js`: editor development/build configuration.
- `bin/minicms.mjs`: package CLI. It resolves consumer config/content from the
  current directory or `--project-root`; `build --static` writes a Pages-ready
  output with bootstrap config and media outside the package.
- Consumer repositories own `cms.config.yml` and `content/`; miniCMS must not
  contain project-specific models or records.

The package is normally consumed as an npm workspace from a Git submodule.
The consumer declares `"workspaces": ["miniCMS"]` and depends on
`"@signalwerk/minicms": "*"`. Keep this one-install integration working.

## Commands

Requires Node.js 20 or newer.

```sh
npm install
npm run build
npm test
node bin/minicms.mjs dev --project-root /path/to/content-project
```

In a consumer, the normal commands are `minicms dev|build|start|test`.
`minicms build --static --out-dir dist/admin` creates the configured
browser-adapter deployment. Local dev/build/start always use the Node adapter.
`PORT`, `ADMIN_PORT`, and `HOST` are supported.

## Model and persistence

- Root config contains keyed `node_types` and `collections` mappings.
- Root `backend` selects `node` or `github`. GitHub requires `repo`,
  `base_url`, and `branch`; Settings exposes all common and advanced options.
- Fields resemble Decap CMS but are intentionally custom.
- Records contain `id`, `type`, `order`, `properties`, and typed `slots`.
- Collection folders and media folders must remain inside consumer `content/`.
- YAML uses `js-yaml`’s JSON schema so dates remain strings.
- Saving Settings normalizes YAML formatting and does not preserve source
  comments; keep important project knowledge in `AGENTS.md`, not YAML comments.
- Writes atomically replace complete records; do not add partial field writes.
- GitHub writes use one Git tree/commit/ref transaction per editor operation;
  preserve non-force branch conflict detection and never expose tokens in
  config, URLs, logs, or persistent local storage.
- The static bootstrap's GitHub repository and auth settings are the trust
  boundary; live repository config cannot redirect an already deployed editor
  to another backend.
- GitHub supplies the latest path commit for `$updated_at`, but not file birth
  time; existing GitHub records expose `$created_at` as empty after reload.
- Deletion must not orphan hierarchy children.
- UUID fields regenerate across duplicated subtrees.
- Slug templates support field tokens plus date/time tokens and use
  collision-safe filename suffixes.
- A content field named `slug` stores a path segment; new records default it to
  the slash-free record ID. Full public paths are a renderer concern.

Supported widgets include `string`, `text`, `markdown`, `select`, `boolean`,
`datetime`, `number`, `image`, `reference`, and `uuid`. Select options may be
scalars or `{label, value}` mappings. Image uploads are immediate. Unannotated
image values remain path strings; annotated values use `{src, regions, points}`
with labeled integer coordinates in original-image pixels. Always read images
through `model/image.js` so both shapes remain compatible. Reference
presentation belongs to the target collection’s `views.reference` and may
configure `value`, `image`, `title`, and `description`.

Detail layout belongs under
`node_types.<type>.views.detail.panels.<panel>.groups.<group>.fields`.
Panel and group order is their mapping order in YAML; do not add or interpret
numeric `position` keys.
Collection list layout belongs under `collections.<name>.views.list`.
Table columns may define read/edit mode, display, appearance, alignment,
sorting, and CSS-grid width. System detail fields are `$id`, `$filename`,
`$storage_path`, `$created_at`, and `$updated_at`.
Settings keeps Inspector field assignment to field, custom label, and order;
mode/display/appearance/alignment controls belong to table columns. Runtime
config parsing retains legacy detail-reference presentation compatibility.
Inspector Panel rows in Settings are collapsed by default and expand as
independent accessible disclosures; keep their identity, group count, DnD
grip, and delete action visible while collapsed.

## UI conventions

- Keep the editor compact and dark across trees, tables, previews, inspectors,
  and overlays.
- Typography has exactly three size tokens and three Sass style primitives;
  reuse the `%type-*` placeholders from `styles/_typography.scss`.
- Import each feature stylesheet from its component entry file. Keep selectors
  with the feature that renders them and reserve `styles.scss` for document
  defaults.
- Read-only metadata renders as plain selectable text, not disabled inputs.
- Use shared in-app modals, dismissible with Escape; never browser prompts.
- No record is selected implicitly after collection load or refresh.
- Multiple tree selections show only their selection count in the inspector.
- Content-tree rows use their configured icon as the type indicator; do not
  add a redundant type-name suffix on the right side.
- Tree action bars and operations must respect multi-selection.
- Both tree add actions use the searchable insertion overlay.
- Both trees use `@dnd-kit/core`, identical inside-drop behavior, absolute
  no-layout-shift indicators, and a pointer-offset drag overlay.
- Hierarchy is visible and edited in the collection tree; do not duplicate
  hierarchy or parent information in the inspector.
- Workspace split sizes persist in local storage and remain keyboard operable.
- Column resize handles provide the sole visible pane divider; do not add
  adjacent pane borders that create double separator lines.
- The active collection is stored as `#<collection-name>`.
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
  move; both annotation kinds support pointer and keyboard adjustment. Persist
  source-space pixels, never preview percentages or viewport coordinates.
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
directly. The Node API remains under `/api`; production serves its built editor
from this package. Static builds bootstrap from their copied `cms.config.yml`
and then load live repository data through the configured adapter.

Add integration coverage in `admin/server/api.test.mjs` for API changes and
unit/mock coverage beside adapters and shared helpers. Run `npm test`,
`npm run build`, and a representative static build after adapter changes.
Never commit `node_modules/`, `admin/dist/`, logs, or environment files.
