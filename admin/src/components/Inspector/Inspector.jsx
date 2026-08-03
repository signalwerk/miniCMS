import {
  ArrowDown,
  ArrowUp,
  Copy,
  Layers3,
  Maximize2,
  Minimize2,
  Trash2
} from "lucide-react";
import { useEffect, useRef } from "react";
import "./Inspector.scss";
import {
  cx,
  findLocation,
  getNode,
  iconFor
} from "../../model/editor.js";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";
import { panelsFor } from "../../model/views.js";
import { EmptyState } from "../Common/Common.jsx";
import { Field } from "../Fields/Fields.jsx";
import { InspectorPanelFields } from "./InspectorPanelFields.jsx";

function Inspector({
  record,
  selectedId,
  nodeTypes,
  collection,
  collections,
  items,
  activePanel,
  focused = false,
  onFocus,
  onExitFocus,
  onPropertyChange,
  onPropertyPreview,
  onPropertyPreviewEnd,
  onMove,
  onDelete,
  onDuplicate,
  onDuplicateRecord,
  onDeleteRecord,
  onRenameFile,
  renameDisabled
}) {
  const inspectorRef = useRef(null);

  useEffect(() => {
    if (!focused) return undefined;
    const surface = inspectorRef.current;
    const previousFocus = document.activeElement;
    const restoreIsolation = isolateFocusSurface(surface);
    document.body.classList.add("inspector-focus-mode-open");
    const frame = requestAnimationFrame(() =>
      surface?.querySelector("[data-inspector-focus-exit]")?.focus()
    );

    function handleKeyDown(event) {
      const inNestedSurface = event.target?.closest?.(
        ".dialog-backdrop, [data-portal], [data-mantine-shared-portal-node], .tags-select__menu-portal, [data-field-popup-open='true']"
      );
      if (event.key === "Escape") {
        if (inNestedSurface) return;
        event.preventDefault();
        event.stopPropagation();
        onExitFocus();
        return;
      }
      if (event.key !== "Tab" || inNestedSurface) return;
      const focusable = focusableElements(surface);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!surface?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("inspector-focus-mode-open");
      restoreIsolation();
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [focused]);

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
  const currentItem = items.find((item) => item.id === record.id);
  return (
    <div
      ref={inspectorRef}
      className={cx("inspector", focused && "inspector--focus")}
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={focused ? `${currentPanel.label} focus mode` : undefined}
    >
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
        <button
          type="button"
          className="inspector__focus-action"
          data-inspector-focus-exit={focused ? "" : undefined}
          aria-label={
            focused
              ? `Exit focus mode for ${currentPanel.label}`
              : `Focus ${currentPanel.label}`
          }
          aria-pressed={focused}
          aria-keyshortcuts="Meta+Control+Alt+Shift+F"
          title={focused ? "Exit focus mode" : "Focus panel"}
          onClick={focused ? onExitFocus : onFocus}
        >
          {focused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      <InspectorPanelFields
        record={record}
        node={node}
        type={type}
        panelName={currentPanel.name}
        includeInfo={isDocument}
        panelFocused={focused}
        collection={collection}
        item={currentItem}
        onRenameFile={onRenameFile}
        renameDisabled={renameDisabled}
        renderField={(field) => (
          <Field
            field={field}
            value={node.properties?.[field.name]}
            collectionName={collection.name}
            collections={collections}
            nodeTypes={nodeTypes}
            onChange={(value) =>
              onPropertyChange(node.id, field.name, value)
            }
            onPreviewChange={(value) =>
              onPropertyPreview?.(node.id, field.name, value)
            }
            onPreviewEnd={onPropertyPreviewEnd}
          />
        )}
      />

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


export { Inspector };
