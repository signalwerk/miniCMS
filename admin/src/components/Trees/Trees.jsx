import {
  ChevronDown,
  ChevronRight,
  FileText,
  Layers3,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import "./Trees.scss";
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
import {
  DRAG_OVERLAY_MODIFIERS,
  TREE_AUTO_SCROLL,
  buildHierarchy,
  cx,
  descendantIds,
  getNode,
  iconFor,
  nextTreeSelection
} from "../../model/editor.js";
import { EmptyState } from "../Common/Common.jsx";

function HiddenBadge({ label = "Hidden" }) {
  return (
    <span className="tree-row__hidden-badge" role="img" aria-label={label}>
      <X size={9} strokeWidth={2.4} aria-hidden="true" />
    </span>
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
  type,
  depth,
  childrenCount,
  isExpanded,
  selected,
  dragEnabled,
  insideDrop,
  onSelect,
  onToggle
}) {
  const Icon = iconFor(type?.icon, FileText);
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
      icon: type?.icon,
      nodeKind: type?.kind || "document"
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
      <span className="tree-row__type-icon">
        <Icon size={15} strokeWidth={1.7} />
        {item.hidden && (
          <HiddenBadge label={`${type?.label || "Item"} hidden`} />
        )}
      </span>
      <span className="tree-row__label">{item.title}</span>
    </button>
  );
}

function CollectionTree({
  items,
  collection,
  nodeTypes = {},
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
            type={nodeTypes[item.type] ?? nodeTypes[collection.node_type]}
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
        {node.properties?.hidden && <HiddenBadge />}
      </span>
      <span className="tree-row__label">{label}</span>
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
    if (!sameSlot) {
      const sourceParent = getNode(record, activeDrag.source?.parentId);
      const sourceSlot = nodeTypes[sourceParent?.type]?.slots?.[
        activeDrag.source?.slotName
      ];
      const sourceChildren = sourceParent?.slots?.[
        activeDrag.source?.slotName
      ] ?? [];
      if (sourceSlot?.min && sourceChildren.length <= sourceSlot.min) {
        return false;
      }
    }
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


export { CollectionTree, ContentTree };
