# miniCMS

A reusable, configuration-driven content editor with a React/Vite interface
and interchangeable persistence adapters. Its static browser bundle can use
the independent miniCMS API or edit a GitHub repository directly. Its field
schema is intentionally custom, with a tree-and-inspector editing workspace.

miniCMS deliberately owns no project content or website build. A consuming
repository supplies `cms.config.yml`, `content/`, and its own `/admin/` HTML.

## Browser bundle

The published editor is one classic JavaScript file. It contains the editor's
React runtime, styles, assets, and lazy-loaded modules. It exposes
`window.miniCMS` and never starts until the host page calls `miniCMS.init()`.
A project-owned preview is another independent browser bundle; the plain admin
page loads both, registers its component, and then starts the editor:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Content editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="https://rawcdn.githack.com/signalwerk/miniCMS/0355064/minicms.js"></script>
    <script src="./preview.js"></script>
    <script>
      miniCMS.registerPreview(window.SitePreview.ProjectPreview);
      miniCMS.init({
        target: "#root",
        configUrl: "./cms.config.yml"
      });
    </script>
  </body>
</html>
```

`0000000` is the initial publishing placeholder. After every successful
main-branch deployment, CI replaces every README bundle URL with the current
seven-character `gh-pages` commit. That `rawcdn.githack.com` URL is immutable.
The stable URL that always follows the latest published build is
`https://signalwerk.github.io/miniCMS/minicms.js`.

The HTML page owns deployment and must place `cms.config.yml` beside itself.
For example, `/admin/index.html` loads `/admin/cms.config.yml`. miniCMS does not
copy the config, media, or website output.

## Add the local tools to a project

```sh
git submodule add git@github.com:signalwerk/miniCMS.git miniCMS
```

Link the local package for the shared read adapter without making miniCMS part
of the consumer's workspace or website build:

```json
{
  "private": true,
  "scripts": {
    "dev:cms": "npm --prefix miniCMS run dev",
    "test:cms": "minicms test"
  },
  "dependencies": {
    "@signalwerk/minicms": "file:./miniCMS"
  }
}
```

Then add `cms.config.yml` and `content/` at the project root:

```sh
npm install
npm install --prefix miniCMS
npm run dev:cms
```

The editor development server contains no content server. Its API calls and
media URLs point directly to `MINICMS_API_URL` (by default
`http://127.0.0.1:8787`). Run the independent `miniCMS-api` package when local
filesystem persistence is needed. Cross-origin HTTP is allowed only between
loopback hosts; a remote API address must use HTTPS.

For an existing checkout:

```sh
git submodule update --init --recursive
npm install
npm install --prefix miniCMS
```

## Commands

```sh
minicms dev       # static editor dev server on :5173
minicms build     # package-owned standalone dist/minicms.js
minicms test      # editor, adapter, and shared-core tests
```

Node.js 24 or newer is required. The included `.nvmrc` selects that major
version. `ADMIN_PORT` and `HOST` control the Vite listener;
`MINICMS_API_URL` controls the direct content-service origin.

## Consumer structure

```text
cms.config.yml
content/
  <collection>/
  media/
miniCMS/
package.json
```

Collections point to folders inside `content/`. Each YAML record is read and
saved as a complete object with `id`, `type`, `order`, `properties`, and typed
`slots`.

The `id` widget, descendant slot nodes, and image annotations use opaque IDs
matching `^[a-z0-9]{15}$`. A record's top-level `id` is different: it is the
readable storage key and YAML filename stem. Legacy configurations using the
`uuid` widget are accepted and normalized to `id` without rewriting stored
values.

The editor keeps its active selection in the URL hash. `#pages` opens a
collection, `#pages/<record>` restores a selected record, and
`#pages/<record>/<content-node>` restores a node in its content structure.
Segments are URL-encoded. Multi-selection links retain the active item, and a
stale link falls back to the closest collection or record that still exists.
Selecting the document root in the content tree repeats its record ID in the
node segment, preserving which tree owns the active selection.

## Storage connectors

The browser exposes one storage interface while a project may use several
connectors. `default` owns the local configuration and every ordinary local
collection. The optional reserved `development` connector replaces it only
when the host explicitly starts miniCMS in development mode. Any other key is
a named remote connector:

```yaml
connectors:
  default:
    name: github
    repo: owner/website
    base_url: https://auth.example.com
    branch: main
  development:
    name: api
  central_media:
    name: api
    api_url: https://media.example.com

node_types:
  shared_image:
    connector: central_media
    remote_type: image

collections:
  shared_images:
    connector: central_media
    remote_collection: images
```

Remote declarations are deliberately exact two-key aliases. miniCMS loads the
named connector's configuration, hydrates the local type and collection for
editing, and translates their names at the connector boundary. Listing,
reading, creating, saving, renaming, deleting, and uploading through
`shared_images` therefore happen in the remote `images` collection. Imported
schema remains owned by the remote project; saving Settings writes only the
two-key aliases back through the active default connector.

`name: api` uses `api_url`, or the page origin when it is omitted on a reserved
connector. Named API connectors require HTTPS. An API connector discovers
whether it is local or requires GitHub identity, then sends its opaque bearer
on protected requests. `name: github` uses the GitHub REST API and the popup
protocol at `<base_url>/auth`; the optional `api_root` defaults to
`https://api.github.com`. The legacy root `backend` and connector name `node`
are not accepted.

The host selects the development connector explicitly:

```js
miniCMS.init({
  configUrl: "./cms.config.yml",
  environment: "development",
  connectorOptions: {
    development: { apiUrl: "http://127.0.0.1:8787" }
  }
});
```

Only `connectorOptions.development.apiUrl` may replace a configured origin;
production and named connector origins always come from the consumer-owned
bootstrap configuration. miniCMS instantiates the active default plus only the
named connectors referenced by aliases. If any of them requires
authentication, the editor remains behind the sign-in gate until every used
connector has a session. Each click authenticates one pending connector so
browser popup blocking cannot interrupt a multi-service sign-in.

Settings preflights every imported type and collection before writing
`cms.config.yml`. A newly added or changed connector can be saved while it is
unused; reload the editor from that new bootstrap configuration before adding
aliases to it. This keeps runtime origins pinned to the consumer page while
ensuring a missing remote target is never persisted.

Raw files use `resolveMediaUrl`; images use the separate `resolveImageUrl`
capability. The owning local collection accompanies every media request so the
composite can choose the right connector. API mode builds image-service URLs
and uploads to `/media/<collection>/<sha256>/<filename>`. GitHub preserves its
flat repository-media layout and raw-media URL behavior. The filesystem
service scopes accepted upload types to fields reachable from the receiving
collection and its nested slot types.

`minicms build` is project-independent: it does not inspect or copy consumer
configuration, content, media, preview code, or site output.

## Project previews

A project preview is registered by the host page and is never imported by the
miniCMS build. It is a normal React component compiled by the website's own
build system. miniCMS owns the React root, renders the component inside its
isolated preview document, and passes exactly two props:

```html
<script src="https://rawcdn.githack.com/signalwerk/miniCMS/0355064/minicms.js"></script>
<script src="./preview.js"></script>
<script>
  miniCMS.registerPreview(window.SitePreview.ProjectPreview);
  miniCMS.init({ target: "#root", configUrl: "./cms.config.yml" });
</script>
```

Registration must happen before `miniCMS.init()`. There is no mount lifecycle
or collection registration map: the component can branch on
`data.collection.name` when different collections need different rendering.

The preview payload has only two values:

```ts
type PreviewProps = {
  data: { config: CmsConfig; collection: CmsCollection; item: ContentRecord };
  focus: (nodeId: string) => React.HTMLAttributes<HTMLElement>;
};
```

`data.item` is the complete current unsaved item with configured references,
reference selections, and media URLs already resolved by miniCMS. Spread
`focus(node.id)` onto each rendered node root:

```tsx
function ProjectPreview({ data, focus }) {
  return (
    <section {...focus(data.item.id)}>
      {data.item.properties.title}
    </section>
  );
}
```

It returns React-compatible authoring props: a ref, click and keyboard handlers,
selection attributes, and `tabIndex`. Those props let miniCMS select a node on
click, Enter, or Space and scroll a selected boundary into view. There is no
adapter, configuration, collection list, route builder, or write API in preview
props. The website adds node type, hidden state, and any other project metadata
it needs. It owns all rendering and URL behavior. The component runs in an
isolated preview document so its styles do not leak into the editor. Without a
registration, miniCMS keeps its generic placeholder.

The standalone editor already contains React. To avoid shipping a second copy,
miniCMS publishes that exact runtime as `miniCMS.React` and its automatic JSX
runtime as `miniCMS.jsxRuntime`. A separately built Vite 8 preview can consume
them as globals:

```ts
// vite.preview.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: "src/preview.tsx",
      formats: ["iife"],
      name: "SitePreview",
      fileName: () => "preview.js"
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
      output: {
        exports: "named",
        globals: {
          react: "miniCMS.React",
          "react/jsx-runtime": "miniCMS.jsxRuntime"
        }
      }
    }
  }
});
```

Export `ProjectPreview` from that entry. Do not import `react-dom` or create a
root in project code; miniCMS owns both. Project styles can be bundled with the
preview and inserted by the component into the isolated document.

## Shared content adapter

The browser preview and static website use the same resolution engine. miniCMS
creates the browser adapter over its active persistence source:

```js
import { createContentAdapter } from "@signalwerk/minicms/content";

const content = createContentAdapter({
  config,
  listRaw: (collection) => storage.list(collection),
  getRaw: (collection, id) => storage.record(collection, id),
  resolveMediaUrl: (path, context) => storage.resolveMediaUrl(path, context),
  resolveImageUrl: (path, context) => storage.resolveImageUrl(path, context)
});
```

Node-based site generators use the filesystem entry:

```js
import { createFilesystemContentAdapter } from "@signalwerk/minicms/content/fs";

const content = await createFilesystemContentAdapter({
  projectRoot,
  publicBase: "/project/",
  imageServiceBaseUrl: "https://images.example.com",
  connectorOptions: {
    central_media: { token: process.env.MINICMS_CENTRAL_MEDIA_READ_TOKEN }
  }
});
```

The filesystem adapter reads default collections from the local `content/`
tree and materializes the same aliases as the browser. Named API connectors are
loaded from their configured `api_url`; another connector kind can be supplied
through `connectorSources`. Requests for a remote collection, including media
resolution, are routed to that source and translated back to local names.
`connectorOptions.<name>.token` is sent only by this server-side adapter as a
Bearer credential for protected static-build reads; never expose it to the
browser bundle.

When `connectors.default.name` is `api`, raw and derivative URLs use its image
service settings. A website may set `imageServiceBaseUrl` to use that service
for default images independently of their storage connector; an empty string
selects same-origin routes. GitHub defaults to public static URLs.
Files/downloads retain their raw-media resolver, and explicit resolver
functions always override these defaults.

`content.get(collection, idOrUnsavedRecord)` returns
`{config, collection, item}`. `content.list(collection)` returns
`{config, collection, items}`. References inside those records are expanded to
`{ref, record, selections}`, and each selection is `{ref, value}`. These two
package exports are the complete reusable read contract. miniCMS owns no
website routes, public URL construction, page hierarchy interpretation, or
presentation; all of that remains consumer code.

## Configuration

`node_types` define data and reusable content structures. `collections` define
storage, hierarchy, filename templates, and list/reference presentation.
Inspector presentation is separate from field storage:

```yaml
node_types:
  article:
    kind: document
    fields:
      title:
        label: Title
        widget: string
    views:
      detail:
        panels:
          inspector:
            label: Inspector
            groups:
              content:
                label: Content
                fields: [title]

collections:
  articles:
    folder: content/articles
    extension: yml
    node_type: article
    allowed_types: [article]
    slug: "{{title}}-{{year}}-{{month}}"
    hierarchy:
      enabled: false
    views:
      list:
        type: table
        search: { fields: [title] }
        columns:
          - { field: title, label: Title, width: minmax(14rem, 1fr) }
```

The consuming project’s `cms.config.yml` can combine tree and table
collections, media uploads, and stable-ID-backed collection references.
Inspector groups assign fields, optional custom labels, and order. The active
panel always exposes a focus action that shows all of that panel's
groups in a centered editing surface, including the implicit default Inspector.
Command+Control+Option+Shift+F focuses the active panel directly. Escape exits
and restores focus. Fine-grained mode, display, appearance, and alignment
controls belong to table columns; the runtime still reads older detail-field
presentation configuration.

Fields are optional by default. Omit `required` for optional fields and persist
only `required: true` when a value is mandatory. Optional select fields start
empty and retain a `None` option so editors can clear a previous selection.

Fields can be shown only for a matching sibling value. References can also
limit a mixed collection to specific record types:

```yaml
mode:
  label: Mode
  widget: select
  options:
    - {label: Automatic, value: automatic}
    - {label: Selected target, value: selected_target}
target:
  label: Target
  widget: reference
  collection: pages
  allowed_types: [page]
  visible_when: {field: mode, equals: selected_target}
```

Both options are editable through the field forms in Settings.

The reference chooser separates **Select** and **Create** into two tabs. Create
shows a complete inspector for the target collection's permitted primary type,
using its normal fields, defaults, generated IDs, uploads, relations, slug
template, root order, and empty slots. **Create and select** writes that complete
record through the active adapter and immediately selects its published
reference value. Re-selecting the current target preserves crop/focus
selections; creating or choosing another target clears those target-specific
selections. This target write is immediate and survives discarding the record
that contains the reference.

The `url` widget stores an empty string or an absolute HTTP(S) URL and renders a
semantic browser URL input; shared validation enforces the same rule. The
`tags` widget is a multi-relation to a collection. Its YAML value is
an ordered array of stable generated IDs; the target collection publishes the
ID and visible label once through its normal reference view:

```yaml
node_types:
  article:
    fields:
      website: {label: Website, widget: url}
      tags:
        label: Tags
        widget: tags
        collection: tags
  tag:
    fields:
      content_id: {label: ID, widget: id, readonly: true, required: true}
      name: {label: Name, widget: string, required: true}

collections:
  tags:
    folder: content/tags
    extension: yml
    node_type: tag
    allowed_types: [tag]
    slug: "{{name}}-{{year}}-{{month}}"
    identifier_field: name
    views:
      list: {type: tree}
      reference: {value: content_id, title: name}
```

The Inspector uses a creatable multi-select. Selecting writes only the tag ID
array into the edited record. Creating an option first writes a complete tag
record through the active API or GitHub adapter, then selects its generated ID;
that tag remains if the source draft is later discarded. Project-facing
content adapters resolve each stored ID to the same `{ref, record, selections}`
shape used by ordinary references, so `ref` retains the persisted ID while the
website receives the full tag record. A newly created tag also resolves in the
live preview immediately when an earlier tag lookup populated its relation
cache. Inline creation uses the target collection's `node_type`; if the
collection defines `allowed_types`, that primary type must be included.
Tags do not support defaults or per-type filters. Publish a generated-ID
property such as `content_id`; `id` and `$id` refer to the readable top-level
record ID and are not valid tag identities.

The `markdown` widget lazy-loads a controlled BlockNote editor as its default
visual view. **Code** switches to the exact Markdown source. Focus is supplied
by the active Inspector panel rather than by the field. Command/Ctrl+S
still saves the active record in either view. BlockNote's Markdown import/export
is lossy for constructs it cannot represent, so merely opening the visual view
never rewrites the value, and Code should be used when unsupported source
syntax must remain exact.

BlockNote can add an inline picker for records from one collection:

```yaml
body:
  label: Body
  widget: markdown
  blocknote:
    inline_reference:
      collection: sources
      preview_field: title
```

The target collection publishes its identity through `views.reference.value`.
`preview_field` selects the initial flowing link text; when omitted, the
collection's published reference title is used. The inserted text remains an
editable snapshot, while the link destination keeps the stable identity. The
identity must come from a text-backed field (or the record ID), and Settings
offers only scalar fields for the displayed snapshot:

```markdown
[Research source](minicms://reference/sources/abc123def456ghi)
```

The picker uses the same **Select** and **Create** tabs as an ordinary reference
field. Create shows every applicable field in the target inspector. After
**Create and insert** stores the complete target record, miniCMS inserts its
published reference identity and configured preview text into the paragraph.
Like uploads and inline-created tags, this target-record write is immediate and
survives discarding the record that contains the Markdown draft.

Only canonical miniCMS destinations are accepted in the visual editor. The
reference toolbar replaces or removes them without trying to open the custom
scheme, including when the field is read-only. Square brackets and backslashes
in the visible label are escaped only in stored Markdown, so they survive the
next visual import unchanged. The project-facing adapter leaves storage
untouched and resolves actual link destinations—not plain text, code, or image
destinations—in a configured Markdown property to:

```js
{
  markdown: "Read [the source](minicms://reference/sources/abc123def456ghi).",
  references: {
    "minicms://reference/sources/abc123def456ghi": {
      collection: "sources",
      ref: "abc123def456ghi",
      record: {/* the resolved record, or null */}
    }
  }
}
```

The website decides how each resolved record becomes a public link or another
inline presentation. Markdown fields without this configuration remain plain
strings in the read contract.

Image fields keep their compact path-string value until a region or point is
added. Annotated values expand without losing backwards compatibility:

```yaml
file:
  src: /media/example.jpg
  width: 1200
  height: 800
  regions:
    - id: 3887a356428e7f4
      label: Portrait
      x: 120
      y: 80
      width: 640
      height: 480
      rotation: 15.2
  points:
    - id: adbd1e73b1c54cc
      label: Focus
      x: 410
      y: 265
```

Annotation coordinates are integers in the persisted image coordinate space;
region rotation may use decimal degrees.
Those stored dimensions remain authoritative when the image is reopened,
which avoids browser-dependent geometry for SVGs without explicit intrinsic
dimensions. When the API displays a raster derivative and no dimensions have
yet been stored, it reads the public curated info route and uses the original,
orientation-aware dimensions instead of the derivative's browser dimensions.
IDs are immutable; labels and geometry remain editable. The editor
opens these controls in a dedicated modal and supports multiple labeled regions
with eight resize handles, move, and rotation plus multiple labeled points.
Rotation uses 1-degree steps normally, 0.1-degree steps while Option/Alt is
held, and snaps to 45-degree steps while Shift is held; Shift takes precedence
when both modifiers are held. All annotations can also be adjusted with the
keyboard.

A target collection can publish those annotations as optional selections for
its references. The source paths are declared once on the collection, and each
consuming reference field opts into the names it needs:

```yaml
node_types:
  image:
    fields:
      asset:
        widget: reference
        collection: images
        selections: [crop, focus]

collections:
  images:
    node_type: media_image
    views:
      reference:
        value: content_id
        image: file
        title: title
        selections:
          crop:
            label: Crop region
            kind: image_region
            options: {field: file, path: regions, value: id, label: label}
          focus:
            label: Focus point
            kind: image_point
            options: {field: file, path: points, value: id, label: label}
```

Without a selection the stored property stays a scalar. Selecting either
option expands it without breaking older records:

```yaml
asset:
  ref: cff576784113260
  selections:
    crop: 3887a356428e7f4
    focus: adbd1e73b1c54cc
```

The Inspector chooser provides native `None` controls and focusable visual
overlays. Selecting a crop renders a magnified draft crop before Apply; a
selected focus point appears on that result. Unknown
annotation IDs remain visible as warnings until explicitly cleared. The current
image selection kinds must resolve from the same source image field. Published
mapping order controls chooser order; a reference field's `selections` list is
an opt-in set. When the first selected focus lies outside the first selected
crop, the chooser warns without discarding either ID; the consuming renderer
owns deterministic clamping.

Image fields may configure an HTML-style `accept` list. MIME types, filename
extensions, and wildcards are supported; both persistence adapters enforce the
configured types in addition to the browser picker. SVG is part of the
default. TIFF can be enabled with `image/tiff`; extension inference covers both
`.tif` and `.tiff`:

```yaml
file:
  widget: image
  accept:
    - image/jpeg
    - image/png
    - image/webp
    - image/tiff
    - .tif
    - .tiff
    - image/svg+xml
```

Generic uploads use the `file` widget and the same configurable array. `*/*`
accepts every file type:

```yaml
download:
  widget: file
  accept:
    - "*/*"
```

API image processing is project-configured and editable under the advanced
Project settings:

```yaml
site:
  image_processing:
    width: 2400
    height: 2400
    fit: inside
    format: webp
    quality: 82
    cache:
      schema: v1
```

The schema is embedded in generated image URLs and provides an explicit way to
start a fresh derivative namespace. Generated URLs clamp component-specific
requests to the project dimensions. The service applies its stable deployment
limits to every request, so an existing canonical URL stays valid when project
defaults change. JPEG output may use either `format: jpg` or `format: jpeg`;
the selected extension is retained in generated URLs. SVG sources use an exact
byte passthrough route and never enter the raster processor.

Renderers can call `prependImageServiceOperations(url, operations)` from
`@signalwerk/minicms/content` to add one source-space crop to an
already resolved canonical raster derivative. Crop geometry may use decimal
coordinates; `left` and `top` may be negative when all four corners remain
inside the source. Dimensions must cover at least one source pixel, and an
optional `rotation` is clockwise. Crop must be first and cannot be combined
with whole-image `rotate`. The helper keeps the derivative's origin, schema,
collection, SHA-256, output filename, and existing resize/quality suffix. It
returns `null` for GitHub/raw URLs,
metadata/noop routes, and byte-preserved SVGs so renderers can retain their
non-service fallback.

New API uploads use a readable, content-addressed route. For example:

```text
/v1/media/images/<sha256>/resize@width:1600,height:900,fit:inside;quality@82/photo.webp
```

The API route builder accepts only
`/media/<collection>/<sha256>/<filename>` sources. Encoded identifiers and flat
service paths are rejected. The configured cache schema is the first path
segment; generated raster files mirror the remaining canonical URL hierarchy
below the service cache root.

A collection can own those uploaded files. When enabled, record deletion names
the affected files in its confirmation and removes upload values from `file`
and `image` fields together with the YAML record:

```yaml
collections:
  downloads:
    delete_files_with_record: true
```

Only paths inside the configured `site.media_folder` are eligible for this
cleanup. GitHub applies the record and upload deletions in one commit.

The top-bar Settings overlay provides a guided editor for project defaults,
collections, content types, fields, dropdown options, content areas, table
columns, hierarchy, references, and inspector layout. Common settings are
shown first; fields and table columns use compact disclosure rows, while
technical behavior is available in collapsed advanced sections. Every
supported option has a form control; Settings never exposes raw configuration
source. The overlay supports keyboard focus containment, reduced motion, and a
stacked small-screen layout. Grip handles reorder fields, options, content
areas, inspector layout, and table columns with the same source preview and
insertion-line behavior as the content trees. The grip handles support both
pointer and keyboard reordering; list rows do not add redundant up/down
buttons. Icon settings use a keyboard-accessible picker that previews every
option from the shared icon registry. Saving validates the complete model
before atomically replacing `cms.config.yml`.

### Icons

miniCMS uses [Lucide React](https://lucide.dev/icons/) for both interface and
configurable content icons. The Settings picker currently exposes this curated
registry:

```text
align-left       columns-3        file-text       files
image            layout-template layers          menu
newspaper        panel-left       search          settings
```

Lucide provides many more icons in its online catalog. To make another icon
configurable, import its React component and add its kebab-case configuration
name to the shared `ICONS` registry in `admin/src/model/editor.js`. Icons used
directly by interface controls do not automatically appear in the Settings
picker.

## Independent API contract

The `@signalwerk/minicms-api` service owns the HTTP implementation, filesystem
writes, local development mode, and production GitHub identity gate. miniCMS
contains only the browser adapter for this contract:

- `GET /api/auth/session`
- `GET /api/auth/github/start`
- `POST /api/auth/exchange`
- `POST /api/auth/logout`
- `GET /api/config`
- `PUT /api/config`
- `GET /api/collections`
- `GET /api/collections/:collection`
- `GET /api/collections/:collection/:id`
- `POST /api/collections/:collection`
- `PUT /api/collections/:collection/:id`
- `POST /api/collections/:collection/:id/rename`
- `DELETE /api/collections/:collection/:id`
- `POST /api/media/:collection?filename=<name>`
- `GET|HEAD /media/:collection/:sha256/:filename`
- `GET|HEAD /:schema/media/:collection/:sha256/:operations/:filename.:format`

The browser sends an opaque service bearer on protected API routes. Media URLs
and the safe `.json` info variant remain public so they work in ordinary image
elements and cross-origin project previews. See the API
package for its OAuth environment, deployment, persistence, and route tests.
