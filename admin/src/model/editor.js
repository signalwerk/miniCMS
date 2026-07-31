import {
  AlignLeft,
  Columns3,
  FileText,
  Files,
  Image,
  Layers3,
  LayoutTemplate,
  Menu,
  Newspaper,
  PanelLeft,
  Search,
  Settings2
} from "lucide-react";
import { sanitizeFilenameStem } from "../../shared/slug.js";

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
  search: Search,
  settings: Settings2
};
const ICON_NAMES = Object.keys(ICONS);

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
const LAYOUT_STORAGE_KEY = "minicms:layout:v1";
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
    value = field.required === false
      ? ""
      : optionValue(field.options?.[0]) ?? "";
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


export {
  DRAG_OVERLAY_MODIFIERS,
  ICON_NAMES,
  TREE_AUTO_SCROLL,
  LAYOUT_STORAGE_KEY,
  RESIZE_HANDLE_SIZE,
  MIN_TREE_WIDTH,
  MAX_TREE_WIDTH,
  MIN_INSPECTOR_WIDTH,
  MAX_INSPECTOR_WIDTH,
  MIN_PREVIEW_WIDTH,
  MIN_TABLE_WIDTH,
  MIN_COLLECTION_TREE_HEIGHT,
  MIN_CONTENT_TREE_HEIGHT,
  DEFAULT_LAYOUT_PREFERENCES,
  buildHierarchy,
  clampNumber,
  cloneContentNode,
  collectNodeIds,
  collectionCopyContext,
  collectionEntries,
  collectionHierarchyValue,
  collectionInsertionModes,
  collectionNameFromHash,
  contentInsertionModes,
  contentPasteTarget,
  createUuid,
  cx,
  defaultFieldValue,
  defaultProperties,
  descendantIds,
  findLocation,
  fitLayoutPreferences,
  getNode,
  getNodePath,
  iconFor,
  newNode,
  nextTreeSelection,
  optionValue,
  readLayoutPreferences,
  refreshUuidFields,
  replaceCollectionHash,
  selectedTopLevelContentNodes,
  slugifyId,
  typeField,
  typeFields,
  uniqueRecordId,
  updateNode
};
