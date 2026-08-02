#!/usr/bin/env bash

set -euo pipefail

hash="$({
  git ls-remote origin refs/heads/gh-pages
} | awk 'NR == 1 { print substr($1, 1, 7) }')"

if [[ ! "$hash" =~ ^[0-9a-f]{7}$ ]]; then
  echo "Could not resolve the deployed gh-pages commit." >&2
  exit 1
fi

pattern='rawcdn\.githack\.com/signalwerk/miniCMS/[0-9a-f]{7}/minicms\.js'

if ! grep -Eq "$pattern" README.md; then
  echo "README.md does not contain a pinned miniCMS bundle URL." >&2
  exit 1
fi

sed -i -E \
  "s|(rawcdn\\.githack\\.com/signalwerk/miniCMS/)[0-9a-f]{7}(/minicms\\.js)|\\1${hash}\\2|g" \
  README.md

echo "Updated README.md to miniCMS bundle ${hash}."
