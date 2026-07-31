import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  ClipboardPaste,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Files,
  Image,
  Layers3,
  LayoutTemplate,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Newspaper,
  PanelLeft,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { api } from "./api.js";
import {
  renderSlugTemplate,
  sanitizeFilenameStem,
  slugTemplateFieldNames,
  uniqueFilenameStem
} from "../shared/slug.js";

const ICONS = {
  "align-left": AlignLeft,
  "columns-3": Columns3,
  "file-text": FileText,
  files: Files,
  image: Image,
  "layout-template": LayoutTemplate,
  layers: Layers3,
  menu: Menu,
  newspaper: Newspaper,
  "panel-left": PanelLeft,
  search: Search
};

function iconFor(name, fallback = FileText) {
  return ICONS[name] || fallback;
}

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function collectionEntries(config) {
  return Object.entries(config?.collections ?? {}).map(([name, collection]) => ({
    ...collection,
    name
  }));
}

function typeFields(type) {
  return Object.entries(type?.fields ?? {}).map(([name, field]) => ({
    ...field,
    name
  }));
}

function typeField(type, name) {
  const field = type?.fields?.[name];
  return field ? { ...field, name } : null;
}

function placeDragOverlayRightOfCursor({
  activatorEvent,
  activeNodeRect,
  transform
}) {
  if (
    !activatorEvent ||
    !activeNodeRect ||
    !("clientX" in activatorEvent)
  ) {
    return { ...transform, x: transform.x + 18 };
  }
  const pointerOffset = activatorEvent.clientX - activeNodeRect.left;
  return { ...transform, x: transform.x + pointerOffset + 16 };
}

const DRAG_OVERLAY_MODIFIERS = [placeDragOverlayRightOfCursor];
const TREE_AUTO_SCROLL = {
  acceleration: 4,
  threshold: { x: 0.05, y: 0.05 }
};
const LAYOUT_STORAGE_KEY = "beowolf-content-studio:layout:v1";
const RESIZE_HANDLE_SIZE = 6;
const MIN_TREE_WIDTH = 240;
const MAX_TREE_WIDTH = 520;
const MIN_INSPECTOR_WIDTH = 260;
const MAX_INSPECTOR_WIDTH = 560;
const MIN_PREVIEW_WIDTH = 400;
const MIN_TABLE_WIDTH = 560;
const MIN_COLLECTION_TREE_HEIGHT = 160;
const MIN_CONTENT_TREE_HEIGHT = 180;
const DEFAULT_LAYOUT_PREFERENCES = {
  treeLeftWidth: 300,
  treeRightWidth: 320,
  tableRightWidth: 320,
  treeSplit: 0.42
};

function clampNumber(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function readLayoutPreferences() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY));
    return Object.fromEntries(
      Object.entries(DEFAULT_LAYOUT_PREFERENCES).map(([name, fallback]) => [
        name,
        Number.isFinite(saved?.[name]) ? saved[name] : fallback
      ])
    );
  } catch {
    return { ...DEFAULT_LAYOUT_PREFERENCES };
  }
}

function collectionNameFromHash(config) {
  const hashValue = window.location.hash.slice(1);
  if (!hashValue) return null;
  try {
    const name = decodeURIComponent(hashValue);
    return Object.hasOwn(config.collections ?? {}, name)
      ? name
      : null;
  } catch {
    return null;
  }
}

function replaceCollectionHash(name) {
  const hash = `#${encodeURIComponent(name)}`;
  if (window.location.hash === hash) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${hash}`
  );
}

function fitLayoutPreferences(preferences, viewportWidth) {
  const availableTreeWidth = Math.max(
    MIN_TREE_WIDTH + MIN_INSPECTOR_WIDTH,
    viewportWidth - MIN_PREVIEW_WIDTH - RESIZE_HANDLE_SIZE * 2
  );
  let treeLeftWidth = clampNumber(
    preferences.treeLeftWidth,
    MIN_TREE_WIDTH,
    MAX_TREE_WIDTH
  );
  let treeRightWidth = clampNumber(
    preferences.treeRightWidth,
    MIN_INSPECTOR_WIDTH,
    MAX_INSPECTOR_WIDTH
  );
  if (treeLeftWidth + treeRightWidth > availableTreeWidth) {
    const adjustableWidth =
      treeLeftWidth -
      MIN_TREE_WIDTH +
      treeRightWidth -
      MIN_INSPECTOR_WIDTH;
    const fittedAdjustableWidth = Math.max(
      0,
      availableTreeWidth - MIN_TREE_WIDTH - MIN_INSPECTOR_WIDTH
    );
    const scale = adjustableWidth
      ? fittedAdjustableWidth / adjustableWidth
      : 0;
    treeLeftWidth =
      MIN_TREE_WIDTH + (treeLeftWidth - MIN_TREE_WIDTH) * scale;
    treeRightWidth =
      MIN_INSPECTOR_WIDTH +
      (treeRightWidth - MIN_INSPECTOR_WIDTH) * scale;
  }
  const tableRightWidth = clampNumber(
    preferences.tableRightWidth,
    MIN_INSPECTOR_WIDTH,
    Math.min(
      MAX_INSPECTOR_WIDTH,
      Math.max(
        MIN_INSPECTOR_WIDTH,
        viewportWidth - MIN_TABLE_WIDTH - RESIZE_HANDLE_SIZE
      )
    )
  );
  return {
    treeLeftWidth: Math.round(treeLeftWidth),
    treeRightWidth: Math.round(treeRightWidth),
    tableRightWidth: Math.round(tableRightWidth),
    treeSplit: clampNumber(preferences.treeSplit, 0.2, 0.8)
  };
}

function nextTreeSelection(selectedIds, anchorId, targetId, orderedIds, event) {
  const command = event.metaKey || event.ctrlKey;
  const shift = event.shiftKey;
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
  const targetIndex = orderedIds.indexOf(targetId);

  if (shift && anchorIndex !== -1 && targetIndex !== -1) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const range = orderedIds.slice(start, end + 1);
    return {
      selectedIds: command
        ? new Set([...selectedIds, ...range])
        : new Set(range),
      anchorId
    };
  }

  if (shift) {
    return { selectedIds: new Set([targetId]), anchorId: targetId };
  }

  if (command) {
    const next = new Set(selectedIds);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    return { selectedIds: next, anchorId: targetId };
  }

  return { selectedIds: new Set([targetId]), anchorId: targetId };
}

function slugifyId(value) {
  return sanitizeFilenameStem(value, "");
}

function getNode(record, id) {
  if (!record) return null;
  if (record.id === id) return record;
  for (const children of Object.values(record.slots ?? {})) {
    for (const child of children) {
      const result = getNode(child, id);
      if (result) return result;
    }
  }
  return null;
}

function getNodePath(node, id, path = []) {
  if (!node) return [];
  const nextPath = [...path, node];
  if (node.id === id) return nextPath;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) {
      const result = getNodePath(child, id, nextPath);
      if (result.length) return result;
    }
  }
  return [];
}

function descendantIds(node, ids = new Set()) {
  for (const children of Object.values(node?.slots ?? {})) {
    for (const child of children) {
      ids.add(child.id);
      descendantIds(child, ids);
    }
  }
  return ids;
}

function updateNode(node, id, update) {
  if (node.id === id) return update(node);
  let changed = false;
  const slots = {};
  for (const [slotName, children] of Object.entries(node.slots ?? {})) {
    slots[slotName] = children.map((child) => {
      const next = updateNode(child, id, update);
      if (next !== child) changed = true;
      return next;
    });
  }
  return changed ? { ...node, slots } : node;
}

function collectNodeIds(node, ids = new Set()) {
  if (!node) return ids;
  ids.add(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    children.forEach((child) => collectNodeIds(child, ids));
  }
  return ids;
}

function cloneContentNode(node, usedIds) {
  const uniqueId = (sourceId) => {
    const baseId = `${sourceId}-duplicate`;
    let candidate = baseId;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const clone = structuredClone(node);
  const replaceIds = (current) => {
    current.id = uniqueId(current.id);
    for (const children of Object.values(current.slots ?? {})) {
      children.forEach(replaceIds);
    }
  };
  replaceIds(clone);
  return clone;
}

function findLocation(node, id) {
  for (const [slotName, children] of Object.entries(node.slots ?? {})) {
    const index = children.findIndex((child) => child.id === id);
    if (index !== -1) return { parentId: node.id, slotName, index, children };
    for (const child of children) {
      const result = findLocation(child, id);
      if (result) return result;
    }
  }
  return null;
}

function selectedTopLevelContentNodes(record, selectedIds, includeRoot = false) {
  const result = [];
  const walk = (node, hasSelectedAncestor = false) => {
    const isSelected = selectedIds.has(node.id);
    const isTopLevelSelection = (includeRoot || node.id !== record.id) && isSelected;
    if (isTopLevelSelection && !hasSelectedAncestor) {
      result.push(node);
    }
    for (const children of Object.values(node.slots ?? {})) {
      children.forEach((child) =>
        walk(child, hasSelectedAncestor || isTopLevelSelection)
      );
    }
  };
  if (record) walk(record);
  return result;
}

function contentPasteTarget(record, selectedId, nodes, nodeTypes) {
  const selected = getNode(record, selectedId);
  if (!selected || !nodes.length) return null;
  const types = nodes.map((node) => node.type);
  const fits = (slot, childCount) =>
    types.every((type) => slot?.allowed_types?.includes(type)) &&
    (!slot.max || childCount + nodes.length <= slot.max);
  const location =
    selected.id === record.id ? null : findLocation(record, selected.id);

  if (location) {
    const parent = getNode(record, location.parentId);
    const slot = nodeTypes[parent?.type]?.slots?.[location.slotName];
    if (fits(slot, location.children.length)) {
      return {
        parentId: location.parentId,
        slotName: location.slotName,
        index: location.index + 1
      };
    }
  }

  for (const [slotName, slot] of Object.entries(
    nodeTypes[selected.type]?.slots ?? {}
  )) {
    const children = selected.slots?.[slotName] ?? [];
    if (fits(slot, children.length)) {
      return { parentId: selected.id, slotName, index: children.length };
    }
  }
  return null;
}

function collectionHierarchyValue(record, collection, fieldName, fallback) {
  const configuredField = collection.hierarchy?.[fieldName];
  if (!configuredField) return fallback;
  return record.properties?.[configuredField] ?? record[configuredField] ?? fallback;
}

function uniqueRecordId(sourceId, usedIds, suffix = "copy") {
  const baseId = `${sourceId}-${suffix}`;
  let candidate = baseId;
  let counter = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function collectionCopyContext(records, collection, items, focusedId) {
  if (!records?.length || !collection) return null;
  const copiedHierarchyIds = new Set(
    records.map((copiedRecord) =>
      collectionHierarchyValue(
        copiedRecord,
        collection,
        "id_field",
        copiedRecord.id
      )
    )
  );
  const rootRecords = records.filter((copiedRecord) => {
    const parent = collectionHierarchyValue(
      copiedRecord,
      collection,
      "parent_field",
      copiedRecord.parent ?? null
    );
    return !copiedHierarchyIds.has(parent);
  });
  const focusedItem = items.find((item) => item.id === focusedId);
  const parent = focusedItem?.parent ?? null;
  const rootTypes =
    parent === null
      ? collection.allowed_types ?? [collection.node_type]
      : collection.hierarchy?.allowed_child_types ?? [];
  const nestedTypes = collection.hierarchy?.allowed_child_types ?? [];
  const nestedRecords = records.filter(
    (copiedRecord) => !rootRecords.includes(copiedRecord)
  );
  if (
    !rootRecords.length ||
    !rootRecords.every((copiedRecord) => rootTypes.includes(copiedRecord.type)) ||
    (nestedRecords.length &&
      (!collection.hierarchy?.enabled ||
        !nestedRecords.every((copiedRecord) =>
          nestedTypes.includes(copiedRecord.type)
        )))
  ) {
    return null;
  }
  return { parent, focusedItem, rootRecords };
}

function optionValue(option) {
  return typeof option === "object" ? option.value : option;
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function defaultFieldValue(field, generateUuid = false) {
  let value = field.default;
  if (value === undefined && field.widget === "uuid") {
    value = generateUuid ? createUuid() : "";
  }
  if (value === undefined && field.widget === "boolean") value = false;
  if (value === undefined && field.widget === "select") {
    value = optionValue(field.options?.[0]) ?? "";
  }
  return value === undefined ? "" : value;
}

function defaultProperties(type) {
  return Object.fromEntries(
    typeFields(type).map((field) => [
      field.name,
      defaultFieldValue(field, true)
    ])
  );
}

function refreshUuidFields(node, nodeTypes) {
  const type = nodeTypes[node.type];
  for (const field of typeFields(type)) {
    if (field.widget === "uuid") {
      node.properties = { ...(node.properties ?? {}), [field.name]: createUuid() };
    }
  }
  for (const children of Object.values(node.slots ?? {})) {
    children.forEach((child) => refreshUuidFields(child, nodeTypes));
  }
}

function newNode(typeName, type) {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) || Date.now().toString(36);
  const node = {
    id: `${typeName}-${suffix}`,
    type: typeName,
    properties: defaultProperties(type)
  };
  if (type?.slots) {
    node.slots = Object.fromEntries(Object.keys(type.slots).map((name) => [name, []]));
  }
  return node;
}

function buildHierarchy(items) {
  const hierarchyIds = new Set(items.map((item) => item.hierarchy_id || item.id));
  const children = new Map();
  for (const item of items) {
    const parent = item.parent && hierarchyIds.has(item.parent) ? item.parent : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(item);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }
  return children;
}

function collectionInsertionModes(collection, items, record) {
  const selectedItem = items.find((item) => item.id === record?.id);
  const rootTypes = collection.allowed_types ?? [collection.node_type];
  const childTypes = collection.hierarchy?.allowed_child_types ?? rootTypes;
  const siblingParent = selectedItem?.parent ?? null;
  const siblingOrder = selectedItem?.order ?? 0;
  const siblings = selectedItem
    ? items
        .filter((item) => (item.parent ?? null) === siblingParent)
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    : [];
  const siblingIndex = siblings.findIndex((item) => item.id === selectedItem?.id);
  const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling =
    siblingIndex !== -1 && siblingIndex < siblings.length - 1
      ? siblings[siblingIndex + 1]
      : null;
  const beforeOrder = previousSibling
    ? ((previousSibling.order ?? 0) + siblingOrder) / 2
    : siblingOrder - 1;
  const afterOrder = nextSibling
    ? (siblingOrder + (nextSibling.order ?? siblingOrder + 1)) / 2
    : siblingOrder + 1;
  const rootOrder = items.reduce((maximum, item) => Math.max(maximum, item.order ?? 0), -1) + 1;
  const children = selectedItem
    ? items.filter((item) => item.parent === (selectedItem.hierarchy_id || selectedItem.id))
    : [];
  const childOrder =
    children.reduce((maximum, item) => Math.max(maximum, item.order ?? 0), -1) + 1;

  const choices = (types, target) =>
    types.map((typeName) => ({
      key: `${target.mode}:${typeName}`,
      typeName,
      ...target
    }));

  return [
    {
      id: "before",
      label: "Before",
      choices: selectedItem
        ? choices(rootTypes, {
            mode: "before",
            parent: siblingParent,
            order: beforeOrder
          })
        : []
    },
    {
      id: "inside",
      label: "Inside",
      choices:
        selectedItem && collection.hierarchy?.enabled
          ? choices(childTypes, {
              mode: "inside",
              parent: selectedItem.hierarchy_id || selectedItem.id,
              order: childOrder
            })
          : !selectedItem
            ? choices(rootTypes, { mode: "inside", parent: null, order: rootOrder })
            : []
    },
    {
      id: "after",
      label: "After",
      choices: selectedItem
        ? choices(rootTypes, {
            mode: "after",
            parent: siblingParent,
            order: afterOrder
          })
        : []
    }
  ];
}

function contentInsertionModes(record, selectedId, nodeTypes) {
  const selected = getNode(record, selectedId);
  if (!selected) {
    return ["before", "inside", "after"].map((id) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      choices: []
    }));
  }

  const selectedType = nodeTypes[selected.type];
  const location = selected.id === record.id ? null : findLocation(record, selected.id);
  const parent = location ? getNode(record, location.parentId) : null;
  const parentSlot = parent ? nodeTypes[parent.type]?.slots?.[location.slotName] : null;
  const siblingCapacity =
    location && parentSlot && (!parentSlot.max || location.children.length < parentSlot.max);

  const siblingChoices = (mode, index) =>
    siblingCapacity
      ? (parentSlot.allowed_types ?? []).map((typeName) => ({
          key: `${mode}:${location.parentId}:${location.slotName}:${typeName}`,
          typeName,
          mode,
          parentId: location.parentId,
          slotName: location.slotName,
          slotLabel: parentSlot.label || location.slotName,
          index
        }))
      : [];

  const insideChoices = Object.entries(selectedType?.slots ?? {}).flatMap(
    ([slotName, slot]) => {
      const children = selected.slots?.[slotName] ?? [];
      if (slot.max && children.length >= slot.max) return [];
      return (slot.allowed_types ?? []).map((typeName) => ({
        key: `inside:${selected.id}:${slotName}:${typeName}`,
        typeName,
        mode: "inside",
        parentId: selected.id,
        slotName,
        slotLabel: slot.label || slotName,
        index: children.length
      }));
    }
  );

  return [
    {
      id: "before",
      label: "Before",
      choices: location ? siblingChoices("before", location.index) : []
    },
    { id: "inside", label: "Inside", choices: insideChoices },
    {
      id: "after",
      label: "After",
      choices: location ? siblingChoices("after", location.index + 1) : []
    }
  ];
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function Spinner({ small = false }) {
  return <LoaderCircle className={cx("spinner", small && "spinner--small")} />;
}

function ResizeHandle({ axis, label, onResize }) {
  const lastCoordinate = useRef(null);
  const orientation = axis === "x" ? "vertical" : "horizontal";

  function finishResize(event) {
    if (lastCoordinate.current === null) return;
    lastCoordinate.current = null;
    document.body.classList.remove(
      "is-resizing-columns",
      "is-resizing-rows"
    );
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className={cx(
        "layout-resizer",
        axis === "x"
          ? "layout-resizer--columns"
          : "layout-resizer--rows"
      )}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        lastCoordinate.current =
          axis === "x" ? event.clientX : event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add(
          axis === "x"
            ? "is-resizing-columns"
            : "is-resizing-rows"
        );
      }}
      onPointerMove={(event) => {
        if (lastCoordinate.current === null) return;
        const coordinate =
          axis === "x" ? event.clientX : event.clientY;
        const delta = coordinate - lastCoordinate.current;
        if (!delta) return;
        lastCoordinate.current = coordinate;
        onResize(delta);
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
      onKeyDown={(event) => {
        const backwardKey = axis === "x" ? "ArrowLeft" : "ArrowUp";
        const forwardKey = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (![backwardKey, forwardKey].includes(event.key)) return;
        event.preventDefault();
        onResize(event.key === backwardKey ? -10 : 10);
      }}
    />
  );
}

function EmptyState({ icon: Icon = FileText, title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon size={20} />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function MultiSelectionNotice({ count, label, icon: Icon }) {
  return (
    <div className="multi-selection-notice">
      <span className="multi-selection-notice__icon">
        <Icon size={20} />
      </span>
      <strong>
        {count} {label} selected
      </strong>
      <p>Select a single item to edit its properties.</p>
    </div>
  );
}

function TreeDropLine({ id, data, enabled, visible, depth }) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data,
    disabled: !enabled
  });
  return (
    <div
      className={cx(
        "tree-drop-anchor",
        visible && "is-visible",
        isOver && enabled && "is-over"
      )}
      style={{ "--depth": depth }}
      aria-hidden="true"
    >
      <div ref={setNodeRef} className="tree-drop-target">
        <span />
      </div>
    </div>
  );
}

function DragPreview({ drag }) {
  if (!drag) return null;
  const Icon = iconFor(drag.icon, drag.kind === "collection" ? FileText : Layers3);
  return (
    <div className="tree-drag-preview">
      <span className={cx("node-icon", `node-icon--${drag.nodeKind || "content"}`)}>
        <Icon size={14} />
      </span>
      <span>
        <small>Moving</small>
        <strong>{drag.label}</strong>
      </span>
    </div>
  );
}

function CollectionTreeRow({
  item,
  depth,
  childrenCount,
  isExpanded,
  selected,
  dragEnabled,
  insideDrop,
  onSelect,
  onToggle
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setDraggableNodeRef
  } = useDraggable({
    id: `collection-node:${item.id}`,
    data: {
      kind: "collection",
      item,
      label: item.title,
      icon: "file-text",
      nodeKind: "document"
    },
    disabled: !dragEnabled
  });
  const { isOver: isInsideDropOver, setNodeRef: setInsideDropRef } = useDroppable({
    id: `collection-inside:${item.id}`,
    data: insideDrop ?? {},
    disabled: !insideDrop
  });
  return (
    <button
      ref={setDraggableNodeRef}
      type="button"
      className={cx(
        "tree-row",
        item.hidden && "tree-row--hidden",
        selected && "tree-row--selected",
        dragEnabled && "tree-row--draggable",
        insideDrop && "tree-row--drop-available",
        insideDrop && isInsideDropOver && "tree-row--drop-inside",
        isDragging && "tree-row--dragging"
      )}
      style={{ "--depth": depth }}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item.id, event);
      }}
      {...attributes}
      {...listeners}
    >
      <span ref={setInsideDropRef} className="tree-row__inside-drop-target" />
      <span
        className={cx("tree-row__toggle", !childrenCount && "is-empty")}
        onClick={(event) => {
          event.stopPropagation();
          if (childrenCount) onToggle(item.id);
        }}
      >
        {childrenCount &&
          (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </span>
      <FileText size={15} strokeWidth={1.7} />
      <span className="tree-row__label">{item.title}</span>
      {item.hidden && (
        <EyeOff className="tree-row__visibility" size={13} aria-label="Page hidden" />
      )}
    </button>
  );
}

function CollectionTree({
  items,
  collection,
  selectedIds,
  selectionAnchor,
  onSelectionChange,
  expanded,
  onToggle,
  onMove,
  dragEnabled,
  search
}) {
  const hierarchy = useMemo(() => buildHierarchy(items), [items]);
  const [activeDrag, setActiveDrag] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const normalizedSearch = search.trim().toLowerCase();

  const visibleIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const itemsByHierarchyId = new Map(
      items.map((item) => [item.hierarchy_id || item.id, item])
    );
    const matching = new Set(
      items
        .filter(
          (item) =>
            item.title.toLowerCase().includes(normalizedSearch) ||
            item.id.toLowerCase().includes(normalizedSearch)
        )
        .map((item) => item.id)
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of items) {
        const parentItem = item.parent ? itemsByHierarchyId.get(item.parent) : null;
        if (matching.has(item.id) && parentItem && !matching.has(parentItem.id)) {
          matching.add(parentItem.id);
          changed = true;
        }
      }
    }
    return matching;
  }, [items, normalizedSearch]);

  const orderedIds = useMemo(() => {
    const result = [];
    const walk = (parent = null) => {
      const branch = (hierarchy.get(parent) ?? []).filter(
        (item) => !visibleIds || visibleIds.has(item.id)
      );
      for (const item of branch) {
        result.push(item.id);
        if (normalizedSearch || expanded.has(item.id)) {
          walk(item.hierarchy_id || item.id);
        }
      }
    };
    walk();
    return result;
  }, [expanded, hierarchy, normalizedSearch, visibleIds]);

  function selectItem(id, event) {
    const next = nextTreeSelection(
      selectedIds,
      selectionAnchor,
      id,
      orderedIds,
      event
    );
    onSelectionChange({ ...next, activeId: id });
  }

  function canDropAt(parent, targetId, position) {
    const draggedItem = activeDrag?.item;
    if (!draggedItem) return false;
    const rootTypes = collection.allowed_types ?? [collection.node_type];
    const childTypes = collection.hierarchy?.allowed_child_types ?? rootTypes;
    if (parent === null) {
      if (!rootTypes.includes(draggedItem.type)) return false;
    } else {
      if (!collection.hierarchy?.enabled || !childTypes.includes(draggedItem.type)) {
        return false;
      }
    }

    const draggedHierarchyId = draggedItem.hierarchy_id || draggedItem.id;
    let ancestor = parent;
    while (ancestor) {
      if (ancestor === draggedHierarchyId) return false;
      ancestor =
        items.find((item) => (item.hierarchy_id || item.id) === ancestor)?.parent ?? null;
    }
    if (targetId === draggedItem.id) return false;
    if (position === "inside") {
      const children = hierarchy.get(parent) ?? [];
      const isAlreadyLast =
        (draggedItem.parent ?? null) === parent &&
        children.at(-1)?.id === draggedItem.id;
      return !isAlreadyLast;
    }
    if ((draggedItem.parent ?? null) === (parent ?? null)) {
      const siblings = (hierarchy.get(parent) ?? []).filter(
        (item) => !visibleIds || visibleIds.has(item.id)
      );
      const sourceIndex = siblings.findIndex((item) => item.id === draggedItem.id);
      let targetIndex = siblings.findIndex((item) => item.id === targetId);
      if (position === "after") targetIndex += 1;
      if (sourceIndex !== -1 && sourceIndex < targetIndex) targetIndex -= 1;
      if (sourceIndex === targetIndex) return false;
    }
    return true;
  }

  function renderBranch(parent = null, depth = 0) {
    const branch = (hierarchy.get(parent) ?? []).filter(
      (item) => !visibleIds || visibleIds.has(item.id)
    );
    return branch.map((item, index) => {
      const children = hierarchy.get(item.hierarchy_id || item.id) ?? [];
      const isExpanded = normalizedSearch || expanded.has(item.id);
      const dropBase = `${parent || "root"}:${item.id}`;
      const insideParent = item.hierarchy_id || item.id;
      const insideDropEnabled = canDropAt(insideParent, item.id, "inside");
      return (
        <div key={item.id} className="tree-dnd-branch">
          <TreeDropLine
            id={`collection-drop:${dropBase}:before`}
            data={{ kind: "collection-drop", parent, targetId: item.id, position: "before" }}
            enabled={canDropAt(parent, item.id, "before")}
            visible={Boolean(activeDrag) && canDropAt(parent, item.id, "before")}
            depth={depth}
          />
          <CollectionTreeRow
            item={item}
            depth={depth}
            childrenCount={children.length}
            isExpanded={isExpanded}
            selected={selectedIds.has(item.id)}
            dragEnabled={dragEnabled}
            insideDrop={
              insideDropEnabled
                ? {
                    kind: "collection-drop",
                    parent: insideParent,
                    targetId: item.id,
                    position: "inside"
                  }
                : null
            }
            onSelect={selectItem}
            onToggle={onToggle}
          />
          {children.length > 0 &&
            isExpanded &&
            renderBranch(item.hierarchy_id || item.id, depth + 1)}
          {index === branch.length - 1 && (
            <TreeDropLine
              id={`collection-drop:${dropBase}:after`}
              data={{ kind: "collection-drop", parent, targetId: item.id, position: "after" }}
              enabled={canDropAt(parent, item.id, "after")}
              visible={Boolean(activeDrag) && canDropAt(parent, item.id, "after")}
              depth={depth}
            />
          )}
        </div>
      );
    });
  }

  if (!items.length) {
    return <EmptyState title="No content yet">Create the first item in this collection.</EmptyState>;
  }

  return (
    <DndContext
      sensors={sensors}
      autoScroll={TREE_AUTO_SCROLL}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveDrag(active.data.current)}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={({ active, over }) => {
        const drag = active.data.current;
        const drop = over?.data.current;
        setActiveDrag(null);
        if (drag && drop) onMove(drag, drop);
      }}
    >
      <div className="tree">{renderBranch()}</div>
      <DragOverlay dropAnimation={null} modifiers={DRAG_OVERLAY_MODIFIERS}>
        <DragPreview drag={activeDrag} />
      </DragOverlay>
    </DndContext>
  );
}

function ContentNodeRow({
  node,
  type,
  label,
  depth,
  isRoot,
  hasChildren,
  isExpanded,
  selected,
  source,
  dragEnabled,
  insideDrop,
  onSelect,
  onToggle
}) {
  const Icon = iconFor(type.icon, isRoot ? FileText : Layers3);
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setDraggableNodeRef
  } = useDraggable({
    id: `content-node:${node.id}`,
    data: {
      kind: "content",
      nodeId: node.id,
      type: node.type,
      label,
      icon: type.icon,
      nodeKind: type.kind,
      source,
      descendantIds: [...descendantIds(node)]
    },
    disabled: isRoot || !dragEnabled
  });
  const { isOver: isInsideDropOver, setNodeRef: setInsideDropRef } = useDroppable({
    id: `content-inside:${node.id}`,
    data: insideDrop ?? {},
    disabled: !insideDrop
  });
  return (
    <button
      ref={setDraggableNodeRef}
      type="button"
      className={cx(
        "tree-row tree-row--content",
        node.properties?.hidden && "tree-row--hidden",
        selected && "tree-row--selected",
        !isRoot && dragEnabled && "tree-row--draggable",
        insideDrop && "tree-row--drop-available",
        insideDrop && isInsideDropOver && "tree-row--drop-inside",
        isDragging && "tree-row--dragging"
      )}
      style={{ "--depth": depth }}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id, event);
      }}
      {...attributes}
      {...listeners}
    >
      <span ref={setInsideDropRef} className="tree-row__inside-drop-target" />
      <span
        className={cx("tree-row__toggle", !hasChildren && "is-empty")}
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) onToggle(node.id);
        }}
      >
        {hasChildren &&
          (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </span>
      <span className={cx("node-icon", `node-icon--${type.kind || "content"}`)}>
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <span className="tree-row__label">{label}</span>
      {node.properties?.hidden && (
        <EyeOff className="tree-row__visibility" size={13} aria-label="Hidden" />
      )}
      <span className="tree-row__type">{isRoot ? "Page" : type.label}</span>
    </button>
  );
}

function ContentTree({
  record,
  nodeTypes,
  selectedIds,
  selectionAnchor,
  onSelectionChange,
  expanded,
  onToggle,
  onMove,
  dragEnabled
}) {
  const [activeDrag, setActiveDrag] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const orderedIds = useMemo(() => {
    const result = [];
    const walk = (node) => {
      result.push(node.id);
      if (!expanded.has(node.id)) return;
      for (const children of Object.values(node.slots ?? {})) {
        children.forEach(walk);
      }
    };
    if (record) walk(record);
    return result;
  }, [expanded, record]);

  function selectItem(id, event) {
    const next = nextTreeSelection(
      selectedIds,
      selectionAnchor,
      id,
      orderedIds,
      event
    );
    onSelectionChange({ ...next, activeId: id });
  }

  function canDropAt(parentId, slotName, targetId, position) {
    if (!activeDrag) return false;
    if (activeDrag.descendantIds.includes(parentId) || activeDrag.nodeId === parentId) {
      return false;
    }
    const parent = getNode(record, parentId);
    const slot = nodeTypes[parent?.type]?.slots?.[slotName];
    if (!slot?.allowed_types?.includes(activeDrag.type)) return false;
    const targetChildren = parent?.slots?.[slotName] ?? [];
    const sameSlot =
      activeDrag.source?.parentId === parentId && activeDrag.source?.slotName === slotName;
    if (!sameSlot && slot.max && targetChildren.length >= slot.max) return false;
    if (targetId === activeDrag.nodeId) return false;
    if (sameSlot) {
      const sourceIndex = targetChildren.findIndex(
        (child) => child.id === activeDrag.nodeId
      );
      let targetIndex =
        position === "inside"
          ? targetChildren.length
          : targetChildren.findIndex((child) => child.id === targetId);
      if (position === "after") targetIndex += 1;
      if (sourceIndex !== -1 && sourceIndex < targetIndex) targetIndex -= 1;
      if (sourceIndex === targetIndex) return false;
    }
    return true;
  }

  function renderNode(node, depth = 0, isRoot = false, source = null, isLast = false) {
    const type = nodeTypes[node.type] ?? {};
    const childEntries = Object.entries(node.slots ?? {}).filter(([, children]) => children.length);
    const hasChildren = childEntries.length > 0;
    const isExpanded = expanded.has(node.id);
    const label =
      node.properties?.title ||
      node.properties?.heading ||
      node.properties?.alt ||
      type.label ||
      node.type;
    const dropBase = source
      ? `${source.parentId}:${source.slotName}:${node.id}`
      : null;
    const insideDrop = Object.keys(type.slots ?? {}).reduce(
      (result, slotName) => {
        if (result) return result;
        if (!canDropAt(node.id, slotName, node.id, "inside")) return null;
        return {
          kind: "content-drop",
          parentId: node.id,
          slotName,
          targetId: node.id,
          position: "inside"
        };
      },
      null
    );

    return (
      <div key={node.id} className={cx("content-branch", isLast && "is-last")}>
        {source && (
          <TreeDropLine
            id={`content-drop:${dropBase}:before`}
            data={{
              kind: "content-drop",
              parentId: source.parentId,
              slotName: source.slotName,
              targetId: node.id,
              position: "before"
            }}
            enabled={canDropAt(source.parentId, source.slotName, node.id, "before")}
            visible={
              Boolean(activeDrag) &&
              canDropAt(source.parentId, source.slotName, node.id, "before")
            }
            depth={depth}
          />
        )}
        <ContentNodeRow
          node={node}
          type={type}
          label={label}
          depth={depth}
          isRoot={isRoot}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          selected={selectedIds.has(node.id)}
          source={source}
          dragEnabled={dragEnabled}
          insideDrop={insideDrop}
          onSelect={selectItem}
          onToggle={onToggle}
        />
        {hasChildren &&
          isExpanded &&
          childEntries.map(([slotName, children]) => {
            const showSlot = Object.keys(node.slots ?? {}).length > 1;
            return (
              <div key={slotName}>
                {showSlot && (
                  <div className="slot-label" style={{ "--depth": depth + 1 }}>
                    {type.slots?.[slotName]?.label || slotName}
                  </div>
                )}
                {children.map((child, index) =>
                  renderNode(
                    child,
                    depth + 1 + (showSlot ? 1 : 0),
                    false,
                    { parentId: node.id, slotName, index },
                    index === children.length - 1
                  )
                )}
              </div>
            );
          })}
        {source && isLast && (
          <TreeDropLine
            id={`content-drop:${dropBase}:after`}
            data={{
              kind: "content-drop",
              parentId: source.parentId,
              slotName: source.slotName,
              targetId: node.id,
              position: "after"
            }}
            enabled={canDropAt(source.parentId, source.slotName, node.id, "after")}
            visible={
              Boolean(activeDrag) &&
              canDropAt(source.parentId, source.slotName, node.id, "after")
            }
            depth={depth}
          />
        )}
      </div>
    );
  }

  if (!record) return null;
  return (
    <DndContext
      sensors={sensors}
      autoScroll={TREE_AUTO_SCROLL}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveDrag(active.data.current)}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={({ active, over }) => {
        const drag = active.data.current;
        const drop = over?.data.current;
        setActiveDrag(null);
        if (drag && drop) onMove(drag, drop);
      }}
    >
      <div className="tree content-tree">{renderNode(record, 0, true, null, true)}</div>
      <DragOverlay dropAnimation={null} modifiers={DRAG_OVERLAY_MODIFIERS}>
        <DragPreview drag={activeDrag} />
      </DragOverlay>
    </DndContext>
  );
}

function ImageUploadField({ id, field, value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadMedia(file);
      onChange(result.path);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="image-field">
      <div className="image-field__preview">
        {value ? (
          <img src={value} alt="" />
        ) : (
          <>
            <Image size={20} />
            <span>No image uploaded</span>
          </>
        )}
      </div>
      <div className="image-field__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner small /> : <Upload size={14} />}
          {value ? "Replace image" : "Upload image"}
        </button>
        {value && field.required === false && (
          <button
            type="button"
            className="button button--secondary"
            disabled={uploading}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      {value && <code className="image-field__path">{value}</code>}
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden"
        type="file"
        accept={field.accept || "image/jpeg,image/png,image/gif,image/webp,image/avif"}
        onChange={upload}
      />
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function referenceItemValue(item, name) {
  if (!name || name === "id" || name === "$id") return item.id;
  return item.properties?.[name] ?? item[name] ?? "";
}

function ReferenceCard({ item, view, compact = false }) {
  const image = referenceItemValue(item, view.image);
  const title =
    referenceItemValue(item, view.title || "title") || item.title || item.id;
  const descriptions = (Array.isArray(view.description)
    ? view.description
    : view.description
      ? [view.description]
      : []
  )
    .map((name) => referenceItemValue(item, name))
    .filter(Boolean);
  return (
    <span className={cx("reference-card", compact && "reference-card--compact")}>
      <span className="reference-card__image">
        {image ? <img src={image} alt="" /> : <Image size={18} />}
      </span>
      <span className="reference-card__body">
        <strong>{title}</strong>
        {descriptions.map((description, index) => (
          <small key={`${description}-${index}`}>{description}</small>
        ))}
      </span>
    </span>
  );
}

function ReferenceField({ field, value, onChange, collections }) {
  const targetCollection = collections.find(
    (collection) => collection.name === field.collection
  );
  const referenceView = targetCollection?.views?.reference ?? {};
  const valueField = field.value_field || referenceView.value || "id";
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selected = items.find(
    (item) => referenceItemValue(item, valueField) === value
  );

  useEffect(() => {
    if (!targetCollection) return;
    let cancelled = false;
    setLoading(true);
    api
      .list(targetCollection.name)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetCollection?.name]);

  useEffect(() => {
    if (!open) return undefined;
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = normalizedSearch
    ? items.filter((item) => {
        const values = [
          item.id,
          item.title,
          ...Object.values(item.properties ?? {})
        ];
        return values.some((entry) =>
          String(entry).toLocaleLowerCase().includes(normalizedSearch)
        );
      })
    : items;

  if (!targetCollection) {
    return (
      <div className="inline-error">
        <CircleAlert size={15} />
        Collection “{field.collection}” does not exist.
      </div>
    );
  }

  return (
    <div className="reference-field">
      {selected ? (
        <ReferenceCard item={selected} view={referenceView} compact />
      ) : value ? (
        <div className="reference-field__missing">
          <CircleAlert size={15} />
          Missing reference <code>{value}</code>
        </div>
      ) : (
        <div className="reference-field__empty">No image selected</div>
      )}
      <div className="reference-field__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setOpen(true)}
        >
          <Search size={14} />
          {value ? "Change image" : "Choose image"}
        </button>
        {value && field.required === false && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      {error && <small className="field-error">{error}</small>}
      {open && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog reference-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-dialog-title"
          >
            <div className="dialog__top">
              <span className="dialog__icon">
                <Image size={18} />
              </span>
              <div>
                <h2 id="reference-dialog-title">
                  Choose {targetCollection.label_singular}
                </h2>
                <p>
                  Select an entry from the {targetCollection.label} collection.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog__body reference-dialog__body">
              <div className="insertion-dialog__search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${targetCollection.label.toLowerCase()}…`}
                  autoFocus
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="reference-dialog__items">
                {visibleItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={cx(
                      referenceItemValue(item, valueField) === value &&
                        "is-selected"
                    )}
                    onClick={() => {
                      onChange(referenceItemValue(item, valueField));
                      setOpen(false);
                    }}
                  >
                    <ReferenceCard item={item} view={referenceView} />
                    {referenceItemValue(item, valueField) === value && (
                      <Check size={15} />
                    )}
                  </button>
                ))}
                {!loading && !visibleItems.length && (
                  <EmptyState icon={Image} title="No matching images" />
                )}
                {loading && (
                  <div className="panel-loader">
                    <Spinner />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  idPrefix = "field",
  collections = []
}) {
  const id = `${idPrefix}-${field.name}`;
  const resolvedValue = value ?? defaultFieldValue(field);
  const common = {
    id,
    value: resolvedValue,
    onChange: (event) => onChange(event.target.value)
  };

  let control;
  if (field.widget === "boolean") {
    control = (
      <button
        type="button"
        id={id}
        className={cx("switch", resolvedValue && "switch--on")}
        role="switch"
        aria-checked={Boolean(resolvedValue)}
        onClick={() => onChange(!resolvedValue)}
      >
        <span />
      </button>
    );
  } else if (field.widget === "select") {
    control = (
      <div className="select-wrap">
        <select {...common}>
          {(field.options ?? []).map((option) => {
            const optionObject =
              typeof option === "object" ? option : { label: option, value: option };
            return (
              <option key={optionObject.value} value={optionObject.value}>
                {optionObject.label}
              </option>
            );
          })}
        </select>
        <ChevronDown size={14} />
      </div>
    );
  } else if (["text", "markdown"].includes(field.widget)) {
    control = (
      <textarea
        {...common}
        rows={field.widget === "markdown" ? 7 : 3}
        placeholder={field.hint || ""}
      />
    );
  } else if (field.widget === "uuid") {
    control = (
      <div className="uuid-field">
        <input
          {...common}
          type="text"
          readOnly={field.readonly !== false}
          spellCheck="false"
          placeholder="Generated UUID"
        />
        <span>UUID</span>
      </div>
    );
  } else if (field.widget === "image") {
    control = (
      <ImageUploadField
        id={id}
        field={field}
        value={resolvedValue}
        onChange={onChange}
      />
    );
  } else if (field.widget === "reference") {
    control = (
      <ReferenceField
        field={field}
        value={resolvedValue}
        onChange={onChange}
        collections={collections}
      />
    );
  } else {
    control = (
      <input
        {...common}
        type={
          field.widget === "datetime"
            ? "date"
            : field.widget === "number"
              ? "number"
              : "text"
        }
        placeholder={field.hint || ""}
      />
    );
  }

  return (
    <div className={cx("field", field.widget === "boolean" && "field--inline")}>
      <div className="field__heading">
        <label htmlFor={id}>{field.label || field.name}</label>
        {field.required === false && <span>Optional</span>}
      </div>
      {control}
      {field.hint && field.widget !== "string" && <small>{field.hint}</small>}
    </div>
  );
}

function displayValue(value, field) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.display === "date" || field.widget === "datetime") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return field.display === "datetime"
        ? date.toLocaleString()
        : date.toLocaleDateString();
    }
  }
  if (field.widget === "select") {
    const option = field.options?.find((candidate) =>
      typeof candidate === "object"
        ? candidate.value === value
        : candidate === value
    );
    if (option && typeof option === "object") return option.label;
  }
  return String(value);
}

function systemFieldValue(name, record, collection, item) {
  const extension = String(collection.extension || "yml").replace(/^\./, "");
  const fileName = `${record.id}.${extension}`;
  if (name === "$id") return record.id;
  if (name === "$filename") return fileName;
  if (name === "$storage_path") {
    return `${String(collection.folder).replace(/\/$/, "")}/${fileName}`;
  }
  if (name === "$updated_at") return item?.updated_at;
  if (name === "$created_at") return item?.created_at;
  return "";
}

function ReadOnlyDetailField({ field, value, action }) {
  const formatted = displayValue(value, field);
  const content =
    field.display === "code" ? (
      <code>{formatted}</code>
    ) : field.display === "badge" ? (
      <span className="detail-value__badge">{formatted}</span>
    ) : (
      <span>{formatted}</span>
    );
  return (
    <div
      className={cx(
        "detail-value",
        field.appearance && `detail-value--${field.appearance}`
      )}
    >
      <span className="detail-value__label">{field.label || field.name}</span>
      <div className="detail-value__content">
        {content}
        {action}
      </div>
    </div>
  );
}

const SYSTEM_FIELD_DEFINITIONS = {
  $id: { label: "Record ID", display: "code" },
  $filename: { label: "File name", display: "code" },
  $storage_path: { label: "Storage path", display: "code" },
  $updated_at: { label: "Updated", display: "datetime" },
  $created_at: { label: "Created", display: "datetime" }
};

function detailField(type, reference) {
  const configuration =
    typeof reference === "string" ? { field: reference } : reference;
  const name = configuration?.field;
  if (!name) return null;
  if (name.startsWith("$")) {
    const systemField = SYSTEM_FIELD_DEFINITIONS[name];
    return systemField
      ? {
          name,
          system: true,
          mode: "read",
          ...systemField,
          ...configuration
        }
      : null;
  }
  const field = typeField(type, name);
  return field
    ? {
        mode: "edit",
        ...field,
        ...configuration,
        name
      }
    : null;
}

function panelsFor(type, includeInfo = false) {
  const configuredPanels = type?.views?.detail?.panels ?? {};
  let panels = Object.entries(configuredPanels)
    .filter(([name]) => name !== "info")
    .map(([name, panel], index) => ({
      name,
      label: panel.label || name,
      position: panel.position ?? index,
      groups: panel.groups ?? {}
    }));
  if (!panels.length) {
    panels = [
      {
        name: "inspector",
        label: "Inspector",
        position: 0,
        groups: {}
      }
    ];
  }
  if (includeInfo) {
    const configuredInfo = configuredPanels.info ?? {};
    panels.push({
      name: "info",
      label: configuredInfo.label || "Info",
      position: configuredInfo.position ?? 1000,
      groups: configuredInfo.groups ?? {}
    });
  }
  return panels.sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label)
  );
}

function groupsForPanel(type, panelName, includeInfo = false) {
  const panels = panelsFor(type, includeInfo);
  const activePanel = panels.find((panel) => panel.name === panelName) || panels[0];
  const definitions = activePanel.groups;
  let groups = Object.entries(definitions)
    .map(([name, definition], index) => ({
      name,
      label: definition.label || name,
      icon: definition.icon,
      description: definition.description,
      position: definition.position ?? index,
      fields: (definition.fields ?? [])
        .map((reference) => detailField(type, reference))
        .filter(Boolean)
    }))
    .filter((group) => group.fields.length)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));

  if (!groups.length && activePanel.name === panels[0].name) {
    groups = [
      {
        name: "properties",
        label: "Properties",
        position: 0,
        fields: typeFields(type).map((field) => ({
          mode: "edit",
          ...field
        }))
      }
    ];
  }

  if (activePanel.name === "info") {
    const configuredNames = new Set(
      groups.flatMap((group) => group.fields.map((field) => field.name))
    );
    const missingSystemFields = ["$filename", "$storage_path"].filter(
      (name) => !configuredNames.has(name)
    );
    if (missingSystemFields.length) {
      groups.push({
        name: "stored_file",
        label: "Stored file",
        icon: "file-text",
        description: "Repository-relative collection record location.",
        position: 1000,
        fields: missingSystemFields.map((name) => detailField(type, name))
      });
    }
  }
  return groups;
}

function InspectorGroup({ group, children }) {
  const [open, setOpen] = useState(true);
  const GroupIcon = iconFor(group.icon, Settings2);
  return (
    <section className={cx("inspector-group", open && "inspector-group--open")}>
      <button
        type="button"
        className="inspector-group__heading"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="inspector-group__icon">
          <GroupIcon size={14} />
        </span>
        <span className="inspector-group__title">
          <strong>{group.label}</strong>
          {group.description && <small>{group.description}</small>}
        </span>
        <span className="inspector-group__count">{group.fields?.length ?? 1}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="inspector-group__content">{children}</div>}
    </section>
  );
}

function Inspector({
  record,
  selectedId,
  nodeTypes,
  collection,
  collections,
  items,
  activePanel,
  onPropertyChange,
  onMove,
  onDelete,
  onDuplicate,
  onDuplicateRecord,
  onDeleteRecord,
  onRenameFile,
  renameDisabled
}) {
  const node = getNode(record, selectedId);
  if (!node) {
    return <EmptyState title="Nothing selected">Choose an item from the content tree.</EmptyState>;
  }
  const type = nodeTypes[node.type] ?? { fields: [], label: node.type };
  const TypeIcon = iconFor(type.icon, Layers3);
  const isDocument = node.id === record.id;
  const location = isDocument ? null : findLocation(record, node.id);
  const panels = panelsFor(type, isDocument);
  const currentPanel =
    panels.find((panel) => panel.name === activePanel) || panels[0];
  const groups = groupsForPanel(type, currentPanel.name, isDocument);
  const isPrimaryPanel = currentPanel.name === panels[0].name;
  const fieldCount =
    groups.reduce((total, group) => total + group.fields.length, 0) +
    (isPrimaryPanel && isDocument && collection.hierarchy?.enabled ? 1 : 0);
  const currentItem = items.find((item) => item.id === record.id);
  const hierarchyParentValue = collectionHierarchyValue(
    record,
    collection,
    "parent_field",
    record.parent ?? null
  );
  const hierarchyParentItem = items.find(
    (item) => (item.hierarchy_id || item.id) === hierarchyParentValue
  );
  return (
    <div className="inspector">
      <div className="inspector__identity">
        <span className={cx("node-icon", `node-icon--${type.kind || "content"}`)}>
          <TypeIcon size={16} />
        </span>
        <div>
          <strong>{type.label || node.type}</strong>
          <span>{node.id}</span>
        </div>
        {isDocument ? (
          <div className="inspector__actions">
            <button type="button" title="Duplicate" onClick={onDuplicateRecord}>
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="danger"
              title={`Delete ${collection.label_singular}`}
              onClick={onDeleteRecord}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div className="inspector__actions">
            <button type="button" title="Move up" onClick={() => onMove(-1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" title="Move down" onClick={() => onMove(1)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" title="Duplicate" onClick={onDuplicate}>
              <Copy size={14} />
            </button>
            <button type="button" className="danger" title="Remove" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="inspector__section-label">
        <span>{currentPanel.label}</span>
        <span>{fieldCount}</span>
      </div>

      <div className="inspector__fields">
        {isPrimaryPanel && isDocument && collection.hierarchy?.enabled && (
          <InspectorGroup
            key={`${node.id}-hierarchy`}
            group={{
              label: "Hierarchy",
              icon: "layers",
              description: `Move this ${collection.label_singular?.toLowerCase() || "record"} in the ${collection.label} tree to change its position.`,
              fields: [{ name: "parent" }]
            }}
          >
            <dl className="record-info hierarchy-info">
              <div>
                <dt>
                  Parent {collection.label_singular?.toLowerCase() || "record"}
                </dt>
                <dd>
                  <span className="hierarchy-info__label">
                    {hierarchyParentValue
                      ? hierarchyParentItem?.title || "Unknown parent"
                      : "Top level"}
                  </span>
                  {hierarchyParentValue && (
                    <code>{hierarchyParentValue}</code>
                  )}
                </dd>
              </div>
            </dl>
          </InspectorGroup>
        )}

        {groups.map((group) => (
          <InspectorGroup
            key={`${node.id}-${currentPanel.name}-${group.name}`}
            group={group}
          >
            {group.fields.map((field) => (
              field.system || field.mode === "read" ? (
                <ReadOnlyDetailField
                  key={field.name}
                  field={field}
                  value={
                    field.system
                      ? systemFieldValue(
                          field.name,
                          record,
                          collection,
                          currentItem
                        )
                      : node.properties?.[field.name]
                  }
                  action={
                    field.name === "$filename" && collection.slug ? (
                      <button
                        type="button"
                        className="detail-value__action"
                        title="Regenerate filename from configuration"
                        aria-label="Regenerate filename from the configured slug"
                        disabled={renameDisabled}
                        onClick={onRenameFile}
                      >
                        <RefreshCw size={14} />
                      </button>
                    ) : null
                  }
                />
              ) : (
                <Field
                  key={field.name}
                  field={field}
                  value={node.properties?.[field.name]}
                  collections={collections}
                  onChange={(value) =>
                    onPropertyChange(node.id, field.name, value)
                  }
                />
              )
            ))}
          </InspectorGroup>
        ))}

        {!groups.length &&
          !(isPrimaryPanel && isDocument && collection.hierarchy?.enabled) && (
            <EmptyState icon={Settings2} title="No fields configured">
              Assign fields to a group in this panel in cms.config.yml.
            </EmptyState>
          )}
      </div>

      {!isDocument && location && (
        <div className="inspector__footer">
          <span>
            Position {location.index + 1} of {location.children.length}
          </span>
          <code>{location.slotName}</code>
        </div>
      )}
    </div>
  );
}

function AddMenu({ record, selectedId, nodeTypes, onAdd, compact = false }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const selected = getNode(record, selectedId);
  const selectedType = selected ? nodeTypes[selected.type] : null;
  let target = null;

  const directSlot = Object.entries(selectedType?.slots ?? {}).find(([slotName, slot]) => {
    const length = selected?.slots?.[slotName]?.length ?? 0;
    return !slot.max || length < slot.max;
  });
  if (directSlot) {
    target = {
      parentId: selected.id,
      slotName: directSlot[0],
      slot: directSlot[1],
      mode: "inside"
    };
  } else if (record && selectedId !== record.id) {
    const location = findLocation(record, selectedId);
    const parent = location ? getNode(record, location.parentId) : null;
    const slot = parent ? nodeTypes[parent.type]?.slots?.[location.slotName] : null;
    const length = location?.children.length ?? 0;
    if (slot && (!slot.max || length < slot.max)) {
      target = {
        parentId: parent.id,
        slotName: location.slotName,
        slot,
        afterId: selectedId,
        mode: "after"
      };
    }
  }

  useEffect(() => {
    function close(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const options = target?.slot.allowed_types ?? [];
  return (
    <div className={cx("add-menu", compact && "add-menu--compact")} ref={menuRef}>
      <button
        type="button"
        className="add-menu__trigger"
        title={
          target?.mode === "after"
            ? "Add after selection"
            : target
              ? "Add content"
              : "The selected node cannot contain content"
        }
        disabled={!target || !options.length}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={15} />
        {!compact && (
          <>
            <span>{target?.mode === "after" ? "Add after selection" : "Add content"}</span>
            <ChevronDown size={14} />
          </>
        )}
      </button>
      {open && (
        <div className="add-menu__popover">
          <div className="add-menu__title">
            <span>Add to {target.slot.label || target.slotName}</span>
            <button type="button" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          {options.map((typeName) => {
            const type = nodeTypes[typeName];
            const Icon = iconFor(type?.icon, Layers3);
            return (
              <button
                type="button"
                key={typeName}
                onClick={() => {
                  onAdd(target, typeName);
                  setOpen(false);
                }}
              >
                <span className={cx("node-icon", `node-icon--${type?.kind || "content"}`)}>
                  <Icon size={15} />
                </span>
                <span>
                  <strong>{type?.label || typeName}</strong>
                  <small>{type?.kind || "content"}</small>
                </span>
                <Plus size={14} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getTableValue(item, fieldName, collection) {
  if (!fieldName) return "";
  if (fieldName === "$id") return item.id;
  if (fieldName === "$filename") {
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    return `${item.id}.${extension}`;
  }
  if (fieldName === "$storage_path") {
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    return `${String(collection.folder).replace(/\/$/, "")}/${item.id}.${extension}`;
  }
  if (fieldName === "$updated_at") return item.updated_at;
  if (fieldName === "$created_at") return item.created_at;
  if (fieldName.startsWith("properties.")) {
    return fieldName
      .slice("properties.".length)
      .split(".")
      .reduce((value, key) => value?.[key], item.properties);
  }
  return item.properties?.[fieldName] ?? item[fieldName] ?? "";
}

function configuredTableField(item, column, nodeTypes) {
  const base = column.field.startsWith("$")
    ? SYSTEM_FIELD_DEFINITIONS[column.field] ?? {}
    : typeField(
        nodeTypes[item.type],
        column.field.replace(/^properties\./, "")
      ) ?? {};
  return { ...base, ...column };
}

function formatTableValue(item, column, nodeTypes, collection) {
  return displayValue(
    getTableValue(item, column.field, collection),
    configuredTableField(item, column, nodeTypes)
  );
}

function TableCell({
  item,
  column,
  nodeTypes,
  collection,
  editing,
  onEdit
}) {
  const field = configuredTableField(item, column, nodeTypes);
  const value = getTableValue(item, column.field, collection);
  const formatted = displayValue(value, field);
  const editable =
    column.mode === "edit" &&
    !column.field.startsWith("$") &&
    field.readonly !== true;
  const [draftValue, setDraftValue] = useState(value ?? "");

  useEffect(() => {
    setDraftValue(value ?? "");
  }, [value]);

  function commitDraft() {
    const nextValue =
      field.widget === "number" && draftValue !== ""
        ? Number(draftValue)
        : draftValue;
    if (nextValue !== value) onEdit(item, column, nextValue);
  }

  let content;

  if (editable && (field.display === "toggle" || field.widget === "boolean")) {
    content = (
      <button
        type="button"
        className={cx("switch table-cell__toggle", value && "switch--on")}
        role="switch"
        aria-label={`${field.label || field.name}: ${value ? "Yes" : "No"}`}
        aria-checked={Boolean(value)}
        disabled={editing}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(item, column, !value);
        }}
      >
        <span />
      </button>
    );
  } else if (editable && field.widget === "select") {
    content = (
      <div className="select-wrap table-cell__select">
        <select
          value={value ?? ""}
          aria-label={field.label || field.name}
          disabled={editing}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            onEdit(item, column, event.target.value);
          }}
        >
          {(field.options ?? []).map((option) => {
            const configuredOption =
              typeof option === "object"
                ? option
                : { label: option, value: option };
            return (
              <option key={configuredOption.value} value={configuredOption.value}>
                {configuredOption.label}
              </option>
            );
          })}
        </select>
        <ChevronDown size={13} />
      </div>
    );
  } else if (editable) {
    content = (
      <input
        className="table-cell__input"
        type={
          field.widget === "datetime"
            ? "date"
            : field.widget === "number"
              ? "number"
              : "text"
        }
        value={draftValue}
        aria-label={field.label || field.name}
        disabled={editing}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            setDraftValue(value ?? "");
          }
        }}
      />
    );
  } else if (field.display === "image") {
    content = value ? (
      <img className="table-cell__image" src={value} alt="" />
    ) : (
      <span className="table-cell__image-placeholder">
        <Image size={16} />
      </span>
    );
  } else if (field.display === "badge") {
    content = <span className="table-cell__badge">{formatted}</span>;
  } else if (field.display === "code") {
    content = <code>{formatted}</code>;
  } else {
    content = formatted;
  }

  return (
    <td
      className={cx(
        column.align && `table-cell--${column.align}`,
        column.appearance && `table-cell--${column.appearance}`
      )}
      title={formatted}
    >
      {content}
    </td>
  );
}

function CollectionTable({
  collection,
  items,
  nodeTypes,
  selectedId,
  loading,
  search,
  editing,
  onSearch,
  onSelect,
  onCreate,
  onEdit
}) {
  const listView = collection.views?.list ?? {};
  const columns = useMemo(() => {
    const configured = listView.columns ?? [];
    if (configured.length) {
      return configured.map((column) =>
        typeof column === "string"
          ? {
              field: column,
              label:
                typeField(nodeTypes[collection.node_type], column)?.label ||
                SYSTEM_FIELD_DEFINITIONS[column]?.label ||
                column,
              sortable: true,
              mode: "read"
            }
          : {
              mode: "read",
              ...column,
              label:
                column.label ||
                typeField(
                  nodeTypes[collection.node_type],
                  column.field
                )?.label ||
                SYSTEM_FIELD_DEFINITIONS[column.field]?.label ||
                column.field,
              sortable: column.sortable !== false
            }
      );
    }
    const fields = typeFields(nodeTypes[collection.node_type]);
    const inferred = fields.slice(0, 4).map((field) => ({
      field: field.name,
      label: field.label || field.name,
      sortable: true,
      mode: "read"
    }));
    return inferred.length
      ? inferred
      : [{ field: "id", label: "Record ID", sortable: true }];
  }, [collection.node_type, listView.columns, nodeTypes]);
  const [sort, setSort] = useState(() => {
    const configured = listView.sort;
    return {
      field: configured?.field || columns[0]?.field || "title",
      direction: configured?.direction === "desc" ? "desc" : "asc"
    };
  });
  const searchFields = listView.search?.fields?.length
    ? listView.search.fields
    : columns.map((column) => column.field);
  const tableColumns = columns
    .map((column) => column.width || "minmax(8rem, 1fr)")
    .join(" ");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => {
    const filtered = normalizedSearch
      ? items.filter((item) => {
          const values = [
            item.id,
            ...searchFields.map((fieldName) => {
              const column =
                columns.find((candidate) => candidate.field === fieldName) ??
                { field: fieldName };
              return formatTableValue(
                item,
                column,
                nodeTypes,
                collection
              );
            })
          ];
          return values.some((value) =>
            String(value).toLocaleLowerCase().includes(normalizedSearch)
          );
        })
      : [...items];

    return filtered.sort((left, right) => {
      const leftValue = getTableValue(left, sort.field, collection);
      const rightValue = getTableValue(right, sort.field, collection);
      if (leftValue === rightValue) return left.id.localeCompare(right.id);
      if (leftValue === "" || leftValue === null || leftValue === undefined) return 1;
      if (rightValue === "" || rightValue === null || rightValue === undefined) return -1;
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base"
            });
      return sort.direction === "desc" ? -comparison : comparison;
    });
  }, [
    collection,
    columns,
    items,
    nodeTypes,
    normalizedSearch,
    searchFields,
    sort
  ]);

  function changeSort(column) {
    if (!column.sortable) return;
    setSort((current) => ({
      field: column.field,
      direction:
        current.field === column.field && current.direction === "asc"
          ? "desc"
          : "asc"
    }));
  }

  return (
    <section className="table-pane">
      <div className="table-toolbar">
        <div className="table-toolbar__identity">
          <strong>{collection.label}</strong>
          <span>
            {visibleItems.length === items.length
              ? `${items.length} records`
              : `${visibleItems.length} of ${items.length} records`}
          </span>
        </div>
        <div className="search table-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={`Filter ${collection.label.toLowerCase()}…`}
          />
          {search && (
            <button type="button" onClick={() => onSearch("")} title="Clear filter">
              <X size={13} />
            </button>
          )}
        </div>
        <button type="button" className="button table-toolbar__new" onClick={onCreate}>
          <Plus size={15} />
          New {collection.label_singular}
        </button>
      </div>

      <div className="table-scroll">
        <table
          className="collection-table"
          style={{ "--table-columns": tableColumns }}
        >
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sort.field === column.field;
                return (
                  <th
                    key={column.field}
                    className={column.align ? `table-cell--${column.align}` : undefined}
                    aria-sort={
                      isSorted
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      disabled={!column.sortable}
                      onClick={() => changeSort(column)}
                    >
                      <span>{column.label}</span>
                      {isSorted &&
                        (sort.direction === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr
                key={item.id}
                className={cx(
                  item.id === selectedId && "is-selected",
                  item.hidden && "is-hidden"
                )}
                tabIndex={0}
                aria-selected={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(item.id);
                }}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.field}
                    item={item}
                    column={column}
                    nodeTypes={nodeTypes}
                    collection={collection}
                    editing={editing}
                    onEdit={onEdit}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visibleItems.length && (
          <EmptyState
            icon={Search}
            title={search ? "No matching records" : `No ${collection.label.toLowerCase()}`}
          >
            {search
              ? "Try a different filter."
              : `Create the first ${collection.label_singular.toLowerCase()}.`}
          </EmptyState>
        )}
        {loading && !items.length && (
          <div className="panel-loader">
            <Spinner />
          </div>
        )}
      </div>
    </section>
  );
}

function Preview({ record, selectedId, nodeTypes }) {
  const selected = getNode(record, selectedId);
  const type = selected ? nodeTypes[selected.type] : null;
  const title = record?.properties?.title || "Untitled";
  const selectedLabel =
    selected?.properties?.heading ||
    selected?.properties?.title ||
    selected?.properties?.alt ||
    type?.label;

  return (
    <div className="preview">
      <div className="preview__toolbar">
        <div className="device-toggle">
          <button type="button" className="is-active">
            Desktop
          </button>
          <button type="button">Tablet</button>
          <button type="button">Mobile</button>
        </div>
        <span className="preview__scale">Fit · 82%</span>
        <button type="button" className="icon-button" title="More preview options">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="preview__stage">
        <div className="preview__paper">
          <div className="preview__paper-nav">
            <BrandMark />
            <span>BEOWOLF</span>
            <i />
            <i />
            <i />
          </div>
          <div className="preview__paper-body">
            <span className="preview__eyebrow">Preview surface</span>
            <h1>{title}</h1>
            <p>
              The live site preview will be connected here. The editor structure and
              selection context are already in place.
            </p>
            <div className="preview__placeholder">
              <Sparkles size={18} />
              <div>
                <strong>{selectedLabel || "Select a content node"}</strong>
                <span>
                  {selected
                    ? `${type?.label || selected.type} selected in the content tree`
                    : "Selection details will appear here"}
                </span>
              </div>
            </div>
          </div>
          <div className="preview__paper-footer">
            <span>BEOWOLF RESEARCH</span>
            <span>Content preview reserved</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsertionDialog({
  kind,
  modes,
  nodeTypes,
  collection,
  collections,
  existingIds = [],
  onCancel,
  onInsert
}) {
  const initialMode =
    modes.find((mode) => mode.id === "inside" && mode.choices.length) ||
    modes.find((mode) => mode.choices.length) ||
    modes[0];
  const [modeId, setModeId] = useState(initialMode?.id || "inside");
  const [selectedKey, setSelectedKey] = useState(initialMode?.choices[0]?.key || "");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [recordId, setRecordId] = useState("");
  const [propertyOverridesByType, setPropertyOverridesByType] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idWasEdited = useRef(false);
  const creationDate = useRef(new Date()).current;

  const activeMode = modes.find((mode) => mode.id === modeId) || initialMode;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredChoices = (activeMode?.choices ?? []).filter((choice) => {
    const type = nodeTypes[choice.typeName];
    return (
      !normalizedSearch ||
      choice.typeName.toLowerCase().includes(normalizedSearch) ||
      type?.label?.toLowerCase().includes(normalizedSearch) ||
      choice.slotLabel?.toLowerCase().includes(normalizedSearch)
    );
  });
  const selectedChoice =
    activeMode?.choices.find((choice) => choice.key === selectedKey) ||
    activeMode?.choices[0];
  const selectedTypeName = selectedChoice?.typeName;
  const selectedType = nodeTypes[selectedTypeName];
  const identifierField = collection?.identifier_field || "title";
  const initialProperties = useMemo(
    () => defaultProperties(selectedType),
    [selectedTypeName, selectedType]
  );
  const propertyOverrides = propertyOverridesByType[selectedTypeName] ?? {};
  const previewProperties = {
    ...initialProperties,
    ...propertyOverrides,
    title: title.trim()
  };
  const templateFields = collection?.slug
    ? slugTemplateFieldNames(collection.slug, identifierField)
        .filter((name) => name !== "title")
        .map((name) => typeField(selectedType, name))
        .filter(Boolean)
    : [];
  const effectiveRecordId =
    kind === "collection" && collection?.slug
      ? uniqueFilenameStem(
          renderSlugTemplate(collection.slug, {
            fields: previewProperties,
            identifierField,
            date: creationDate
          }),
          new Set(existingIds)
        )
      : recordId;
  const duplicateId =
    kind === "collection" &&
    !collection?.slug &&
    existingIds.includes(effectiveRecordId);
  const canInsert =
    selectedChoice &&
    !busy &&
    (kind !== "collection" ||
      (title.trim() && effectiveRecordId && !duplicateId));

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  function chooseMode(nextMode) {
    if (!nextMode.choices.length) return;
    setModeId(nextMode.id);
    setSelectedKey(nextMode.choices[0]?.key || "");
    setSearch("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!canInsert) return;
    setBusy(true);
    setError("");
    try {
      await onInsert({
        mode: activeMode.id,
        choice: selectedChoice,
        title: title.trim(),
        id: effectiveRecordId,
        properties: previewProperties
      });
    } catch (insertError) {
      setError(insertError.message);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="dialog insertion-dialog" onSubmit={submit}>
        <div className="dialog__top">
          <span className="dialog__icon">
            <Plus size={18} />
          </span>
          <div>
            <h2>{kind === "collection" ? "Insert collection item" : "Insert content"}</h2>
            <p>Choose a position and one of the types allowed by the configuration.</p>
          </div>
          <button type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="insertion-dialog__modes" aria-label="Insertion position">
          {modes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={cx(mode.id === activeMode?.id && "is-active")}
              disabled={!mode.choices.length}
              onClick={() => chooseMode(mode)}
            >
              {mode.id === "before" ? (
                <ArrowUp size={14} />
              ) : mode.id === "after" ? (
                <ArrowDown size={14} />
              ) : (
                <Plus size={14} />
              )}
              <span>{mode.label}</span>
              <small>{mode.choices.length}</small>
            </button>
          ))}
        </div>

        <div className="insertion-dialog__body">
          <div className="insertion-dialog__search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search allowed types…"
              autoFocus
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
          </div>

          <div className="insertion-dialog__types">
            {filteredChoices.map((choice) => {
              const type = nodeTypes[choice.typeName];
              const TypeIcon = iconFor(type?.icon, Layers3);
              return (
                <button
                  type="button"
                  key={choice.key}
                  className={cx(choice.key === selectedChoice?.key && "is-selected")}
                  onClick={() => setSelectedKey(choice.key)}
                >
                  <span className={cx("node-icon", `node-icon--${type?.kind || "content"}`)}>
                    <TypeIcon size={16} />
                  </span>
                  <span>
                    <strong>{type?.label || choice.typeName}</strong>
                    <small>
                      {choice.slotLabel
                        ? `${type?.kind || "content"} · ${choice.slotLabel}`
                        : type?.kind || "document"}
                    </small>
                  </span>
                  {choice.key === selectedChoice?.key && <Check size={15} />}
                </button>
              );
            })}
            {!filteredChoices.length && (
              <EmptyState icon={Search} title="No matching types">
                Try another search or insertion position.
              </EmptyState>
            )}
          </div>

          {kind === "collection" && selectedChoice && (
            <div className="insertion-dialog__record-fields">
              <div className="field">
                <div className="field__heading">
                  <label htmlFor="insert-title">Title</label>
                </div>
                <input
                  id="insert-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (!collection?.slug && !idWasEdited.current) {
                      setRecordId(slugifyId(event.target.value));
                    }
                  }}
                  placeholder={`Untitled ${nodeTypes[selectedChoice.typeName]?.label || "item"}`}
                />
              </div>
              <div className="field">
                <div className="field__heading">
                  <label htmlFor={collection?.slug ? undefined : "insert-id"}>
                    {collection?.slug ? "Filename" : "Record ID"}
                  </label>
                </div>
                {collection?.slug ? (
                  <div className="generated-filename">
                    <code>{`${effectiveRecordId}.${String(
                      collection.extension || "yml"
                    ).replace(/^\./, "")}`}</code>
                    <small title={collection.slug}>
                      Generated from {collection.slug}
                    </small>
                  </div>
                ) : (
                  <input
                    id="insert-id"
                    value={recordId}
                    onChange={(event) => {
                      idWasEdited.current = true;
                      setRecordId(slugifyId(event.target.value));
                    }}
                    placeholder="record-id"
                    aria-invalid={duplicateId}
                  />
                )}
                {duplicateId && <small className="field-error">This ID already exists.</small>}
              </div>
              {templateFields.map((field) => (
                <Field
                  key={field.name}
                  field={field}
                  value={previewProperties[field.name]}
                  idPrefix="insert-field"
                  collections={collections}
                  onChange={(value) =>
                    setPropertyOverridesByType((current) => ({
                      ...current,
                      [selectedTypeName]: {
                        ...(current[selectedTypeName] ?? {}),
                        [field.name]: value
                      }
                    }))
                  }
                />
              ))}
            </div>
          )}

          {error && (
            <div className="inline-error">
              <CircleAlert size={15} />
              {error}
            </div>
          )}
        </div>

        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={!canInsert}>
            {busy ? <Spinner small /> : <Plus size={15} />}
            {kind === "collection" ? "Create item" : "Insert content"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewItemDialog({ collection, items, nodeTypes, onCancel, onCreate }) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idWasEdited = useRef(false);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  function slugify(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!id || !title) return;
    setBusy(true);
    try {
      const type = nodeTypes[collection.node_type];
      const properties = defaultProperties(type);
      properties.title = title;
      if ("slug" in properties) properties.slug = collection.name === "pages" ? `/${id}` : id;
      const slots = Object.fromEntries(
        Object.keys(type.slots ?? {}).map((slotName) => [slotName, []])
      );
      await onCreate({
        id,
        type: collection.node_type,
        parent: parent || null,
        order: items.length,
        properties,
        slots
      });
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="dialog" onSubmit={submit}>
        <div className="dialog__top">
          <span className="dialog__icon">
            <Plus size={18} />
          </span>
          <div>
            <h2>New {collection.label_singular}</h2>
            <p>Create a YAML record in the {collection.label} collection.</p>
          </div>
          <button type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog__body">
          <div className="field">
            <div className="field__heading">
              <label htmlFor="new-title">Title</label>
            </div>
            <input
              id="new-title"
              autoFocus
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (!idWasEdited.current) setId(slugify(event.target.value));
              }}
              placeholder={`Untitled ${collection.label_singular.toLowerCase()}`}
            />
          </div>
          <div className="field">
            <div className="field__heading">
              <label htmlFor="new-id">Record ID</label>
            </div>
            <input
              id="new-id"
              value={id}
              onChange={(event) => {
                idWasEdited.current = true;
                setId(slugify(event.target.value));
              }}
              placeholder="my-record"
            />
            <small>This becomes the YAML filename and cannot be changed here later.</small>
          </div>
          {collection.hierarchy?.enabled && (
            <div className="field">
              <div className="field__heading">
                <label htmlFor="new-parent">Parent</label>
                <span>Optional</span>
              </div>
              <div className="select-wrap">
                <select
                  id="new-parent"
                  value={parent}
                  onChange={(event) => setParent(event.target.value)}
                >
                  <option value="">Top level</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
          )}
          {error && (
            <div className="inline-error">
              <CircleAlert size={15} />
              {error}
            </div>
          )}
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={!title || !id || busy}>
            {busy ? <Spinner small /> : <Plus size={15} />}
            Create {collection.label_singular}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onCancel();
    } catch (confirmError) {
      setError(confirmError.message);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="dialog confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        onSubmit={submit}
      >
        <div className="dialog__top">
          <span
            className={cx(
              "dialog__icon",
              danger && "dialog__icon--danger"
            )}
          >
            {danger ? <Trash2 size={18} /> : <CircleAlert size={18} />}
          </span>
          <div>
            <h2 id="confirmation-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy}>
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className="dialog__body">
            <div className="inline-error">
              <CircleAlert size={15} />
              {error}
            </div>
          </div>
        )}
        <div className="dialog__footer">
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cx(
              "button",
              danger ? "button--danger" : "button--primary"
            )}
            disabled={busy}
          >
            {busy ? <Spinner small /> : danger ? <Trash2 size={15} /> : <Check size={15} />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [activeCollection, setActiveCollection] = useState("");
  const [items, setItems] = useState([]);
  const [record, setRecord] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState(new Set());
  const [recordSelectionAnchor, setRecordSelectionAnchor] = useState("");
  const [selectedContentIds, setSelectedContentIds] = useState(new Set());
  const [contentSelectionAnchor, setContentSelectionAnchor] = useState("");
  const [pageExpanded, setPageExpanded] = useState(new Set());
  const [contentExpanded, setContentExpanded] = useState(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [insertDialog, setInsertDialog] = useState(null);
  const [activePanel, setActivePanel] = useState("inspector");
  const [clipboard, setClipboard] = useState(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [activeTreeSelection, setActiveTreeSelection] = useState("collection");
  const [confirmation, setConfirmation] = useState(null);
  const [layoutPreferences, setLayoutPreferences] = useState(
    readLayoutPreferences
  );
  const activeCollectionRef = useRef("");
  const breadcrumbRef = useRef(null);
  const workspaceRef = useRef(null);
  const leftRailRef = useRef(null);

  const collections = useMemo(() => collectionEntries(config), [config]);
  const collection = collections.find((entry) => entry.name === activeCollection);
  const isTableView = collection?.views?.list?.type === "table";
  const nodeTypes = config?.node_types ?? {};
  const documentType = collection ? nodeTypes[collection.node_type] : null;
  const documentHasHidden = Boolean(typeField(documentType, "hidden"));
  const treeItems = useMemo(
    () =>
      items.map((item) =>
        item.id === record?.id
          ? {
              ...item,
              title: record.properties?.title || record.id,
              hidden: Boolean(record.properties?.hidden),
              properties: record.properties ?? {}
            }
          : item
      ),
    [items, record]
  );
  const selectedNode = getNode(record, selectedId);
  const selectedNodePath = getNodePath(record, selectedId);
  const selectedNodeType = selectedNode ? nodeTypes[selectedNode.type] : null;
  const selectedIsDocument = Boolean(
    selectedNode && record && selectedNode.id === record.id
  );
  const inspectorPanels = panelsFor(selectedNodeType, selectedIsDocument);
  const effectivePanel =
    inspectorPanels.find((panel) => panel.name === activePanel)?.name ||
    inspectorPanels[0].name;
  const selectedNodeHasHidden = Boolean(typeField(selectedNodeType, "hidden"));
  const collectionInsertModes = collection
    ? collectionInsertionModes(collection, items, record)
    : [];
  const contentInsertModes = contentInsertionModes(record, selectedId, nodeTypes);
  const copyableContentNodes = useMemo(
    () => selectedTopLevelContentNodes(record, selectedContentIds),
    [record, selectedContentIds]
  );
  const contentPasteDestination =
    clipboard?.kind === "content"
      ? contentPasteTarget(record, selectedId, clipboard.nodes, nodeTypes)
      : null;
  const collectionPasteContext = useMemo(() => {
    if (
      clipboard?.kind !== "collection" ||
      clipboard.collectionName !== activeCollection ||
      !collection
    ) {
      return null;
    }
    return collectionCopyContext(
      clipboard.records,
      collection,
      items,
      record?.id
    );
  }, [activeCollection, clipboard, collection, items, record?.id]);
  const multipleTreeSelection =
    !isTableView &&
    (activeTreeSelection === "collection" && selectedRecordIds.size > 1
      ? {
          count: selectedRecordIds.size,
          label: collection?.label?.toLowerCase() || "records",
          icon: Files
        }
      : activeTreeSelection === "content" && selectedContentIds.size > 1
        ? {
            count: selectedContentIds.size,
            label: "content items",
            icon: Layers3
          }
        : null);
  const workspaceStyle = {
    "--left-pane-width": `${layoutPreferences.treeLeftWidth}px`,
    "--right-pane-width": `${
      isTableView
        ? layoutPreferences.tableRightWidth
        : layoutPreferences.treeRightWidth
    }px`,
    "--tree-split": `${layoutPreferences.treeSplit * 100}%`
  };

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const loadRecord = useCallback(async (collectionName, id) => {
    setLoading(true);
    setError("");
    try {
      const nextRecord = await api.record(collectionName, id);
      if (activeCollectionRef.current !== collectionName) return;
      setRecord(nextRecord);
      setSelectedId(nextRecord.id);
      setSelectedContentIds(new Set([nextRecord.id]));
      setContentSelectionAnchor(nextRecord.id);
      const expanded = new Set([nextRecord.id]);
      const expandContainers = (node) => {
        for (const children of Object.values(node.slots ?? {})) {
          if (children.length) expanded.add(node.id);
          children.forEach(expandContainers);
        }
      };
      expandContainers(nextRecord);
      setContentExpanded(expanded);
      setDirty(false);
    } catch (loadError) {
      setError(loadError.message);
      setRecord(null);
      setSelectedId("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCollection = useCallback(
    async (collectionName, preferredId = null) => {
      activeCollectionRef.current = collectionName;
      setActiveCollection(collectionName);
      setActiveTreeSelection("collection");
      setRecord(null);
      setSelectedId("");
      setSelectedRecordIds(new Set());
      setRecordSelectionAnchor("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
      setLoading(true);
      setError("");
      try {
        const result = await api.list(collectionName);
        if (activeCollectionRef.current !== collectionName) return;
        setItems(result.items);
        const parentReferences = new Set(
          result.items.map((item) => item.parent).filter(Boolean)
        );
        setPageExpanded(
          new Set(
            result.items
              .filter((item) =>
                parentReferences.has(item.hierarchy_id || item.id)
              )
              .map((item) => item.id)
          )
        );
        const nextId = preferredId
          ? result.items.find((item) => item.id === preferredId)?.id
          : null;
        if (nextId) {
          setSelectedRecordIds(new Set([nextId]));
          setRecordSelectionAnchor(nextId);
          await loadRecord(collectionName, nextId);
        } else {
          setLoading(false);
        }
      } catch (loadError) {
        setError(loadError.message);
        setLoading(false);
      }
    },
    [loadRecord]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((nextConfig) => {
        if (cancelled) return;
        setConfig(nextConfig);
        const configuredCollections = collectionEntries(nextConfig);
        const initialCollection =
          collectionNameFromHash(nextConfig) ||
          configuredCollections[0]?.name;
        if (initialCollection) {
          replaceCollectionHash(initialCollection);
          loadCollection(initialCollection);
        } else {
          setLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadCollection]);

  useEffect(() => {
    if (!breadcrumbRef.current) return;
    breadcrumbRef.current.scrollLeft = breadcrumbRef.current.scrollWidth;
  }, [selectedId, record?.id]);

  useEffect(() => {
    if (!config || !activeCollection) return undefined;
    function syncCollectionFromHash() {
      const requestedCollection = collectionNameFromHash(config);
      if (!requestedCollection) {
        replaceCollectionHash(activeCollection);
        return;
      }
      if (requestedCollection === activeCollection) return;
      if (dirty) replaceCollectionHash(activeCollection);
      runAfterDiscardCheck(() => {
        replaceCollectionHash(requestedCollection);
        setSearch("");
        return loadCollection(requestedCollection);
      });
    }
    window.addEventListener("hashchange", syncCollectionFromHash);
    return () =>
      window.removeEventListener("hashchange", syncCollectionFromHash);
  }, [activeCollection, config, dirty, loadCollection]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAYOUT_STORAGE_KEY,
        JSON.stringify(layoutPreferences)
      );
    } catch {
      // Local storage can be unavailable in privacy-restricted browsers.
    }
  }, [layoutPreferences]);

  useEffect(() => {
    function fitToViewport() {
      setLayoutPreferences((current) => {
        const viewportWidth =
          workspaceRef.current?.getBoundingClientRect().width ??
          window.innerWidth;
        const fitted = fitLayoutPreferences(current, viewportWidth);
        return Object.keys(fitted).every(
          (name) => fitted[name] === current[name]
        )
          ? current
          : fitted;
      });
    }
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);

  function resizeTreeLeft(delta) {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ??
      window.innerWidth;
    setLayoutPreferences((current) => ({
      ...current,
      treeLeftWidth: Math.round(
        clampNumber(
          current.treeLeftWidth + delta,
          MIN_TREE_WIDTH,
          Math.min(
            MAX_TREE_WIDTH,
            workspaceWidth -
              current.treeRightWidth -
              MIN_PREVIEW_WIDTH -
              RESIZE_HANDLE_SIZE * 2
          )
        )
      )
    }));
  }

  function resizeInspector(delta) {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ??
      window.innerWidth;
    setLayoutPreferences((current) => {
      const name = isTableView
        ? "tableRightWidth"
        : "treeRightWidth";
      const minimumMainWidth = isTableView
        ? MIN_TABLE_WIDTH
        : MIN_PREVIEW_WIDTH + current.treeLeftWidth + RESIZE_HANDLE_SIZE;
      const maximum = Math.min(
        MAX_INSPECTOR_WIDTH,
        workspaceWidth - minimumMainWidth - RESIZE_HANDLE_SIZE
      );
      return {
        ...current,
        [name]: Math.round(
          clampNumber(
            current[name] - delta,
            MIN_INSPECTOR_WIDTH,
            maximum
          )
        )
      };
    });
  }

  function resizeTreeSplit(delta) {
    const railHeight =
      leftRailRef.current?.getBoundingClientRect().height ?? 0;
    const availableHeight = railHeight - RESIZE_HANDLE_SIZE;
    if (availableHeight <= 0) return;
    const minimumRatio = Math.min(
      0.5,
      MIN_COLLECTION_TREE_HEIGHT / availableHeight
    );
    const maximumRatio = Math.max(
      0.5,
      1 - MIN_CONTENT_TREE_HEIGHT / availableHeight
    );
    setLayoutPreferences((current) => ({
      ...current,
      treeSplit: clampNumber(
        current.treeSplit + delta / availableHeight,
        minimumRatio,
        maximumRatio
      )
    }));
  }

  function runAfterDiscardCheck(action) {
    if (!dirty) {
      action();
      return;
    }
    setConfirmation({
      title: "Discard unsaved changes?",
      description:
        "The current record has changes that have not been saved. This action cannot be undone.",
      confirmLabel: "Discard changes",
      danger: true,
      onConfirm: async () => {
        setDirty(false);
        await action();
      }
    });
  }

  function switchCollection(name) {
    if (name === activeCollection) return;
    runAfterDiscardCheck(() => {
      replaceCollectionHash(name);
      setSearch("");
      return loadCollection(name);
    });
  }

  function selectRecord(id) {
    if (id === record?.id) return;
    runAfterDiscardCheck(() => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(new Set([id]));
      setRecordSelectionAnchor(id);
      return loadRecord(activeCollection, id);
    });
  }

  function changeCollectionSelection({ selectedIds, anchorId, activeId }) {
    const applySelection = () => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(selectedIds);
      setRecordSelectionAnchor(anchorId);
      if (activeId !== record?.id) {
        return loadRecord(activeCollection, activeId);
      }
    };
    if (activeId === record?.id) applySelection();
    else runAfterDiscardCheck(applySelection);
  }

  function clearCollectionSelection() {
    if (!selectedRecordIds.size && !record) return;
    runAfterDiscardCheck(() => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(new Set());
      setRecordSelectionAnchor("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
      setSelectedId("");
      setRecord(null);
    });
  }

  function changeContentSelection({ selectedIds, anchorId, activeId }) {
    setActiveTreeSelection("content");
    setSelectedContentIds(selectedIds);
    setContentSelectionAnchor(anchorId);
    setSelectedId(activeId);
  }

  function clearContentSelection() {
    if (!selectedContentIds.size && !selectedId) return;
    setActiveTreeSelection("content");
    setSelectedContentIds(new Set());
    setContentSelectionAnchor("");
    setSelectedId("");
  }

  function changeRecord(update) {
    setRecord((current) => update(current));
    setDirty(true);
  }

  function changeProperty(nodeId, name, value) {
    changeRecord((current) =>
      updateNode(current, nodeId, (node) => ({
        ...node,
        properties: { ...(node.properties ?? {}), [name]: value }
      }))
    );
  }

  async function saveRecord() {
    if (!record || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.save(activeCollection, record);
      setItems((current) =>
        current.map((item) => (item.id === result.item.id ? result.item : item))
      );
      setDirty(false);
      showToast(`${record.properties?.title || record.id} saved`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function editTableField(item, column, value) {
    if (saving || column.field.startsWith("$")) return;
    if (dirty && record?.id === item.id) {
      setError("Save the current inspector changes before editing this table row.");
      return;
    }
    const fieldName = column.field.replace(/^properties\./, "");
    setSaving(true);
    setError("");
    try {
      const sourceRecord =
        record?.id === item.id
          ? record
          : await api.record(activeCollection, item.id);
      const nextRecord = {
        ...sourceRecord,
        properties: {
          ...(sourceRecord.properties ?? {}),
          [fieldName]: value
        }
      };
      const result = await api.save(activeCollection, nextRecord);
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === result.item.id ? result.item : currentItem
        )
      );
      if (record?.id === item.id) setRecord(nextRecord);
      showToast(`${column.label || fieldName} updated`);
    } catch (editError) {
      setError(editError.message);
    } finally {
      setSaving(false);
    }
  }

  async function regenerateRecordFilename() {
    if (!record || !collection?.slug || saving) return;
    if (dirty) {
      setError("Save the current changes before regenerating its YAML filename.");
      return;
    }
    const existingIds = items
      .map((item) => item.id)
      .filter((id) => id !== record.id);
    const nextId = uniqueFilenameStem(
      renderSlugTemplate(collection.slug, {
        fields: record.properties,
        identifierField: collection.identifier_field || "title",
        date: new Date()
      }),
      new Set(existingIds)
    );
    const oldId = record.id;
    if (nextId.toLowerCase() === oldId.toLowerCase()) {
      showToast("Filename already matches the configured slug");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.rename(activeCollection, oldId, nextId);
      setDirty(false);
      await loadCollection(activeCollection, nextId);
      showToast(`${oldId} renamed to ${nextId}`);
    } catch (renameError) {
      setError(renameError.message);
    } finally {
      setSaving(false);
    }
  }

  async function insertCollectionItem({ choice, title, id, properties: initialProperties }) {
    setActiveTreeSelection("collection");
    const type = nodeTypes[choice.typeName];
    const properties = structuredClone(
      initialProperties ?? defaultProperties(type)
    );
    properties.title = title;
    if ("slug" in properties && !properties.slug) {
      properties.slug = activeCollection === "pages" ? `/${id}` : id;
    }
    const parentField = collection.hierarchy?.parent_field;
    if (parentField) properties[parentField] = choice.parent ?? null;
    const slots = Object.fromEntries(
      Object.keys(type.slots ?? {}).map((slotName) => [slotName, []])
    );
    const newRecord = {
      id,
      type: choice.typeName,
      order: choice.order,
      properties,
      slots
    };

    const result = await api.create(activeCollection, newRecord);
    setInsertDialog(null);
    if (dirty) {
      setItems((current) => [...current, result.item]);
    } else {
      await loadCollection(activeCollection, newRecord.id);
    }
    showToast(`${newRecord.properties.title} created`);
  }

  async function copySelectedRecords() {
    if (!selectedRecordIds.size || clipboardBusy) return;
    setClipboardBusy(true);
    setError("");
    try {
      const selectedItems = items
        .filter((item) => selectedRecordIds.has(item.id))
        .sort(
          (left, right) =>
            left.order - right.order || left.title.localeCompare(right.title)
        );
      const records = await Promise.all(
        selectedItems.map((item) =>
          item.id === record?.id
            ? structuredClone(record)
            : api.record(activeCollection, item.id)
        )
      );
      setClipboard({
        kind: "collection",
        collectionName: activeCollection,
        records
      });
      showToast(
        `${records.length} ${records.length === 1 ? "record" : "records"} copied`
      );
    } catch (copyError) {
      setError(copyError.message);
    } finally {
      setClipboardBusy(false);
    }
  }

  async function createRecordCopies(
    sourceRecords,
    copyContext,
    {
      idSuffix = "copy",
      titleSuffix = "",
      action = "pasted",
      focusCreated = true,
      preserveRootPlacement = false
    } = {}
  ) {
    const createdItems = [];
    try {
      const usedIds = new Set(items.map((item) => item.id));
      const copyDate = new Date();
      const prepared = sourceRecords.map((sourceRecord) => {
        const oldHierarchyId = collectionHierarchyValue(
          sourceRecord,
          collection,
          "id_field",
          sourceRecord.id
        );
        const oldParent = collectionHierarchyValue(
          sourceRecord,
          collection,
          "parent_field",
          sourceRecord.parent ?? null
        );
        const duplicate = structuredClone(sourceRecord);
        refreshUuidFields(duplicate, nodeTypes);
        if (titleSuffix && duplicate.properties?.title) {
          duplicate.properties.title = `${duplicate.properties.title} ${titleSuffix}`;
        }
        duplicate.id = collection.slug
          ? uniqueFilenameStem(
              renderSlugTemplate(collection.slug, {
                fields: duplicate.properties,
                identifierField: collection.identifier_field || "title",
                date: copyDate
              }),
              usedIds
            )
          : uniqueRecordId(sourceRecord.id, usedIds, idSuffix);
        if ("slug" in (duplicate.properties ?? {})) {
          duplicate.properties.slug = String(
            sourceRecord.properties?.slug || ""
          ).startsWith("/")
            ? `/${duplicate.id}`
            : duplicate.id;
        }
        return {
          duplicate,
          oldHierarchyId,
          oldParent,
          newHierarchyId: collectionHierarchyValue(
            duplicate,
            collection,
            "id_field",
            duplicate.id
          )
        };
      });
      const hierarchyIdMap = new Map(
        prepared.map((entry) => [entry.oldHierarchyId, entry.newHierarchyId])
      );
      const rootHierarchyIds = new Set(
        copyContext.rootRecords.map((rootRecord) =>
          collectionHierarchyValue(
            rootRecord,
            collection,
            "id_field",
            rootRecord.id
          )
        )
      );
      const rootEntries = prepared.filter((entry) =>
        rootHierarchyIds.has(entry.oldHierarchyId)
      );
      const sourceItemByHierarchyId = new Map(
        items.map((item) => [item.hierarchy_id || item.id, item])
      );
      const destinationSiblings = preserveRootPlacement
        ? []
        : items
            .filter(
              (item) =>
                (item.parent ?? null) === (copyContext.parent ?? null)
            )
            .sort(
              (left, right) =>
                left.order - right.order ||
                left.title.localeCompare(right.title)
            );
      const focusedIndex = copyContext.focusedItem
        ? destinationSiblings.findIndex(
            (item) => item.id === copyContext.focusedItem.id
          )
        : -1;
      const previousOrder =
        focusedIndex === -1
          ? destinationSiblings.at(-1)?.order ?? -1
          : destinationSiblings[focusedIndex]?.order ?? 0;
      const nextOrder =
        focusedIndex !== -1
          ? destinationSiblings[focusedIndex + 1]?.order
          : undefined;

      prepared.forEach((entry) => {
        const parent =
          hierarchyIdMap.get(entry.oldParent) ??
          (preserveRootPlacement ? entry.oldParent : copyContext.parent) ??
          null;
        const parentField = collection.hierarchy?.parent_field;
        if (parentField) {
          entry.duplicate.properties = {
            ...(entry.duplicate.properties ?? {}),
            [parentField]: parent
          };
        } else {
          entry.duplicate.parent = parent;
        }

        const rootIndex = rootEntries.indexOf(entry);
        if (rootIndex !== -1) {
          if (preserveRootPlacement) {
            const sourceItem = sourceItemByHierarchyId.get(entry.oldHierarchyId);
            const sourceSiblings = items
              .filter(
                (item) =>
                  (item.parent ?? null) ===
                  (sourceItem?.parent ?? entry.oldParent ?? null)
              )
              .sort(
                (left, right) =>
                  left.order - right.order ||
                  left.title.localeCompare(right.title)
              );
            const sourceIndex = sourceSiblings.findIndex(
              (item) => item.id === sourceItem?.id
            );
            const sourceOrder =
              sourceItem?.order ?? entry.duplicate.order ?? 0;
            const followingOrder =
              sourceIndex === -1
                ? undefined
                : sourceSiblings[sourceIndex + 1]?.order;
            entry.duplicate.order =
              followingOrder === undefined
                ? sourceOrder + 1
                : sourceOrder + (followingOrder - sourceOrder) / 2;
          } else {
            entry.duplicate.order =
              nextOrder === undefined
                ? previousOrder + rootIndex + 1
                : previousOrder +
                  ((nextOrder - previousOrder) * (rootIndex + 1)) /
                    (rootEntries.length + 1);
          }
        }
      });

      const preparedByHierarchyId = new Map(
        prepared.map((entry) => [entry.oldHierarchyId, entry])
      );
      const copiedDepth = (entry) => {
        let depth = 0;
        let parent = preparedByHierarchyId.get(entry.oldParent);
        const visited = new Set();
        while (parent && !visited.has(parent.oldHierarchyId)) {
          visited.add(parent.oldHierarchyId);
          depth += 1;
          parent = preparedByHierarchyId.get(parent.oldParent);
        }
        return depth;
      };
      const creationOrder = [...prepared].sort(
        (left, right) => copiedDepth(left) - copiedDepth(right)
      );
      for (const entry of creationOrder) {
        const result = await api.create(activeCollection, entry.duplicate);
        createdItems.push(result.item);
      }
      const createdIds = createdItems.map((item) => item.id);
      setItems((current) => [...current, ...createdItems]);
      if (focusCreated) {
        setSelectedRecordIds(new Set(createdIds));
        setRecordSelectionAnchor(createdIds[0]);
        setActiveTreeSelection("collection");
      }
      setPageExpanded(
        (current) =>
          new Set([
            ...current,
            ...prepared
              .filter((entry) =>
                prepared.some(
                  (candidate) =>
                    candidate.oldParent === entry.oldHierarchyId
                )
              )
              .map((entry) => entry.duplicate.id)
          ])
      );
      if (focusCreated) {
        await loadRecord(activeCollection, createdIds[0]);
      }
      showToast(
        `${createdIds.length} ${createdIds.length === 1 ? "record" : "records"} ${action}`
      );
      return createdIds;
    } catch (copyError) {
      if (createdItems.length) {
        await loadCollection(activeCollection, createdItems[0].id);
      }
      throw copyError;
    }
  }

  async function pasteCopiedRecords() {
    if (!collectionPasteContext || clipboardBusy || dirty || saving) return;
    setClipboardBusy(true);
    setError("");
    try {
      await createRecordCopies(
        clipboard.records,
        collectionPasteContext
      );
    } catch (pasteError) {
      setError(pasteError.message);
    } finally {
      setClipboardBusy(false);
    }
  }

  function copySelectedContent() {
    if (!copyableContentNodes.length) return;
    const nodes = copyableContentNodes.map((node) => structuredClone(node));
    setClipboard({ kind: "content", nodes });
    showToast(
      `${nodes.length} content ${nodes.length === 1 ? "item" : "items"} copied`
    );
  }

  function pasteCopiedContent() {
    if (!contentPasteDestination || clipboard?.kind !== "content") return;
    setActiveTreeSelection("content");
    const usedIds = collectNodeIds(record);
    const nodes = clipboard.nodes.map((node) => {
      const clone = cloneContentNode(node, usedIds);
      refreshUuidFields(clone, nodeTypes);
      return clone;
    });
    changeRecord((current) =>
      updateNode(current, contentPasteDestination.parentId, (parent) => {
        const children = [
          ...(parent.slots?.[contentPasteDestination.slotName] ?? [])
        ];
        children.splice(contentPasteDestination.index, 0, ...nodes);
        return {
          ...parent,
          slots: {
            ...(parent.slots ?? {}),
            [contentPasteDestination.slotName]: children
          }
        };
      })
    );
    const pastedIds = nodes.map((node) => node.id);
    setContentExpanded(
      (current) =>
        new Set([...current, contentPasteDestination.parentId])
    );
    setSelectedContentIds(new Set(pastedIds));
    setContentSelectionAnchor(pastedIds[0]);
    setSelectedId(pastedIds.at(-1));
    showToast(
      `${nodes.length} content ${nodes.length === 1 ? "item" : "items"} pasted`
    );
  }

  function toggleDocumentVisibility() {
    if (!record || !documentHasHidden) return;
    changeProperty(record.id, "hidden", !record.properties?.hidden);
  }

  function toggleSelectedVisibility() {
    if (!selectedNode || !selectedNodeHasHidden) return;
    changeProperty(selectedNode.id, "hidden", !selectedNode.properties?.hidden);
  }

  async function duplicateRecords(recordIds) {
    if (!recordIds.size || saving) return;
    setSaving(true);
    setError("");
    try {
      const selectedItems = items
        .filter((item) => recordIds.has(item.id))
        .sort(
          (left, right) =>
            left.order - right.order || left.title.localeCompare(right.title)
        );
      const records = await Promise.all(
        selectedItems.map((item) =>
          item.id === record?.id
            ? structuredClone(record)
          : api.record(activeCollection, item.id)
        )
      );
      const selectedHierarchyIds = new Set(
        records.map((selectedRecord) =>
          collectionHierarchyValue(
            selectedRecord,
            collection,
            "id_field",
            selectedRecord.id
          )
        )
      );
      const rootRecords = records.filter((selectedRecord) => {
        const parent = collectionHierarchyValue(
          selectedRecord,
          collection,
          "parent_field",
          selectedRecord.parent ?? null
        );
        return !selectedHierarchyIds.has(parent);
      });
      await createRecordCopies(
        records,
        { rootRecords, parent: null, focusedItem: null },
        {
          idSuffix: "duplicate",
          titleSuffix: "duplicate",
          action: "duplicated",
          focusCreated: !dirty,
          preserveRootPlacement: true
        }
      );
    } catch (duplicateError) {
      setError(duplicateError.message);
    } finally {
      setSaving(false);
    }
  }

  function duplicateSelectedRecords() {
    return duplicateRecords(selectedRecordIds);
  }

  function duplicateCurrentRecord() {
    if (!record) return;
    return duplicateRecords(new Set([record.id]));
  }

  async function deleteRecords(recordIds) {
    const selectedItems = items.filter((item) => recordIds.has(item.id));
    if (!selectedItems.length || saving) return;
    const itemByHierarchyId = new Map(
      items.map((item) => [item.hierarchy_id || item.id, item])
    );
    const depthOf = (item) => {
      let depth = 0;
      let parent = item.parent
        ? itemByHierarchyId.get(item.parent)
        : null;
      const visited = new Set();
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        depth += 1;
        parent = parent.parent
          ? itemByHierarchyId.get(parent.parent)
          : null;
      }
      return depth;
    };
    const deletionOrder = [...selectedItems].sort(
      (left, right) => depthOf(right) - depthOf(left)
    );
    const currentWillBeDeleted = Boolean(record && recordIds.has(record.id));
    const currentItem = currentWillBeDeleted
      ? items.find((item) => item.id === record.id)
      : null;
    let fallbackParent = currentItem?.parent
      ? itemByHierarchyId.get(currentItem.parent)
      : null;
    while (fallbackParent && recordIds.has(fallbackParent.id)) {
      fallbackParent = fallbackParent.parent
        ? itemByHierarchyId.get(fallbackParent.parent)
        : null;
    }
    const nextId = currentWillBeDeleted
      ? fallbackParent?.id ||
        items.find((item) => !recordIds.has(item.id) && !item.parent)?.id ||
        items.find((item) => !recordIds.has(item.id))?.id ||
        null
      : record?.id || null;
    const deletedIds = new Set();
    setSaving(true);
    setError("");
    try {
      for (const item of deletionOrder) {
        await api.remove(activeCollection, item.id);
        deletedIds.add(item.id);
      }
      if (currentWillBeDeleted) {
        setDirty(false);
        await loadCollection(activeCollection, nextId);
      } else {
        setItems((current) =>
          current.filter((item) => !recordIds.has(item.id))
        );
        const nextSelection = record
          ? new Set([record.id])
          : new Set();
        setSelectedRecordIds(nextSelection);
        setRecordSelectionAnchor(record?.id || "");
        setActiveTreeSelection("collection");
      }
      showToast(
        `${selectedItems.length} ${selectedItems.length === 1 ? "record" : "records"} deleted`
      );
    } catch (deleteError) {
      if (deletedIds.size) {
        setItems((current) =>
          current.filter((item) => !deletedIds.has(item.id))
        );
        setSelectedRecordIds(
          new Set(
            [...recordIds].filter((id) => !deletedIds.has(id))
          )
        );
        if (record && deletedIds.has(record.id)) {
          setDirty(false);
          await loadCollection(activeCollection);
        }
      }
      throw deleteError;
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteRecords(recordIds) {
    if (!recordIds.size || saving) return;
    const selectedItems = items.filter((item) => recordIds.has(item.id));
    if (!selectedItems.length) return;
    const selectedHierarchyIds = new Set(
      selectedItems.map((item) => item.hierarchy_id || item.id)
    );
    const unselectedChildren = items.filter(
      (item) =>
        item.parent &&
        selectedHierarchyIds.has(item.parent) &&
        !recordIds.has(item.id)
    );
    if (unselectedChildren.length) {
      const parentCount = new Set(
        unselectedChildren.map((item) => item.parent)
      ).size;
      setError(
        `Select or move all children before deleting ${parentCount === 1 ? "this parent" : "these parents"}.`
      );
      return;
    }

    const count = selectedItems.length;
    const singular = collection?.label_singular?.toLowerCase() || "record";
    const plural = collection?.label?.toLowerCase() || "records";
    setConfirmation({
      title: `Delete ${count} ${count === 1 ? singular : plural}?`,
      description:
        count === 1
          ? `This permanently removes “${selectedItems[0].title}” and its YAML file.`
          : `This permanently removes the ${count} selected records and their YAML files.`,
      confirmLabel: count === 1 ? `Delete ${singular}` : `Delete ${count} records`,
      danger: true,
      onConfirm: () => deleteRecords(new Set(recordIds))
    });
  }

  function requestDeleteSelectedRecords() {
    requestDeleteRecords(selectedRecordIds);
  }

  function requestDeleteCurrentRecord() {
    if (!record) return;
    requestDeleteRecords(new Set([record.id]));
  }

  function duplicateSelectedContent() {
    if (!record || !selectedContentIds.size) return;
    const selectedNodes = selectedTopLevelContentNodes(
      record,
      selectedContentIds,
      true
    );
    if (selectedNodes[0]?.id === record.id) {
      duplicateCurrentRecord();
      return;
    }
    setActiveTreeSelection("content");
    const usedIds = collectNodeIds(record);
    const duplicateBySourceId = new Map();
    const parentIds = new Set();
    for (const node of selectedNodes) {
      const location = findLocation(record, node.id);
      if (!location) continue;
      const duplicate = cloneContentNode(node, usedIds);
      refreshUuidFields(duplicate, nodeTypes);
      if (duplicate.properties?.heading) {
        duplicate.properties.heading = `${duplicate.properties.heading} duplicate`;
      }
      duplicateBySourceId.set(node.id, duplicate);
      parentIds.add(location.parentId);
    }
    if (!duplicateBySourceId.size) return;

    const insertDuplicates = (node) => ({
      ...node,
      slots: Object.fromEntries(
        Object.entries(node.slots ?? {}).map(([slotName, children]) => [
          slotName,
          children.flatMap((child) => {
            const current = insertDuplicates(child);
            const duplicate = duplicateBySourceId.get(child.id);
            return duplicate ? [current, duplicate] : [current];
          })
        ])
      )
    });
    changeRecord(insertDuplicates);
    const duplicates = [...duplicateBySourceId.values()];
    const duplicateIds = duplicates.map((duplicate) => duplicate.id);
    setContentExpanded(
      (current) => new Set([...current, ...parentIds])
    );
    setSelectedId(duplicateIds.at(-1));
    setSelectedContentIds(new Set(duplicateIds));
    setContentSelectionAnchor(duplicateIds[0]);
    showToast(
      `${duplicateIds.length} content ${duplicateIds.length === 1 ? "item" : "items"} duplicated`
    );
  }

  function deleteTreeSelection() {
    requestDeleteSelectedContent();
  }

  function insertContentNode({ choice }) {
    setActiveTreeSelection("content");
    const node = newNode(choice.typeName, nodeTypes[choice.typeName]);
    changeRecord((current) =>
      updateNode(current, choice.parentId, (parent) => {
        const children = [...(parent.slots?.[choice.slotName] ?? [])];
        children.splice(choice.index, 0, node);
        return {
          ...parent,
          slots: { ...(parent.slots ?? {}), [choice.slotName]: children }
        };
      })
    );
    setContentExpanded((current) => new Set([...current, choice.parentId]));
    setSelectedId(node.id);
    setSelectedContentIds(new Set([node.id]));
    setContentSelectionAnchor(node.id);
    setInsertDialog(null);
    showToast(`${nodeTypes[node.type]?.label || node.type} inserted`);
  }

  function moveContentByDrag(drag, drop) {
    if (!record || !drag?.source || drop?.kind !== "content-drop") return;
    if (drag.nodeId === drop.targetId) return;
    const source = drag.source;
    const targetParent = getNode(record, drop.parentId);
    const targetChildren = targetParent?.slots?.[drop.slotName] ?? [];
    let targetIndex =
      drop.position === "inside"
        ? targetChildren.length
        : targetChildren.findIndex((child) => child.id === drop.targetId);
    if (targetIndex === -1) return;
    if (drop.position === "after") targetIndex += 1;
    const sameSlot =
      source.parentId === drop.parentId && source.slotName === drop.slotName;
    if (sameSlot && source.index < targetIndex) targetIndex -= 1;
    if (sameSlot && source.index === targetIndex) return;
    setActiveTreeSelection("content");

    const movingNode = getNode(record, drag.nodeId);
    if (!movingNode) return;
    changeRecord((current) => {
      const withoutSource = updateNode(current, source.parentId, (parent) => ({
        ...parent,
        slots: {
          ...parent.slots,
          [source.slotName]: parent.slots[source.slotName].filter(
            (child) => child.id !== drag.nodeId
          )
        }
      }));
      return updateNode(withoutSource, drop.parentId, (parent) => {
        const children = [...(parent.slots?.[drop.slotName] ?? [])];
        children.splice(targetIndex, 0, movingNode);
        return {
          ...parent,
          slots: { ...(parent.slots ?? {}), [drop.slotName]: children }
        };
      });
    });
    setContentExpanded((current) => new Set([...current, drop.parentId]));
    setSelectedId(drag.nodeId);
    if (!selectedContentIds.has(drag.nodeId)) {
      setSelectedContentIds(new Set([drag.nodeId]));
      setContentSelectionAnchor(drag.nodeId);
    }
    showToast(`${drag.label} moved`);
  }

  async function moveCollectionByDrag(drag, drop) {
    if (dirty || saving || drop?.kind !== "collection-drop") return;
    const draggedItem = drag?.item;
    if (!draggedItem || draggedItem.id === drop.targetId) return;

    const siblings = items
      .filter(
        (item) =>
          item.id !== draggedItem.id && (item.parent ?? null) === (drop.parent ?? null)
      )
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    let targetIndex =
      drop.position === "inside"
        ? siblings.length
        : siblings.findIndex((item) => item.id === drop.targetId);
    if (targetIndex === -1) return;
    if (drop.position === "after") targetIndex += 1;
    const previous = targetIndex > 0 ? siblings[targetIndex - 1] : null;
    const next = targetIndex < siblings.length ? siblings[targetIndex] : null;
    const order =
      previous && next
        ? ((previous.order ?? 0) + (next.order ?? 0)) / 2
        : previous
          ? (previous.order ?? 0) + 1
          : next
            ? (next.order ?? 0) - 1
            : 0;

    setSaving(true);
    setError("");
    try {
      const sourceRecord =
        record?.id === draggedItem.id
          ? structuredClone(record)
          : await api.record(activeCollection, draggedItem.id);
      sourceRecord.order = order;
      const parentField = collection.hierarchy?.parent_field;
      if (parentField) {
        sourceRecord.properties = {
          ...(sourceRecord.properties ?? {}),
          [parentField]: drop.parent ?? null
        };
      } else {
        sourceRecord.parent = drop.parent ?? null;
      }

      const result = await api.save(activeCollection, sourceRecord);
      setItems((current) =>
        current.map((item) => (item.id === result.item.id ? result.item : item))
      );
      if (record?.id === sourceRecord.id) {
        setRecord(sourceRecord);
        setDirty(false);
      }
      if (drop.parent) {
        const parentItem = items.find(
          (item) => (item.hierarchy_id || item.id) === drop.parent
        );
        if (parentItem) {
          setPageExpanded((current) => new Set([...current, parentItem.id]));
        }
      }
      showToast(`${draggedItem.title} moved`);
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setSaving(false);
    }
  }

  function moveSelected(direction) {
    const location = findLocation(record, selectedId);
    if (!location) return;
    const destination = location.index + direction;
    if (destination < 0 || destination >= location.children.length) return;
    changeRecord((current) =>
      updateNode(current, location.parentId, (parent) => {
        const children = [...parent.slots[location.slotName]];
        const [moving] = children.splice(location.index, 1);
        children.splice(destination, 0, moving);
        return {
          ...parent,
          slots: { ...parent.slots, [location.slotName]: children }
        };
      })
    );
  }

  function deleteSelectedContent(nodes, selectedCount) {
    if (!record || !nodes.length) return;
    const deletedIds = new Set(nodes.map((node) => node.id));
    const firstLocation = findLocation(record, nodes[0].id);
    const nextSelectedId = firstLocation?.parentId || record.id;
    const removeNodes = (node) => ({
      ...node,
      slots: Object.fromEntries(
        Object.entries(node.slots ?? {}).map(([slotName, children]) => [
          slotName,
          children
            .filter((child) => !deletedIds.has(child.id))
            .map(removeNodes)
        ])
      )
    });
    setActiveTreeSelection("content");
    changeRecord(removeNodes);
    setSelectedId(nextSelectedId);
    setSelectedContentIds(new Set([nextSelectedId]));
    setContentSelectionAnchor(nextSelectedId);
    showToast(
      `${selectedCount} content ${selectedCount === 1 ? "item" : "items"} deleted`
    );
  }

  function requestDeleteSelectedContent() {
    if (!record || !selectedContentIds.size || saving) return;
    const selectedNodes = selectedTopLevelContentNodes(
      record,
      selectedContentIds,
      true
    );
    if (!selectedNodes.length) return;
    if (selectedNodes[0].id === record.id) {
      requestDeleteCurrentRecord();
      return;
    }
    const count = selectedContentIds.size;
    const nestedNote = selectedNodes.some(
      (node) => descendantIds(node).size
    )
      ? " Nested content inside them will also be removed."
      : "";
    setConfirmation({
      title: `Delete ${count} content ${count === 1 ? "item" : "items"}?`,
      description: `This removes the selected content from the current record.${nestedNote}`,
      confirmLabel: count === 1 ? "Delete item" : `Delete ${count} items`,
      danger: true,
      onConfirm: () => deleteSelectedContent(selectedNodes, count)
    });
  }

  function toggleSet(setter, id) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!config && loading) {
    return (
      <div className="boot-screen">
        <BrandMark />
        <Spinner />
        <span>Opening content studio</span>
      </div>
    );
  }

  if (!config && error) {
    return (
      <div className="boot-screen boot-screen--error">
        <CircleAlert size={28} />
        <strong>Could not open the studio</strong>
        <p>{error}</p>
        <button type="button" className="button button--primary" onClick={() => location.reload()}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <nav className="collection-nav" aria-label="Collections">
          {collections.map((entry) => {
            const Icon = iconFor(entry.icon, Files);
            return (
              <button
                type="button"
                key={entry.name}
                className={cx(entry.name === activeCollection && "is-active")}
                onClick={() => switchCollection(entry.name)}
              >
                <Icon size={15} strokeWidth={1.8} />
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="topbar__actions">
          <span className={cx("save-state", dirty && "save-state--dirty")}>
            <i />
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            type="button"
            className="button button--save"
            onClick={saveRecord}
            disabled={!record || !dirty || saving}
          >
            {saving ? <Spinner small /> : dirty ? <Save size={15} /> : <Check size={15} />}
            {saving ? "Saving" : "Save"}
          </button>
          <button type="button" className="avatar" title="Workspace account">
            BR
          </button>
        </div>
      </header>

      <main
        ref={workspaceRef}
        className={cx("workspace", isTableView && "workspace--table")}
        style={workspaceStyle}
      >
        {isTableView && (
          <CollectionTable
            key={collection.name}
            collection={collection}
            items={treeItems}
            nodeTypes={nodeTypes}
            selectedId={record?.id}
            loading={loading}
            search={search}
            editing={saving}
            onSearch={setSearch}
            onSelect={selectRecord}
            onCreate={() => setInsertDialog("collection")}
            onEdit={editTableField}
          />
        )}

        {!isTableView && (
          <aside ref={leftRailRef} className="left-rail">
          <section className="rail-section rail-section--documents">
            <div className="panel-heading">
              <div>
                <span>{collection?.label}</span>
                <small>{items.length}</small>
              </div>
            </div>
            <div className="document-toolbar" aria-label="Document actions">
              <button
                type="button"
                title={`New ${collection?.label_singular}`}
                onClick={() => setInsertDialog("collection")}
              >
                <Plus size={18} />
              </button>
              {documentHasHidden && (
                <button
                  type="button"
                  className={cx(record?.properties?.hidden && "is-active")}
                  title={
                    record?.properties?.hidden
                      ? "Show page"
                      : "Hide page"
                  }
                  disabled={!record}
                  onClick={toggleDocumentVisibility}
                >
                  {record?.properties?.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}
              <span className="document-toolbar__separator" />
              <button
                type="button"
                title={`Duplicate selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || saving}
                onClick={duplicateSelectedRecords}
              >
                <Copy size={18} />
              </button>
              <button
                type="button"
                title={`Copy selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || clipboardBusy}
                onClick={copySelectedRecords}
              >
                <ClipboardCopy size={18} />
              </button>
              <button
                type="button"
                title={`Paste copied ${collection?.label?.toLowerCase()}`}
                disabled={
                  !collectionPasteContext ||
                  dirty ||
                  saving ||
                  clipboardBusy
                }
                onClick={pasteCopiedRecords}
              >
                <ClipboardPaste size={18} />
              </button>
              <button
                type="button"
                className="danger"
                title={`Delete selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || saving}
                onClick={requestDeleteSelectedRecords}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Find ${collection?.label.toLowerCase()}…`}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="rail-scroll" onClick={clearCollectionSelection}>
              <CollectionTree
                items={treeItems}
                collection={collection}
                selectedIds={selectedRecordIds}
                selectionAnchor={recordSelectionAnchor}
                onSelectionChange={changeCollectionSelection}
                expanded={pageExpanded}
                onToggle={(id) => toggleSet(setPageExpanded, id)}
                onMove={moveCollectionByDrag}
                dragEnabled={!dirty && !saving}
                search={search}
              />
            </div>
          </section>

          <ResizeHandle
            axis="y"
            label="Resize collection and content trees"
            onResize={resizeTreeSplit}
          />

          <section className="rail-section rail-section--structure">
            <div className="panel-heading">
              <div>
                <span>Content structure</span>
                {record && (
                  <small>
                    {record.slots
                      ? Object.values(record.slots).reduce(
                          (total, children) => total + children.length,
                          0
                        )
                      : 0}
                  </small>
                )}
              </div>
              <button type="button" className="icon-button" title="Structure options">
                <MoreHorizontal size={16} />
              </button>
            </div>
            <div className="document-toolbar content-toolbar" aria-label="Content node actions">
              <button
                type="button"
                title="Insert content"
                disabled={!record}
                onClick={() => setInsertDialog("content")}
              >
                <Plus size={18} />
              </button>
              {selectedNodeHasHidden && (
                <button
                  type="button"
                  className={cx(selectedNode?.properties?.hidden && "is-active")}
                  title={selectedNode?.properties?.hidden ? "Show content" : "Hide content"}
                  disabled={!selectedNode}
                  onClick={toggleSelectedVisibility}
                >
                  {selectedNode?.properties?.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}
              <span className="document-toolbar__separator" />
              <button
                type="button"
                title="Duplicate selected content"
                disabled={!selectedContentIds.size || saving}
                onClick={duplicateSelectedContent}
              >
                <Copy size={18} />
              </button>
              <button
                type="button"
                title="Copy selected content"
                disabled={!copyableContentNodes.length}
                onClick={copySelectedContent}
              >
                <ClipboardCopy size={18} />
              </button>
              <button
                type="button"
                title="Paste copied content"
                disabled={!contentPasteDestination}
                onClick={pasteCopiedContent}
              >
                <ClipboardPaste size={18} />
              </button>
              <button
                type="button"
                className="danger"
                title="Delete selected content"
                disabled={!selectedContentIds.size || saving}
                onClick={deleteTreeSelection}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="rail-scroll" onClick={clearContentSelection}>
              {loading && !record ? (
                <div className="panel-loader">
                  <Spinner />
                </div>
              ) : record ? (
                <ContentTree
                  record={record}
                  nodeTypes={nodeTypes}
                  selectedIds={selectedContentIds}
                  selectionAnchor={contentSelectionAnchor}
                  onSelectionChange={changeContentSelection}
                  expanded={contentExpanded}
                  onToggle={(id) => toggleSet(setContentExpanded, id)}
                  onMove={moveContentByDrag}
                  dragEnabled={!saving}
                />
              ) : (
                <EmptyState title="No item selected" />
              )}
            </div>
          </section>
          </aside>
        )}

        {!isTableView && (
          <ResizeHandle
            axis="x"
            label="Resize collection trees and preview"
            onResize={resizeTreeLeft}
          />
        )}

        {!isTableView && (
          <section className="center-pane">
            <div className="pane-heading">
              <div className="breadcrumbs" ref={breadcrumbRef}>
                <span>{collection?.label}</span>
                {selectedNodePath.length ? (
                  selectedNodePath.map((node, index) => {
                    const label =
                      index === 0
                        ? node.properties?.title || node.id
                        : nodeTypes[node.type]?.label || node.type;
                    const isCurrent = index === selectedNodePath.length - 1;
                    return (
                      <span className="breadcrumb-segment" key={node.id}>
                        <ChevronRight size={13} />
                        {isCurrent ? (
                          <strong title={label}>{label}</strong>
                        ) : (
                          <span title={label}>{label}</span>
                        )}
                      </span>
                    );
                  })
                ) : (
                  <span className="breadcrumb-segment">
                    <ChevronRight size={13} />
                    <strong>No selection</strong>
                  </span>
                )}
              </div>
              <div className="pane-heading__right">
                <span className="status-pill">
                  <i />
                  Draft workspace
                </span>
              </div>
            </div>
            {record ? (
              <Preview record={record} selectedId={selectedId} nodeTypes={nodeTypes} />
            ) : (
              <EmptyState title={`No ${collection?.label_singular?.toLowerCase()} selected`} />
            )}
          </section>
        )}

        <ResizeHandle
          axis="x"
          label={
            isTableView
              ? "Resize table and inspector"
              : "Resize preview and inspector"
          }
          onResize={resizeInspector}
        />

        <aside className="right-rail">
          <div className="pane-heading">
            {multipleTreeSelection ? (
              <strong className="inspector-selection-title">Selection</strong>
            ) : (
              <div className="inspector-tabs">
                {inspectorPanels.map((panel) => (
                  <button
                    type="button"
                    key={panel.name}
                    className={cx(effectivePanel === panel.name && "is-active")}
                    onClick={() => setActivePanel(panel.name)}
                  >
                    {panel.label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="icon-button" title="Collapse inspector">
              <Menu size={16} />
            </button>
          </div>
          {multipleTreeSelection ? (
            <MultiSelectionNotice
              count={multipleTreeSelection.count}
              label={multipleTreeSelection.label}
              icon={multipleTreeSelection.icon}
            />
          ) : loading && !record ? (
            <div className="panel-loader">
              <Spinner />
            </div>
          ) : (
            <Inspector
              record={record}
              selectedId={selectedId}
              nodeTypes={nodeTypes}
              collection={collection}
              collections={collections}
              items={items}
              activePanel={effectivePanel}
              onPropertyChange={changeProperty}
              onMove={moveSelected}
              onDelete={requestDeleteSelectedContent}
              onDuplicate={duplicateSelectedContent}
              onDuplicateRecord={duplicateCurrentRecord}
              onDeleteRecord={requestDeleteCurrentRecord}
              onRenameFile={regenerateRecordFilename}
              renameDisabled={saving}
            />
          )}
        </aside>
      </main>

      {error && (
        <div className="error-banner">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}

      {insertDialog && (
        <InsertionDialog
          kind={insertDialog}
          modes={
            insertDialog === "collection"
              ? collectionInsertModes
              : contentInsertModes
          }
          nodeTypes={nodeTypes}
          collection={insertDialog === "collection" ? collection : undefined}
          collections={collections}
          existingIds={items.map((item) => item.id)}
          onCancel={() => setInsertDialog(null)}
          onInsert={
            insertDialog === "collection"
              ? insertCollectionItem
              : insertContentNode
          }
        />
      )}

      {confirmation && (
        <ConfirmationDialog
          {...confirmation}
          onCancel={() => setConfirmation(null)}
        />
      )}

    </div>
  );
}
