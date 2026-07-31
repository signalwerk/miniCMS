import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers3,
  RefreshCw,
  Settings2,
  Trash2
} from "lucide-react";
import { useState } from "react";
import "./Inspector.scss";
import {
  collectionHierarchyValue,
  cx,
  findLocation,
  getNode,
  iconFor
} from "../../model/editor.js";
import {
  displayValue,
  groupsForPanel,
  panelsFor,
  systemFieldValue
} from "../../model/views.js";
import { EmptyState } from "../Common/Common.jsx";
import { Field } from "../Fields/Fields.jsx";

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


export { Inspector };
