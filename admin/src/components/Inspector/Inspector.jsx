import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings2,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./Inspector.scss";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  cx,
  findLocation,
  getNode,
  iconFor
} from "../../model/editor.js";
import { imageSource } from "../../model/image.js";
import {
  displayValue,
  groupsForPanel,
  panelsFor,
  systemFieldValue
} from "../../model/views.js";
import { EmptyState } from "../Common/Common.jsx";
import { Field } from "../Fields/Fields.jsx";

function focusableElements(root) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable='true'], [tabindex]:not([tabindex='-1'])"
    )
  ).filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest("[hidden], [aria-hidden='true']")
  );
}

function isolateFocusSurface(surface) {
  const states = [];
  let current = surface;
  while (current?.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (
        sibling.matches(
          "[data-portal], [data-mantine-shared-portal-node], [aria-live], [role='alert'], [role='status'], .toast, .dialog-backdrop"
        )
      ) {
        continue;
      }
      states.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden")
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    current = parent;
    if (parent === document.body) break;
  }

  return () => {
    for (const state of states) {
      state.element.inert = state.inert;
      if (state.ariaHidden === null) {
        state.element.removeAttribute("aria-hidden");
      } else {
        state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
    }
  };
}

function ReadOnlyDetailField({ field, value, action }) {
  const adapter = useAdapter();
  const formatted = displayValue(value, field);
  const image = adapter.resolveMediaUrl(imageSource(value));
  const content =
    field.display === "code" ? (
      <code>{formatted}</code>
    ) : field.display === "image" && image ? (
      <img className="detail-value__image" src={image} alt="" />
    ) : field.display === "badge" ? (
      <span className="detail-value__badge">{formatted}</span>
    ) : (
      <span>{formatted}</span>
    );
  return (
    <div
      className={cx(
        "detail-value",
        field.appearance && `detail-value--${field.appearance}`,
        field.align && `detail-value--${field.align}`
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

function InspectorGroup({ group, children, panelFocused = false }) {
  const [open, setOpen] = useState(true);
  const GroupIcon = iconFor(group.icon, Settings2);
  const expanded = panelFocused || open;

  return (
    <section
      className={cx(
        "inspector-group",
        expanded && "inspector-group--open"
      )}
    >
      <div className="inspector-group__header">
        <button
          type="button"
          className="inspector-group__heading"
          onClick={() => {
            if (!panelFocused) setOpen((value) => !value);
          }}
          aria-expanded={expanded}
          aria-disabled={panelFocused || undefined}
          tabIndex={panelFocused ? -1 : undefined}
        >
          <span className="inspector-group__icon">
            <GroupIcon size={14} />
          </span>
          <span className="inspector-group__title">
            <strong>{group.label}</strong>
            {group.description && <small>{group.description}</small>}
          </span>
          {panelFocused ? null : expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
      </div>
      {expanded && <div className="inspector-group__content">{children}</div>}
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
  focused = false,
  onFocus,
  onExitFocus,
  onPropertyChange,
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
        ".dialog-backdrop, [data-portal], [data-mantine-shared-portal-node]"
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
  const groups = groupsForPanel(
    type,
    currentPanel.name,
    isDocument,
    node.properties ?? {}
  );
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

      <div className="inspector__fields">
        {groups.map((group) => (
          <InspectorGroup
            key={`${node.id}-${currentPanel.name}-${group.name}`}
            group={group}
            panelFocused={focused}
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

        {!groups.length && (
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


export { Inspector };
