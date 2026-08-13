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
The minimal host page starts the editor without a project preview; the
initializer below extracts this exact marked example from the live README:

<!-- minicms-init:index:start -->
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
    <script src="https://rawcdn.githack.com/signalwerk/miniCMS/8b7d2fc/minicms.js"></script>
    <script>
      miniCMS.init({
        target: "#root",
        configUrl: "../cms.config.yml"
      });
    </script>
  </body>
</html>
```
<!-- minicms-init:index:end -->

After every successful main-branch deployment, CI replaces every README bundle
URL with the current seven-character `gh-pages` commit. That
`rawcdn.githack.com` URL is immutable.
The stable URL that always follows the latest published build is
`https://signalwerk.github.io/miniCMS/minicms.js`.

The HTML page owns deployment. The GitHub adapter reads and writes the one
authoritative `cms.config.yml` at the repository root, so
`/admin/index.html` loads `../cms.config.yml`. miniCMS does not copy media or
website output.

## Initialize a repository

From the `admin/` directory of a new Git repository, run:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/signalwerk/miniCMS/main/init.sh)
```

The initializer derives `owner/repository` and the current branch from Git,
extracts `admin/index.html` from the marked Browser bundle example above, and
copies the reusable starter configuration to the repository root as
`cms.config.yml`. Set `MINICMS_REPOSITORY=owner/repository` or
`MINICMS_BRANCH=branch` only when Git cannot supply those values. Existing
different files and symlinks are never overwritten; rerunning against the same
generated files is a no-op.

The starter contains Pages, Images, and Files. Its image library is local to
the new repository, and its Markdown field enables stable links to the Pages
collection. This initializer intentionally stops at the minimal
host/config pair. Give an implementation agent [`llm.txt`](llm.txt) when the
goal is the complete Astro/React website, local editor/API environment, shared
live preview, and GitHub Pages deployment. The Project previews section below
documents only that feature's runtime boundary.

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
    auth_url: https://auth.signalwerk.workers.dev

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
schema remains owned by the remote project. Settings can edit that complete
schema or create a new content type and collection on a selected connector.
Saving translates local aliases back into each concrete owner configuration,
writes changed named connectors first, and publishes only changed exact two-key
aliases through the active default connector. An edit confined to existing
remote schema therefore never writes the default project. If an owner write
succeeds before a later write fails, retrying skips that completed write while
keeping unpublished aliases out of the live editor. Removing an alias does not
delete the remote schema or its records.

`name: api` uses `api_url`, or the page origin when it is omitted on a reserved
connector. Named API connectors require HTTPS. Production API connectors also
define an exact HTTPS `auth_url`; only the loopback `development` connector may
omit it. When the service reports that authentication is required, miniCMS uses
the established string popup protocol at `<auth_url>/auth`, keeps the returned
GitHub token only in memory long enough to send one JSON `{token}` request to
`<api_url>/api/auth/github`, and immediately discards it. Only the opaque bearer
returned by that service is kept in sessionStorage and attached to protected
API requests. `name: github` uses the GitHub REST API and the same popup
protocol at `<base_url>/auth`; its established GitHub-token sessionStorage
behavior is unchanged. The optional `api_root` defaults to
`https://api.github.com`. The legacy root `backend` and connector name `node`
are not accepted.

The auth worker must allow the editor's exact browser origin. Remote clients
use exact HTTPS origins (or an explicitly supported HTTPS wildcard); an HTTP
origin is safe to configure only when it is an exact loopback development
origin, including its port. This matters even with an unauthenticated local
default API because a named production API connector may still require login.

The host selects the development connector explicitly:

```js
miniCMS.init({
  configUrl: "../cms.config.yml",
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

When a Settings draft first references an unchanged trusted connector that was
unused at bootstrap, the first Save prepares that connector privately. If it
needs authentication, the existing action changes to **Sign in and save**. That
second explicit gesture opens the popup synchronously, then loads and exposes
only the authenticated connector. A cancelled or failed sign-in therefore
leaves Settings and its draft mounted. Each gesture opens at most one connector
login; repeat the still-mounted action if another newly referenced connector
also needs authentication.

Settings preflights every imported, edited, and newly created remote definition
before writing. Collection and content-type creation choose an owner from the
trusted connectors already present when the editor loaded; a collection can
use only a content type owned by that connector. Every new content type starts
with a required, read-only generated `content_id` field followed by a required
string `title` field. A newly added or changed
connector can be saved while it is unused; reload the editor from that new
bootstrap configuration before creating or importing definitions on it. This
keeps runtime origins pinned to the consumer page while ensuring a missing
remote target is never persisted.

Changing a collection's content folder is a storage migration, not a
config-only edit. API storage moves it in the same versioned filesystem
transaction as the configuration. GitHub reuses existing blobs and publishes
the old-path deletions, new paths, and `cms.config.yml` through one Git commit.
Before creating Git objects, it verifies that the parent tree still contains
the exact configuration blob loaded by the editor; a stale Settings draft is
rejected instead of overwriting a newer configuration.
An empty Git collection has no directory until its first record is created.

Settings can duplicate a collection or content type as a deep, schema-only
copy. Copies use `-copy`, `-copy2`, and later free suffixes, keep their source
ordering and presentation, and contain no records. A collection copy receives
a distinct sibling folder. Its key can be renamed before or after the first
save. Renaming a persisted content-type key migrates every root and nested
record type; renaming a persisted collection key also rewrites configured
relations and canonical Markdown references. Concrete collection folders and
API media namespaces move in the same Git or filesystem transaction. Existing
keys, configured folder overlaps, physical destinations, and remote owner
identities are checked before publication. Renaming a local remote alias keeps
the connector-owned identity and storage unchanged.

When at least one trusted connector is GitHub, the dropdown beside Save (and
Save settings) offers **Skip deployments**. The choice is stored for the
project's stable default-connector identity in browser local storage, so edits
to named connectors do not reset it. While active, every GitHub
mutation—including records, media, renames, deletes, and configuration—adds
`[ci skip]` to its commit message; API writes are unchanged. Turning the option
off creates a marker-free `Resume deployments` commit with the current tree on
each affected GitHub branch, so CI runs immediately with all accumulated
content.
GitHub writes from one editor are serialized; a truly external branch change
is still rejected so the editor never overwrites it. Connector keys used in
one session must not point to the same GitHub repository branch, because that
would create competing write queues for one branch.

Raw files use `resolveMediaUrl`; images use the separate `resolveImageUrl`
capability. The owning local collection accompanies every media request so the
composite can choose the right connector. API mode builds image-service URLs
from an image's hash and filename. API raw URLs use
`/media/<collection>/<sha256>/<filename>` while GitHub raw URLs use
`<public_folder>/<sha256>/<encoded-filename>` and store the bytes at
`<media_folder>/<sha256>/<filename>`. The filesystem service scopes accepted
upload types to fields reachable from the receiving collection and its nested
slot types.

`minicms build` is project-independent: it does not inspect or copy consumer
configuration, content, media, preview code, or site output.

## Project previews

A project preview is registered by the host page and is never imported by the
miniCMS build. It is a normal React component compiled by the website's own
build system. miniCMS owns the React root, renders the component inside its
isolated preview document, and passes exactly two props:

```html
<script src="https://rawcdn.githack.com/signalwerk/miniCMS/8b7d2fc/minicms.js"></script>
<script src="./preview.js"></script>
<script>
  miniCMS.registerPreview(window.SitePreview.ProjectPreview);
  miniCMS.init({ target: "#root", configUrl: "../cms.config.yml" });
</script>
```

Registration must happen before `miniCMS.init()`. There is no mount lifecycle
or collection registration map: the component can branch on
`data.collection.name` when different collections need different rendering.

The preview payload has only two values:

```ts
type PreviewProps = {
  data: { config: CmsConfig; collection: CmsCollection; item: ContentRecord };
  focus: (nodeId: string) => React.HTMLAttributes<HTMLElement> & {
    ref?: React.RefCallback<HTMLElement>;
  };
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

Reference and tag columns display the target collection's configured
`views.reference.title`, not the stored relation identity. Those labels also
drive table filtering and sorting. A scalar reference column in edit mode uses
the same labeled choices; multiple references and tags remain Inspector-edited.

Table search can be combined with the schema-driven **Advanced filters**
builder directly below it. The builder keeps its draft separate from the
currently applied expression, supports nested `all`/`any` groups, and combines
the applied expression with search and the active collection scope using AND.
Reference, tag, select, and Boolean controls show their configured labels while
expressions retain the stable typed values.

Named quick filters live in `views.list.quick_filters`. Built-ins are authored
in Settings; shortcuts saved from the table use crypto-generated
15-character IDs under `user_created`. Both mappings retain YAML order, while
the interface always shows built-ins first. Only the label and unresolved
expression are stored—active state, draft state, resolved dates, and matching
records are never persisted:

```yaml
views:
  list:
    type: table
    quick_filters:
      built_in:
        updated_this_week:
          label: Updated this week
          expression:
            mode: all
            children:
              - field: $updated_at
                operator: greater_than_or_equal
                value: "@weekStart()"
      user_created:
        k7p4d2m9x1q8v3c:
          label: Published books
          expression:
            mode: all
            children:
              - {field: status, operator: equals, value: published}
              - {field: media, operator: equals, value: book}
```

An expression root is `{mode: all|any, children: [...]}`. A child is another
group or `{field, operator, value?}`. Stable operators are `equals`,
`not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`,
`greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`,
`is_empty`, `is_not_empty`, `is_null`, and `is_not_null`; the field widget
limits which ones the editor offers. Empty and null remain distinct, and unary
operators do not store a value. Structurally valid shortcuts survive later
schema changes: the table disables a semantically stale shortcut and lets a
user-created one be loaded for repair instead of applying only part of it.

Keyword values are exact, case-sensitive, whole-input tokens. Supported date
and time tokens are `@now`, `@yesterday`, `@tomorrow`, `@todayStart`,
`@todayEnd`, `@weekStart()`, `@weekEnd()`, `@monthStart`, `@monthEnd`,
`@yearStart`, `@yearEnd`, their documented `.date()` variants, and
`@days(N)`, `@weeks(N)`, or `@months(N)` for a signed integer `N`. Number
fields also accept `@second`, `@minute`, `@hour`, `@weekday`, `@day`,
`@month`, and `@year`; typed tokens are `@null`, `@true`, and `@false`.
Resolution happens when the filter runs in the browser's local time zone.
Weeks run Monday through Sunday, while `@weekday` follows JavaScript's local
calendar convention: Sunday is `0` and Saturday is `6`.

Fields are optional by default. Omit `required` for optional fields and persist
only `required: true` when a value is mandatory. Optional select fields start
empty and retain a `None` option so editors can clear a previous selection.

A content area can seed ordered child content whenever its parent is newly
created. Each `default` entry names an allowed type and may override its normal
scalar field defaults:

```yaml
slots:
  summary:
    allowed_types: [title]
    min: 1
    max: 1
    default:
      - type: title
        properties:
          element: none
```

Templates contain only `type` and optional `properties`; miniCMS generates
fresh node and generated-field IDs at insertion time and recursively applies
defaults declared by the seeded type. Settings exposes these templates as an
ordered list. Upload, relation, tag, generated-ID, stored-node, and stored-slot
values are deliberately not configurable as template overrides.

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
template, root order, and configured initial slot content. **Create and select** writes that complete
record through the active adapter and immediately selects its published
reference value. Re-selecting the current target preserves crop/focus
selections; creating or choosing another target clears those target-specific
selections. This target write is immediate and survives discarding the record
that contains the reference.

Reference fields may opt into ordered multi-selection:

```yaml
authors:
  label: Authors
  widget: reference
  collection: authors
  multiple: true
```

The stored value is a duplicate-free array of the target collection's normal
published scalar reference values. The picker keeps existing selections open
for toggling, can create and append another complete target record, and resolves
the array to ordered `{ref, record, selections}` envelopes for consumers.
Multiple references have no configured default or target-specific selections;
an optional empty value is `[]`.

The `slug` widget stores an empty string or a lowercase URL path segment made
of letters and numbers separated by single hyphens. Its `template` uses the
same double-brace field-token syntax as collection filename patterns. Editors can
change the value manually or use the adjacent regenerate action to derive it
again from the current field values:

```yaml
slug:
  label: URL segment
  widget: slug
  template: "{{title}}-{{subtitle}}"
  required: true
```

The `url` widget normally stores an empty string or an absolute HTTP(S) URL and
renders a semantic browser URL input; shared validation enforces the same rule.
It can additionally allow stable links to explicitly configured collections:

```yaml
destination:
  label: Destination
  widget: url
  internal_links:
    collections:
      - pages
```

The Inspector then offers **Web link** and **Content link** modes. Content link
uses the same searchable, select-only chooser as Markdown content links, with
all matches searched and at most 100 rendered at once. Storage remains one raw
string: either HTTP(S) or the canonical
`minicms://link/<collection>/<encoded-value>` destination. A configured URL
field always resolves for consumers to `{url, link}`. `url` is the untouched
stored string; `link` is the resolved `{collection, ref, record, ancestors}`
envelope for a valid configured content link and otherwise `null`. Unconfigured
URL fields remain strings. Consumer renderers derive a public path from the
target and ancestors and must leave missing targets non-navigable.

The
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
  },
  links: {}
}
```

The website decides how each resolved record becomes a public link or another
inline presentation. Markdown fields without this configuration remain plain
strings in the read contract.

BlockNote can also link ordinary flowing text to records from any explicitly
allowed collection, independently of citation-style inline references:

```yaml
body:
  label: Body
  widget: markdown
  blocknote:
    internal_links:
      collections:
        - pages
```

The link editor offers **Web link** and **Content link**. Content link opens a
searchable picker; when several collections are allowed, the picker also lets
the editor choose the collection. Search covers the published title, record
ID, and scalar record properties. The stored destination uses the collection's
published `views.reference.value`, not its slug or current URL:

```markdown
[About the project](minicms://link/pages/abc123def456ghi)
```

Configured content links resolve alongside references without rewriting the
Markdown:

```js
{
  markdown: "Read [about the project](minicms://link/pages/abc123def456ghi).",
  references: {},
  links: {
    "minicms://link/pages/abc123def456ghi": {
      collection: "pages",
      ref: "abc123def456ghi",
      record: {/* the current target record, or null */},
      ancestors: [/* current hierarchy records, root to parent */]
    }
  }
}
```

The website derives the public URL at render time from the current target and
ancestor records. Moving or renaming a page therefore keeps every stored link
stable. Missing targets remain non-navigable label text, and the custom scheme
must never be emitted into public HTML.

Inline references may also join a named document-level reference set. The set
defines which target collections share numbering and how a website formats the
corresponding list; miniCMS keeps numbers and anchors out of stored Markdown:

```yaml
site:
  reference_sets:
    footnotes:
      label: Footnotes
      collections: [sources]
      deduplicate: true
      number_style: decimal
      item_template: "{{record.properties.title}}"
      link_field: record.properties.archive
      backlinks: all

node_types:
  text:
    fields:
      body:
        widget: markdown
        blocknote:
          inline_reference:
            collection: sources
            preview_field: title
            reference_set: footnotes
```

`collections` and `item_template` are required. Omitted behavior stays concise
and defaults to document scope, first-occurrence order, deduplication, decimal
numbers, and backlinks from every occurrence. Supported number styles are
`decimal`, `lower-alpha`, `upper-alpha`, `lower-roman`, and `upper-roman`;
backlinks may be `all`, `first`, or `none`. Templates accept ordinary text plus
only `{{number}}`, `{{collection}}`, `{{ref}}`, `{{record.id}}`, and
`{{record.properties.<field>}}`. `link_field`, when present, must be exactly a
`record.properties.<field>` path. Blocks, helpers, triple braces, dynamic
paths, and unmatched braces are rejected.

Settings creates and edits these sets and offers only compatible sets on each
Markdown field. A set key is immutable after creation because stored content
may refer to it; its label remains editable. Removing a collection from a set
clears newly incompatible field bindings. Deleting a set explicitly warns that
arbitrary stored content values cannot be migrated automatically.

Consumer renderers can import
`inlineReferenceOccurrencesInMarkdown(markdown, {collection})` from
`@signalwerk/minicms/content`. It returns every actual canonical Markdown-link
occurrence in source order as `{href, collection, ref, offset}`, preserving
duplicates while ignoring images and code spans/fences. `offset` is the
zero-based Markdown source position of the link's opening `[`. The resolved
`references` map remains keyed once per canonical destination. A website can
therefore assign display numbers from the occurrence array, look up each full
record in the map, and render its own accessible markers, list entries,
anchors, and backlinks without widening the miniCMS preview contract.

Every non-empty image field stores its lowercase SHA-256 and Unicode-NFC
original basename. `src` is transient resolved content and is never persisted;
the same mapping expands with annotation data when needed:

```yaml
file:
  hash: c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc
  filename: Example photograph.jpg
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

Both upload widgets accept one file from the picker or by drag and drop. An
empty image field's complete “No image uploaded” stage opens the picker by
click or keyboard; after upload, its preview keeps opening annotation editing.
A
GitHub upload computes SHA-256 in the browser. If that hash already exists, an
accessible three-action dialog lets the editor cancel, reuse the existing
asset, or upload another copy with a collision-safe filename suffix. API-owned
storage silently reuses identical bytes; a development API backed by a GitHub
project returns the same duplicate choices and receives the selected
`reuse`/`copy` mode on the retry. Image fields persist only `{hash, filename}`
plus annotations; file fields retain their raw path string.

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

The raw-media parser accepts canonical API
`/media/<collection>/<sha256>/<encoded-filename>` and GitHub
`/media/<sha256>/<encoded-filename>` paths. Image derivative construction uses
the structured asset plus its owning collection, so derivative routes always
retain the three-segment service namespace. The configured cache schema is the
first path segment; generated raster files mirror the remaining canonical URL
hierarchy below the service cache root.

A collection can own those uploaded files. When enabled, record deletion names
the affected files in its confirmation and removes upload values from `file`
and `image` fields together with the YAML record:

```yaml
collections:
  downloads:
    delete_files_with_record: true
```

Only paths inside the configured `site.media_folder` are eligible for this
cleanup. GitHub scans concrete collections before deleting and preserves a
media path still referenced by another record; it applies the remaining record
and upload deletions in one commit.

The top-bar Settings overlay provides a guided editor for project defaults,
collections, content types, fields, dropdown options, content areas, table
columns, built-in quick filters, hierarchy, references, and inspector layout.
Common settings are shown first; fields and table columns use compact disclosure rows, while
technical behavior is available in collapsed advanced sections. Every
supported option has a form control; Settings never exposes raw configuration
source. New collections and content types choose their connector during
creation, and remote-owned definitions use the same complete forms as local
definitions. Existing connector ownership is shown but is not silently
changed, because moving content between storage systems is a separate data
migration. The overlay supports keyboard focus containment, reduced motion,
and a stacked small-screen layout. Grip handles reorder fields, options, content
areas, inspector layout, table columns, and built-in quick filters with the
same source preview and insertion-line behavior as the content trees. The grip handles support both
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
- `POST /api/auth/github`
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
- `POST /api/media/:collection?filename=<name>&widget=<image|file>&duplicate=<reuse|copy>`
- `GET|HEAD /media/:collection/:sha256/:filename`
- `GET|HEAD /:schema/media/:collection/:sha256/:operations/:filename.:format`

`POST /api/auth/github` receives exactly `{token}` without an existing service
bearer. The service validates that ephemeral token through GitHub, discards it,
and returns its own opaque bearer. The browser sends only that service bearer
on subsequent protected API routes. Media URLs and the safe `.json` info
variant remain public so they work in ordinary image elements and cross-origin
project previews. See the API package for its authentication, deployment,
persistence, and route tests.
