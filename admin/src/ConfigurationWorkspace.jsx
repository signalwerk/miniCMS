import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Files,
  Image,
  Layers3,
  ListTree,
  Plus,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const CONFIG_ICONS = {
  "file-text": FileText,
  files: Files,
  image: Image,
  layers: Layers3,
  list: ListTree,
  settings: Settings2
};

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function pathParts(path) {
  if (Array.isArray(path)) return path;
  return String(path || "")
    .split(".")
    .filter(Boolean);
}

function pathId(path, prefix = "item") {
  return `${prefix}:${JSON.stringify(path)}`;
}

function getAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function setAtPath(value, path, nextValue) {
  if (!path.length) return nextValue;
  const next = structuredClone(value);
  let current = next;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      current[key] = nextValue;
      return;
    }
    const followingKey = path[index + 1];
    if (
      !current[key] ||
      typeof current[key] !== "object"
    ) {
      current[key] = typeof followingKey === "number" ? [] : {};
    }
    current = current[key];
  });
  return next;
}

function deleteAtPath(value, path) {
  const next = structuredClone(value);
  const parent = getAtPath(next, path.slice(0, -1));
  const key = path.at(-1);
  if (Array.isArray(parent)) parent.splice(key, 1);
  else if (parent && typeof parent === "object") delete parent[key];
  return next;
}

function renameMappingKey(value, path, nextKey) {
  const parentPath = path.slice(0, -1);
  const previousKey = path.at(-1);
  const mapping = getAtPath(value, parentPath) ?? {};
  const renamed = Object.fromEntries(
    Object.entries(mapping).map(([key, entry]) => [
      key === previousKey ? nextKey : key,
      entry
    ])
  );
  return setAtPath(value, parentPath, renamed);
}

function matchesWhen(when, value) {
  if (!when) return true;
  const current = value?.[when.field];
  if (Array.isArray(when.in)) return when.in.includes(current);
  return current === when.equals;
}

function resolveOptions(field, config) {
  const resolved = { ...field };
  if (field.options_from) {
    resolved.options = Object.keys(getAtPath(config, pathParts(field.options_from)) ?? {});
  }
  if (field.fields) {
    resolved.fields = Object.fromEntries(
      Object.entries(field.fields).map(([name, nestedField]) => [
        name,
        resolveOptions(nestedField, config)
      ])
    );
  }
  if (field.item) resolved.item = resolveOptions(field.item, config);
  return resolved;
}

function itemLabel(type, value, key, fallback) {
  return (
    (type.label_field && value?.[type.label_field]) ||
    fallback ||
    (typeof key === "number" ? `${type.label} ${key + 1}` : key) ||
    type.label ||
    "Configuration"
  );
}

function buildConfigurationTree(schema, config) {
  function buildContainer(spec, path, ownerValue) {
    const container = getAtPath(config, path);
    const entries =
      spec.mode === "list"
        ? (Array.isArray(container) ? container : []).map((value, index) => [
            index,
            value
          ])
        : Object.entries(
            container && typeof container === "object" && !Array.isArray(container)
              ? container
              : {}
          );
    const node = {
      id: pathId(path, "container"),
      kind: "container",
      label: spec.label,
      icon: spec.icon,
      path,
      mode: spec.mode,
      itemType: spec.item_type,
      children: []
    };
    node.children = entries.map(([key]) =>
      buildItem(
        [...path, key],
        spec.item_type,
        key,
        {
          mode: spec.mode,
          containerPath: path
        }
      )
    );
    return node;
  }

  function buildItem(path, typeName, key, owner, labelOverride, iconOverride) {
    const type = schema.types?.[typeName] ?? {
      label: typeName,
      fields: {}
    };
    const value = getAtPath(config, path);
    const normalizedValue =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const node = {
      id: pathId(path),
      kind: "item",
      path,
      key,
      owner,
      typeName,
      type,
      label: itemLabel(type, normalizedValue, key, labelOverride),
      icon:
        (type.icon_field && normalizedValue[type.icon_field]) ||
        iconOverride ||
        type.icon,
      value: normalizedValue,
      virtual: value === undefined,
      children: []
    };
    node.children = Object.values(type.children ?? {})
      .filter((child) => matchesWhen(child.when, normalizedValue))
      .map((child) => {
        const childPath = [...path, ...pathParts(child.path)];
        if (child.mode === "object") {
          return buildItem(
            childPath,
            child.item_type,
            childPath.at(-1),
            {
              mode: "object",
              containerPath: childPath.slice(0, -1)
            },
            child.label,
            child.icon
          );
        }
        return buildContainer(child, childPath, normalizedValue);
      });
    return node;
  }

  return Object.values(schema.sections ?? {}).map((section) => {
    const path = pathParts(section.path);
    if (section.mode === "object") {
      return buildItem(
        path,
        section.item_type,
        path.at(-1),
        { mode: "section", containerPath: [] },
        section.label,
        section.icon
      );
    }
    return buildContainer(section, path);
  });
}

function flattenTree(nodes) {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

function visibleNode(node, search) {
  if (!search) return true;
  if (node.label.toLocaleLowerCase().includes(search)) return true;
  return node.children?.some((child) => visibleNode(child, search));
}

function ConfigurationTreeNode({
  node,
  selectedId,
  expanded,
  search,
  depth = 0,
  onSelect,
  onToggle
}) {
  if (!visibleNode(node, search)) return null;
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = search || expanded.has(node.id);
  const Icon = CONFIG_ICONS[node.icon] || (node.kind === "container" ? Layers3 : FileText);
  return (
    <div className="configuration-tree__branch">
      <button
        type="button"
        className={cx(
          "configuration-tree__row",
          node.kind === "container" && "configuration-tree__row--container",
          node.id === selectedId && "is-selected"
        )}
        style={{ "--depth": depth }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
      >
        <span
          className={cx(
            "configuration-tree__toggle",
            !hasChildren && "is-empty"
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
        >
          {hasChildren &&
            (isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            ))}
        </span>
        <span className="configuration-tree__icon">
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <span>{node.label}</span>
      </button>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <ConfigurationTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              search={search}
              depth={depth + 1}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KeyField({ field, value, siblings, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(value);
    setError("");
  }, [value]);

  function commit() {
    const normalized = draft.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
      setError("Use lowercase letters, numbers, and underscores; start with a letter.");
      return;
    }
    if (normalized !== value && siblings.includes(normalized)) {
      setError(`“${normalized}” already exists here.`);
      return;
    }
    setError("");
    if (normalized !== value) onCommit(normalized);
  }

  return (
    <div className="field">
      <div className="field__heading">
        <label>{field.label}</label>
      </div>
      <input
        type="text"
        value={draft}
        spellCheck="false"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
      {field.hint && <small>{field.hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function ConfigurationEntryDialog({ container, type, onCancel, onCreate }) {
  const isMap = container.mode === "map";
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function close(event) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onCancel]);

  function submit(event) {
    event.preventDefault();
    const normalizedKey = key.trim();
    if (isMap && !/^[a-z][a-z0-9_]*$/.test(normalizedKey)) {
      setError("Use lowercase letters, numbers, and underscores; start with a letter.");
      return;
    }
    if (
      isMap &&
      container.children.some((child) => child.key === normalizedKey)
    ) {
      setError(`“${normalizedKey}” already exists here.`);
      return;
    }
    onCreate({ key: normalizedKey, label: label.trim() });
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="dialog configuration-dialog" onSubmit={submit}>
        <div className="dialog__top">
          <span className="dialog__icon">
            <Plus size={18} />
          </span>
          <div>
            <h2>Add {type.label}</h2>
            <p>Create it inside {container.label}.</p>
          </div>
          <button type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog__body configuration-dialog__fields">
          {isMap && (
            <div className="field">
              <div className="field__heading">
                <label htmlFor="configuration-entry-key">Key</label>
              </div>
              <input
                id="configuration-entry-key"
                value={key}
                autoFocus
                spellCheck="false"
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
          )}
          {Object.hasOwn(type.defaults ?? {}, "label") && (
            <div className="field">
              <div className="field__heading">
                <label htmlFor="configuration-entry-label">Label</label>
              </div>
              <input
                id="configuration-entry-label"
                value={label}
                autoFocus={!isMap}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          )}
          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            <Plus size={15} />
            Add {type.label.toLowerCase()}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfigurationDeleteDialog({ node, onCancel, onConfirm }) {
  useEffect(() => {
    function close(event) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog configuration-dialog" role="dialog" aria-modal="true">
        <div className="dialog__top">
          <span className="dialog__icon dialog__icon--danger">
            <Trash2 size={18} />
          </span>
          <div>
            <h2>Delete {node.label}?</h2>
            <p>References are checked when the configuration is saved.</p>
          </div>
          <button type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfigurationWorkspace({
  schema,
  config,
  onChange,
  renderField
}) {
  const tree = useMemo(
    () => buildConfigurationTree(schema, config),
    [schema, config]
  );
  const flatTree = useMemo(() => flattenTree(tree), [tree]);
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState(
    () => new Set(tree.map((node) => node.id))
  );
  const [search, setSearch] = useState("");
  const [entryDialog, setEntryDialog] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const selected = flatTree.find((node) => node.id === selectedId) ?? null;

  useEffect(() => {
    if (selected || !flatTree.length) return;
    const firstItem = flatTree.find((node) => node.kind === "item");
    if (firstItem) setSelectedId(firstItem.id);
  }, [flatTree, selected]);

  function updateConfig(nextConfig, nextSelectedId = selectedId) {
    onChange(nextConfig);
    setSelectedId(nextSelectedId);
  }

  function toggle(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const siblingContainer = selected?.kind === "item"
    ? flatTree.find(
        (node) =>
          node.kind === "container" &&
          JSON.stringify(node.path) ===
            JSON.stringify(selected.owner?.containerPath)
      )
    : null;
  const addContainer =
    selected?.kind === "container" ? selected : siblingContainer;
  const duplicableItem =
    selected?.kind === "item" &&
    ["map", "list"].includes(selected.owner?.mode);
  const deletableItem =
    selected?.kind === "item" &&
    (
      ["map", "list"].includes(selected.owner?.mode) ||
      (selected.owner?.mode === "object" && !selected.virtual)
    );

  function createEntry({ key, label }) {
    const container = entryDialog;
    const type = schema.types[container.itemType] ?? {};
    const value = structuredClone(type.defaults ?? {});
    if (label && Object.hasOwn(value, "label")) value.label = label;
    let nextConfig;
    let nextPath;
    if (container.mode === "list") {
      const list = getAtPath(config, container.path);
      const nextList = Array.isArray(list) ? [...list, value] : [value];
      nextConfig = setAtPath(config, container.path, nextList);
      nextPath = [...container.path, nextList.length - 1];
    } else {
      const mapping = getAtPath(config, container.path) ?? {};
      nextConfig = setAtPath(config, container.path, {
        ...mapping,
        [key]: value
      });
      nextPath = [...container.path, key];
    }
    setExpanded((current) => new Set([...current, container.id]));
    setEntryDialog(null);
    updateConfig(nextConfig, pathId(nextPath));
  }

  function duplicateSelected() {
    if (!duplicableItem) return;
    const source = structuredClone(getAtPath(config, selected.path));
    if (selected.owner.mode === "list") {
      const list = [...getAtPath(config, selected.owner.containerPath)];
      const index = Number(selected.key);
      list.splice(index + 1, 0, source);
      updateConfig(
        setAtPath(config, selected.owner.containerPath, list),
        pathId([...selected.owner.containerPath, index + 1])
      );
      return;
    }
    const mapping = getAtPath(config, selected.owner.containerPath);
    let nextKey = `${selected.key}_copy`;
    let suffix = 2;
    while (Object.hasOwn(mapping, nextKey)) {
      nextKey = `${selected.key}_copy_${suffix}`;
      suffix += 1;
    }
    if (source.label) source.label = `${source.label} copy`;
    updateConfig(
      setAtPath(config, selected.owner.containerPath, {
        ...mapping,
        [nextKey]: source
      }),
      pathId([...selected.owner.containerPath, nextKey])
    );
  }

  function moveSelected(direction) {
    if (selected?.owner?.mode !== "list") return;
    const list = [...getAtPath(config, selected.owner.containerPath)];
    const index = Number(selected.key);
    const destination = index + direction;
    if (destination < 0 || destination >= list.length) return;
    const [moving] = list.splice(index, 1);
    list.splice(destination, 0, moving);
    updateConfig(
      setAtPath(config, selected.owner.containerPath, list),
      pathId([...selected.owner.containerPath, destination])
    );
  }

  function deleteSelected() {
    if (!deletableItem) return;
    const parentId = pathId(selected.owner.containerPath, "container");
    updateConfig(deleteAtPath(config, selected.path), parentId);
    setDeleteDialog(null);
  }

  function renameSelected(nextKey) {
    const nextPath = [...selected.path.slice(0, -1), nextKey];
    updateConfig(
      renameMappingKey(config, selected.path, nextKey),
      pathId(nextPath)
    );
  }

  function updateSelectedField(name, value) {
    updateConfig(setAtPath(config, [...selected.path, name], value));
  }

  function unsetSelectedField(name) {
    updateConfig(deleteAtPath(config, [...selected.path, name]));
  }

  const type = selected?.type;
  const groups = type
    ? Object.entries(type.groups ?? {}).map(([name, group]) => ({
        ...group,
        name,
        fields: (group.fields ?? [])
          .map((fieldName) => {
            const field = type.fields?.[fieldName];
            if (!field || !matchesWhen(field.show_when, selected.value)) return null;
            return {
              ...resolveOptions(field, config),
              name: fieldName
            };
          })
          .filter(Boolean)
      }))
    : [];

  return (
    <>
      <main className="configuration-workspace">
        <aside className="configuration-tree-panel">
          <div className="panel-heading">
            <div>
              <span>{schema.title || "Configuration"}</span>
              <small>{flatTree.filter((node) => node.kind === "item").length}</small>
            </div>
          </div>
          <div className="document-toolbar" aria-label="Configuration actions">
            <button
              type="button"
              title="Add entry"
              disabled={!addContainer}
              onClick={() => setEntryDialog(addContainer)}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              title="Move up"
              disabled={
                selected?.owner?.mode !== "list" || Number(selected.key) === 0
              }
              onClick={() => moveSelected(-1)}
            >
              <ArrowUp size={18} />
            </button>
            <button
              type="button"
              title="Move down"
              disabled={
                selected?.owner?.mode !== "list" ||
                Number(selected.key) >=
                  (
                    getAtPath(config, selected?.owner?.containerPath ?? [])?.length ??
                    0
                  ) -
                    1
              }
              onClick={() => moveSelected(1)}
            >
              <ArrowDown size={18} />
            </button>
            <button
              type="button"
              title="Duplicate entry"
              disabled={!duplicableItem}
              onClick={duplicateSelected}
            >
              <Copy size={18} />
            </button>
            <button
              type="button"
              className="danger"
              title="Delete entry"
              disabled={!deletableItem}
              onClick={() => setDeleteDialog(selected)}
            >
              <Trash2 size={18} />
            </button>
          </div>
          <div className="search">
            <Search size={14} />
            <input
              value={search}
              placeholder="Find configuration…"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
          </div>
          <div
            className="configuration-tree"
            onClick={() => setSelectedId("")}
          >
            {tree.map((node) => (
              <ConfigurationTreeNode
                key={node.id}
                node={node}
                selectedId={selectedId}
                expanded={expanded}
                search={search.trim().toLocaleLowerCase()}
                onSelect={setSelectedId}
                onToggle={toggle}
              />
            ))}
          </div>
        </aside>

        <aside className="configuration-inspector-panel">
          <div className="pane-heading">
            <strong>Properties</strong>
          </div>
          {selected?.kind === "item" ? (
            <div className="inspector configuration-inspector">
              <div className="inspector__identity">
                <span className="node-icon node-icon--structure">
                  {(() => {
                    const Icon = CONFIG_ICONS[selected.icon] || Settings2;
                    return <Icon size={16} />;
                  })()}
                </span>
                <div>
                  <strong>{selected.label}</strong>
                  <span>{selected.type.label}</span>
                </div>
              </div>
              <div className="inspector__section-label">
                <span>Configuration</span>
                <span>{groups.reduce((count, group) => count + group.fields.length, 0)}</span>
              </div>
              <div className="inspector__fields">
                {groups.map((group) => {
                  const GroupIcon = CONFIG_ICONS[group.icon] || Settings2;
                  return (
                    <section className="inspector-group" key={group.name}>
                      <div className="inspector-group__heading">
                        <span className="inspector-group__icon">
                          <GroupIcon size={15} />
                        </span>
                        <span className="inspector-group__title">
                          <strong>{group.label || group.name}</strong>
                          {group.description && <small>{group.description}</small>}
                        </span>
                      </div>
                      <div className="inspector-group__content">
                        {group.fields.map((field) =>
                          field.name === "$key" ? (
                            <KeyField
                              key={field.name}
                              field={field}
                              value={String(selected.key)}
                              siblings={(
                                getAtPath(config, selected.owner.containerPath)
                                  ? Object.keys(
                                      getAtPath(config, selected.owner.containerPath)
                                    )
                                  : []
                              )}
                              onCommit={renameSelected}
                            />
                          ) : (
                            <div className="configuration-field" key={field.name}>
                              {renderField({
                                field,
                                value: selected.value[field.name],
                                idPrefix: `configuration-${selected.id}`,
                                onChange: (value) =>
                                  updateSelectedField(field.name, value)
                              })}
                              {field.required === false &&
                                selected.value[field.name] !== undefined && (
                                  <button
                                    type="button"
                                    className="configuration-field__unset"
                                    title={`Remove ${field.label || field.name} from YAML`}
                                    onClick={() => unsetSelectedField(field.name)}
                                  >
                                    <X size={12} />
                                    Unset
                                  </button>
                                )}
                            </div>
                          )
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="configuration-empty">
              <Settings2 size={22} />
              <strong>
                {selected?.kind === "container"
                  ? selected.label
                  : "Nothing selected"}
              </strong>
              <span>
                {selected?.kind === "container"
                  ? "Add an entry or choose one from this group."
                  : "Choose an item from the configuration tree."}
              </span>
            </div>
          )}
        </aside>
      </main>

      {entryDialog && (
        <ConfigurationEntryDialog
          container={entryDialog}
          type={schema.types[entryDialog.itemType]}
          onCancel={() => setEntryDialog(null)}
          onCreate={createEntry}
        />
      )}
      {deleteDialog && (
        <ConfigurationDeleteDialog
          node={deleteDialog}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={deleteSelected}
        />
      )}
    </>
  );
}
