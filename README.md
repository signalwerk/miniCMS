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
    <script src="https://rawcdn.githack.com/signalwerk/miniCMS/0000000/minicms.js"></script>
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

The editor development server contains no content server. It proxies `/api`
and `/media` to `MINICMS_API_URL` (by default
`http://127.0.0.1:8787`). Run the independent `miniCMS-api` package when local
filesystem persistence is needed.

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
`MINICMS_API_URL` controls its content-service proxy.

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

## Storage adapters

The browser consumes one storage interface for configuration, collection
lists, records, renames, deletion, media uploads, authentication, and media URL
resolution. Configure the deployed adapter at the root of `cms.config.yml`:

```yaml
backend:
  name: github
  repo: owner/repository
  base_url: https://auth.example.com
  branch: main
```

`name: api` uses the same-origin `/api` routes and may optionally define
`api_url`. It discovers whether that API is local or requires a GitHub identity
login, then sends the API's opaque bearer with every protected request. The
legacy `name: node` value is normalized to the same adapter. `name: github`
uses the GitHub REST API and the popup protocol at
`<base_url>/auth`; the optional advanced `api_root` defaults to
`https://api.github.com`. Project configuration remains at `cms.config.yml`.

The package's development HTML deliberately selects the API adapter even when
the deployed backend is GitHub. The standalone browser bundle uses the backend
from the bootstrap config next to the consumer's HTML. `minicms build` is
project-independent: it does not inspect or copy consumer config, content,
media, preview code, or site output.

Adapters that require authentication show only a centered sign-in action until
their session exists; the editor workspace is not mounted or displayed
beforehand. Direct GitHub's returned token stays in session storage. Repository reads, record updates,
configuration writes, renames, deletions, and binary uploads then use GitHub
tree/commit/ref operations so each editor operation advances the configured
branch atomically. The API service controls its own local/production auth mode.

## Project previews

A project preview is registered by the host page and is never imported by the
miniCMS build. It is a normal React component compiled by the website's own
build system. miniCMS owns the React root, renders the component inside its
isolated preview document, and passes exactly two props:

```html
<script src="https://rawcdn.githack.com/signalwerk/miniCMS/0000000/minicms.js"></script>
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
  resolveMediaUrl: (path) => storage.resolveMediaUrl(path)
});
```

Node-based site generators use the filesystem entry:

```js
import { createFilesystemContentAdapter } from "@signalwerk/minicms/content/fs";

const content = await createFilesystemContentAdapter({
  projectRoot,
  publicBase: "/project/"
});
```

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

Select fields marked `required: false` start empty and retain a `None` option,
so editors can clear a previously selected value.

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

The `markdown` widget lazy-loads a controlled BlockNote editor as its default
visual view. **Code** switches to the exact Markdown source. Focus is supplied
by its containing Inspector group rather than by the field. Command/Ctrl+S
still saves the active record in either view. BlockNote's Markdown import/export
is lossy for constructs it cannot represent, so merely opening the visual view
never rewrites the value, and Code should be used when unsupported source
syntax must remain exact.

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
dimensions. IDs are immutable; labels and geometry remain editable. The editor
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
configured types in addition to the browser picker. SVG is part of the default:

```yaml
file:
  widget: image
  accept:
    - image/jpeg
    - image/png
    - image/webp
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
- `POST /api/media?filename=<name>`

The browser sends an opaque service bearer on protected API routes. Media URLs
remain public so they work in ordinary image/download elements. See the API
package for its OAuth environment, deployment, persistence, and route tests.
