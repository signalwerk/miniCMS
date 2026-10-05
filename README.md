# miniCMS

A reusable, configuration-driven content editor. Projects provide their own
`cms.config.yml`, content, and optional frontend renderer. The editor can store
content in GitHub or use the independent filesystem API.

Configuration and content model reference: [SPEC.md](SPEC.md).

## Requirements

Node.js 24 or newer.

## Start a new project

Run this from an empty project directory:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/signalwerk/miniCMS/main/init.sh)
```

The initializer creates the project scaffolding, installs the editor and API
submodules, runs `npm install`, and starts the local editor and API. Set
`MINICMS_REPOSITORY=owner/repository` before running to configure the future
GitHub destination. The project starts without a frontend renderer.

For an existing project checkout:

```sh
git submodule update --init --recursive
npm install
npm run dev
```

## Editor package commands

Run these from the miniCMS package when working on the editor itself:

```sh
npm install
npm run dev
npm run build
npm test
```

The build writes the standalone browser bundle to `dist/minicms.js`. The stable
published bundle URL is <https://signalwerk.github.io/miniCMS/minicms.js>.

## Minimal admin host

The initializer extracts this host page from the README:

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
    <script src="https://rawcdn.githack.com/signalwerk/miniCMS/9397692/minicms.js"></script>
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
