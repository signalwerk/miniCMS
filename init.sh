#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_RAW_BASE="https://raw.githubusercontent.com/signalwerk/miniCMS/main"
readonly README_START="<!-- minicms-init:index:start -->"
readonly README_END="<!-- minicms-init:index:end -->"

fail() {
  printf 'miniCMS init: %s\n' "$*" >&2
  exit 1
}

for command_name in awk cmp cp curl git mktemp; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "required command not found: $command_name"
done

worktree="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "run this command from the admin/ directory of a Git repository."
worktree="$(cd "$worktree" && pwd -P)"
admin_directory="$worktree/admin"
[ "$(pwd -P)" = "$admin_directory" ] ||
  fail "run this command from $admin_directory."

repository="${MINICMS_REPOSITORY:-}"
if [ -z "$repository" ]; then
  remote="$(git remote get-url origin 2>/dev/null)" ||
    fail "Git remote origin is missing; set MINICMS_REPOSITORY=owner/repository."
  case "$remote" in
    git@github.com:*) repository="${remote#git@github.com:}" ;;
    ssh://git@github.com/*) repository="${remote#ssh://git@github.com/}" ;;
    https://github.com/*) repository="${remote#https://github.com/}" ;;
    *)
      fail "origin must be a GitHub SSH or HTTPS URL; set MINICMS_REPOSITORY=owner/repository."
      ;;
  esac
  repository="${repository%/}"
  repository="${repository%.git}"
fi

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail "repository must use the form owner/repository."
fi

branch="${MINICMS_BRANCH:-}"
if [ -z "$branch" ]; then
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi
[ -n "$branch" ] ||
  fail "the current branch is unavailable; set MINICMS_BRANCH=branch."
if [[ ! "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  fail "branch contains characters that are unsafe in the generated YAML."
fi

raw_base="${MINICMS_INIT_RAW_BASE:-$DEFAULT_RAW_BASE}"
raw_base="${raw_base%/}"
case "$raw_base" in
  https://*) fetch_protocol="https" ;;
  file://*)
    [ "${MINICMS_INIT_ALLOW_FILE_BASE:-}" = "1" ] ||
      fail "file:// sources are reserved for the initializer test suite."
    fetch_protocol="file"
    ;;
  *) fail "MINICMS_INIT_RAW_BASE must use HTTPS." ;;
esac

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/minicms-init.XXXXXX")"
created_index=0
created_config=0
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    [ "$created_index" -eq 0 ] || rm -f -- "$admin_directory/index.html"
    [ "$created_config" -eq 0 ] || rm -f -- "$worktree/cms.config.yml"
  fi
  rm -rf -- "$temporary_directory"
  exit "$status"
}
trap cleanup EXIT

fetch_file() {
  relative_path="$1"
  destination="$2"
  if [ "$fetch_protocol" = "https" ]; then
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL \
      "$raw_base/$relative_path" -o "$destination"
  else
    curl --proto '=file' --proto-redir '=file' -fsSL \
      "$raw_base/$relative_path" -o "$destination"
  fi
}

readme_file="$temporary_directory/README.md"
template_file="$temporary_directory/cms.config.template.yml"
generated_index="$temporary_directory/index.html"
generated_config="$temporary_directory/cms.config.yml"

fetch_file README.md "$readme_file" || fail "could not download README.md."
fetch_file cms.config.yml "$template_file" ||
  fail "could not download cms.config.yml."

if ! awk -v start="$README_START" -v finish="$README_END" '
  BEGIN {
    starts = ends = fences = closes = inside = emitting = invalid = 0
  }
  $0 == start {
    starts += 1
    if (starts != 1 || inside || emitting) invalid = 1
    inside = 1
    next
  }
  $0 == finish {
    ends += 1
    if (!inside || emitting || ends != 1) invalid = 1
    inside = 0
    next
  }
  inside && $0 == "```html" {
    fences += 1
    if (fences != 1 || emitting) invalid = 1
    emitting = 1
    next
  }
  inside && emitting && $0 == "```" {
    closes += 1
    if (closes != 1) invalid = 1
    emitting = 0
    next
  }
  emitting { print }
  END {
    if (invalid || starts != 1 || ends != 1 || fences != 1 || closes != 1 || inside || emitting) exit 42
  }
' "$readme_file" > "$generated_index"; then
  fail "README.md does not contain one valid marked initializer HTML block."
fi

[ -s "$generated_index" ] || fail "the README initializer HTML block is empty."
grep -Fq '<!doctype html>' "$generated_index" ||
  fail "the README initializer HTML block has no document type."
grep -Fq 'configUrl: "../cms.config.yml"' "$generated_index" ||
  fail "the README initializer HTML block does not load the root configuration."

site_name="${repository#*/}"
if ! awk -v repo="$repository" -v branch="$branch" -v site="$site_name" '
  BEGIN { repositories = branches = sites = 0 }
  $0 == "    repo: owner/repository" {
    repositories += 1
    print "    repo: \"" repo "\""
    next
  }
  $0 == "    branch: main" {
    branches += 1
    print "    branch: \"" branch "\""
    next
  }
  $0 == "  name: Website" {
    sites += 1
    print "  name: \"" site "\""
    next
  }
  { print }
  END {
    if (repositories != 1 || branches != 1 || sites != 1) exit 43
  }
' "$template_file" > "$generated_config"; then
  fail "cms.config.yml does not contain the expected starter placeholders."
fi

index_target="$admin_directory/index.html"
config_target="$worktree/cms.config.yml"

preflight_target() {
  generated="$1"
  target="$2"
  if [ -L "$target" ]; then
    fail "$target is a symbolic link and will not be replaced."
  fi
  if [ -e "$target" ] && [ ! -f "$target" ]; then
    fail "$target exists and is not a regular file."
  fi
  if [ -f "$target" ] && ! cmp -s "$generated" "$target"; then
    fail "$target already exists with different content."
  fi
}

preflight_target "$generated_index" "$index_target"
preflight_target "$generated_config" "$config_target"

if [ ! -e "$config_target" ]; then
  created_config=1
  cp "$generated_config" "$config_target"
  chmod 0644 "$config_target"
  printf 'Created %s\n' "$config_target"
fi
if [ ! -e "$index_target" ]; then
  created_index=1
  cp "$generated_index" "$index_target"
  chmod 0644 "$index_target"
  printf 'Created %s\n' "$index_target"
fi

if [ "$created_config" -eq 0 ] && [ "$created_index" -eq 0 ]; then
  printf 'miniCMS is already initialized; no files changed.\n'
else
  printf 'miniCMS initialization complete.\n'
fi
