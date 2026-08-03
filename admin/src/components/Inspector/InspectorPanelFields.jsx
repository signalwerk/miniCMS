import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Settings2
} from "lucide-react";
import { Fragment, useState } from "react";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { cx, iconFor } from "../../model/editor.js";
import { imageSource } from "../../model/image.js";
import {
  displayValue,
  groupsForPanel,
  systemFieldValue
} from "../../model/views.js";
import { EmptyState } from "../Common/Common.jsx";

function ReadOnlyDetailField({ field, value, action }) {
  const adapter = useAdapter();
  const formatted = displayValue(value, field);
  const image = field.display === "image"
    ? adapter.resolveImageUrl(imageSource(value), {
        width: 640,
        height: 640,
        fit: "inside"
      })
    : "";
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

function InspectorPanelFields({
  record,
  node,
  type,
  panelName,
  includeInfo = false,
  panelFocused = false,
  collection,
  item,
  renderField,
  onRenameFile,
  renameDisabled = false
}) {
  const groups = groupsForPanel(
    type,
    panelName,
    includeInfo,
    node.properties ?? {}
  );

  return (
    <div className="inspector__fields">
      {groups.map((group) => (
        <InspectorGroup
          key={`${node.id}-${panelName}-${group.name}`}
          group={group}
          panelFocused={panelFocused}
        >
          {group.fields.map((field) => (
            <Fragment key={field.name}>
              {field.system || field.mode === "read" ? (
                <ReadOnlyDetailField
                  field={field}
                  value={
                    field.system
                      ? systemFieldValue(field.name, record, collection, item)
                      : node.properties?.[field.name]
                  }
                  action={
                    field.name === "$filename" &&
                    collection.slug &&
                    onRenameFile ? (
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
                renderField(field)
              )}
            </Fragment>
          ))}
        </InspectorGroup>
      ))}

      {!groups.length && (
        <EmptyState icon={Settings2} title="No fields configured">
          Assign fields to a group in this panel in cms.config.yml.
        </EmptyState>
      )}
    </div>
  );
}

export { InspectorGroup, InspectorPanelFields, ReadOnlyDetailField };
