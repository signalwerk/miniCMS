# AGENTS.md

This is the reusable miniCMS source of truth for coding agents. Keep it concise
and current. Every agent must update `AGENTS.md` whenever meaningful changes
are made, assumptions are clarified, or new project context is discovered.
Preserve useful guidance and remove stale information.

## Architecture

- `admin/src/`: React 19 editor. `App.jsx` is the state/persistence
  orchestrator, `model/` contains shared content/layout/view helpers, and
  `api.js` is the HTTP client.
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
- `admin/shared/slug.js`: browser/Node-compatible filename-template helpers.
- `admin/vite.config.js`: editor development/build configuration.
- `bin/minicms.mjs`: package CLI. It resolves consumer config/content from the
  current directory or `--project-root`, while editor assets remain here.
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
`PORT`, `ADMIN_PORT`, and `HOST` are supported.

## Model and persistence

- Root config contains keyed `node_types` and `collections` mappings.
- Fields resemble Decap CMS but are intentionally custom.
- Records contain `id`, `type`, `order`, `properties`, and typed `slots`.
- Collection folders and media folders must remain inside consumer `content/`.
- YAML uses `js-yaml`’s JSON schema so dates remain strings.
- Saving Settings normalizes YAML formatting and does not preserve source
  comments; keep important project knowledge in `AGENTS.md`, not YAML comments.
- Writes atomically replace complete records; do not add partial field writes.
- Deletion must not orphan hierarchy children.
- UUID fields regenerate across duplicated subtrees.
- Slug templates support field tokens plus date/time tokens and use
  collision-safe filename suffixes.

Supported widgets include `string`, `text`, `markdown`, `select`, `boolean`,
`datetime`, `number`, `image`, `reference`, and `uuid`. Select options may be
scalars or `{label, value}` mappings. Image uploads are immediate. Reference
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
- Hierarchy is edited by drag-and-drop, not by an inspector parent selector.
- Workspace split sizes persist in local storage and remain keyboard operable.
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
- Reorderable Settings lists use `@dnd-kit/core` through their visible grip
  handles. Match tree DnD behavior: keep and fade the source, use the shared
  pointer-offset overlay, and render zero-height absolute insertion lines.
  Keep the adjacent move buttons as a keyboard-accessible alternative.
- Retain proper modal confirmation for destructive/discard flows.

## API and testing

The API provides validated atomic config read/write, collection lists, record
CRUD/rename, and media upload under `/api`. Production serves the built editor
from this package, never from the consumer’s `admin/` directory.

Add integration coverage in `admin/server/api.test.mjs` for API changes and
unit coverage beside shared helpers. Run both `npm test` and `npm run build`
after meaningful changes. Never commit `node_modules/`, `admin/dist/`, logs,
or environment files.
