# miniCMS

A reusable, configuration-driven content editor with a React/Vite interface
and an Express API for complete YAML records. Its field definitions are
Decap-inspired; its document/content trees and inspector are NEOS-inspired.

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

Nested values use `object` for a fixed mapping and `list` for ordered values.
Lists may contain scalars or object wrappers:

```yaml
fields:
  metadata:
    label: Metadata
    widget: object
    fields:
      theme:
        label: Theme
        widget: select
        options:
          - { label: Light, value: light }
          - { label: Dark, value: dark }
  links:
    label: Links
    widget: list
    item:
      label: Link
      widget: object
      fields:
        label: { label: Label, widget: string }
        url: { label: URL, widget: string }
```

The consuming project’s `cms.config.yml` can combine tree and table
collections, media uploads, and UUID-backed collection references.

## Configuration editor

The top-bar Settings workspace edits the consuming project’s
`cms.config.yml`. Its own presentation schema lives in
`config/configuration-editor.yml` inside miniCMS. That meta-configuration
defines the Settings tree, editable entity types, inspector groups, fields,
defaults, conditional controls, and dynamic options.

The GUI supports site settings, data types and fields, object/list nesting,
slots, inspector panels/groups, collections, hierarchy, list/table settings,
columns, and reference presentation. Configuration saves validate the complete
model before atomically replacing the YAML file. As with any structured YAML
editor, saving normalizes formatting and does not preserve source comments.

## API

- `GET /api/config`
- `PUT /api/config`
- `GET /api/configuration-editor`
- `GET /api/collections`
- `GET /api/collections/:collection`
- `GET /api/collections/:collection/:id`
- `POST /api/collections/:collection`
- `PUT /api/collections/:collection/:id`
- `POST /api/collections/:collection/:id/rename`
- `DELETE /api/collections/:collection/:id`
- `POST /api/media?filename=<name>`

Records are replaced atomically as complete YAML documents. The API validates
configured fields, node types, slots, hierarchy relationships, and safe paths.
