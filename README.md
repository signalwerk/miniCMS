# miniCMS

A reusable, configuration-driven content editor with a React/Vite interface
and interchangeable persistence adapters. It can use its Express API for local
files or edit a GitHub repository directly from a static deployment. Its field
definitions are Decap-inspired; its document/content trees and inspector are
NEOS-inspired.

miniCMS deliberately owns no project content. A consuming repository supplies
`cms.config.yml` and `content/`.

## Add it to a project

```sh
git submodule add git@github.com:signalwerk/miniCMS.git miniCMS
```

Add the local package and command aliases:

```json
{
  "private": true,
  "workspaces": ["miniCMS"],
  "scripts": {
    "dev": "minicms dev",
    "build": "minicms build",
    "build:pages": "minicms build --static --out-dir dist/admin",
    "start": "minicms start",
    "test": "minicms test"
  },
  "dependencies": {
    "@signalwerk/minicms": "*"
  }
}
```

Then add `cms.config.yml` and `content/` at the project root:

```sh
npm install
npm run dev
```

The command resolves project files from the current working directory. Use
`minicms dev --project-root <path>` or `MINICMS_PROJECT_ROOT` when invoking it
elsewhere.

For an existing checkout:

```sh
git submodule update --init --recursive
npm install
```

## Commands

```sh
minicms dev       # API :8787 and editor :5173
minicms build     # build the editor into miniCMS/admin/dist
minicms build --static --out-dir dist/admin
                  # static adapter build with config bootstrap
minicms start     # serve API and built editor on :8787
minicms test      # API integration and slug tests
```

Node.js 20 or newer is required. `PORT`, `ADMIN_PORT`, and `HOST` control the
listening addresses.

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

`name: node` uses the same-origin `/api` routes and may optionally define
`api_url`. `name: github` uses the GitHub REST API and the popup protocol at
`<base_url>/auth`; the optional advanced `api_root` defaults to
`https://api.github.com`. Project configuration remains at `cms.config.yml`.

`minicms dev`, the normal `minicms build`, and `minicms start` deliberately use
the Node adapter even when the deployed backend is GitHub. Static builds use
the configured adapter and copy `cms.config.yml` beside the built admin as
bootstrap data:

```sh
minicms build --static --project-root . --out-dir dist/admin
```

The static build also writes a root redirect, `.nojekyll`, and a media snapshot
to the parent output folder. Serve that folder at a Pages site and open
`/admin/`.

The GitHub adapter reads public repository data without a login. Writes open
the configured OAuth popup and keep its returned token in session storage.
Record updates, configuration writes, renames, deletions, and binary uploads
use GitHub tree/commit/ref operations so each editor operation advances the
configured branch atomically.

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
collections, media uploads, and UUID-backed collection references.

Image fields keep their compact path-string value until a region or point is
added. Annotated values expand without losing backwards compatibility:

```yaml
file:
  src: /media/example.jpg
  regions:
    - label: Portrait
      x: 120
      y: 80
      width: 640
      height: 480
  points:
    - label: Focus
      x: 410
      y: 265
```

Annotation coordinates are integer pixels in the original image. The editor
opens these controls in a dedicated modal and supports multiple labeled
regions with eight resize handles plus multiple labeled points; both can be
moved with a pointer or keyboard.

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

## Node API

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

Configuration and records are replaced atomically as complete YAML documents.
The API validates configured fields, node types, slots, hierarchy
relationships, and safe paths.
