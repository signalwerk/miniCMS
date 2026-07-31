import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Database,
  FileCog,
  FileText,
  FolderTree,
  GripVertical,
  Layers3,
  Plus,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import yaml from "js-yaml";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../../model/editor.js";
import { ConfirmationDialog } from "../Dialogs/Dialogs.jsx";
import { Spinner } from "../Common/Common.jsx";
import "./ConfigurationEditor.scss";

const WIDGET_OPTIONS = [
  ["string", "Single-line text"],
  ["text", "Long text"],
  ["markdown", "Rich text / Markdown"],
  ["select", "Dropdown"],
  ["boolean", "On / off"],
  ["datetime", "Date"],
  ["number", "Number"],
  ["image", "Image upload"],
  ["reference", "Collection reference"],
  ["uuid", "Generated UUID"]
];

const ICON_OPTIONS = [
  "file-text",
  "files",
  "newspaper",
  "image",
  "align-left",
  "columns-3",
  "panel-left",
  "layers",
  "layout-template",
  "menu",
  "search",
  "settings"
];

const DUMP_OPTIONS = {
  noRefs: true,
  lineWidth: 100,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false
};

function slugifyKey(value, fallback = "item") {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || fallback;
}

function labelFromKey(value) {
  const label = String(value || "")
    .replace(/[_-]+/g, " ")
    .trim();
  return label ? label[0].toUpperCase() + label.slice(1) : "Untitled";
}

function uniqueKey(mapping, preferred) {
  const base = slugifyKey(preferred);
  let candidate = base;
  let suffix = 2;
  while (Object.hasOwn(mapping ?? {}, candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function moveMappingEntry(mapping, key, direction) {
  const entries = Object.entries(mapping ?? {});
  const index = entries.findIndex(([name]) => name === key);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= entries.length) {
    return mapping;
  }
  const nextEntries = [...entries];
  const [moving] = nextEntries.splice(index, 1);
  nextEntries.splice(destination, 0, moving);
  return Object.fromEntries(nextEntries);
}

function setOptional(target, key, value) {
  if (value === "" || value === undefined || value === null) delete target[key];
  else target[key] = value;
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={cx("switch", checked && "switch--on")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function FormField({ label, hint, optional = false, children }) {
  return (
    <label className="configuration-form-field">
      <span className="configuration-form-field__label">
        <strong>{label}</strong>
        {optional && <small>Optional</small>}
      </span>
      {children}
      {hint && <small className="configuration-form-field__hint">{hint}</small>}
    </label>
  );
}

function TextInput({ value, onChange, ...props }) {
  return (
    <input
      {...props}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SelectInput({ value, onChange, children, ...props }) {
  return (
    <span className="configuration-select">
      <select
        {...props}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={14} />
    </span>
  );
}

function SectionHeading({ icon: Icon, title, description, action }) {
  return (
    <div className="configuration-section-heading">
      <span><Icon size={16} /></span>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function AdvancedSection({ title, description, children }) {
  return (
    <details className="configuration-advanced">
      <summary>
        <span>
          <SlidersHorizontal size={14} />
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="configuration-advanced__body">{children}</div>
    </details>
  );
}

function EntryActions({
  index,
  count,
  onMove,
  onDuplicate,
  onDelete
}) {
  return (
    <div className="configuration-entry-actions">
      <GripVertical size={14} />
      <button
        type="button"
        title="Move up"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={13} />
      </button>
      <button
        type="button"
        title="Move down"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={13} />
      </button>
      {onDuplicate && (
        <button type="button" title="Duplicate" onClick={onDuplicate}>
          <Copy size={13} />
        </button>
      )}
      <button
        type="button"
        className="danger"
        title="Delete"
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function MultiChoice({ options, value = [], onChange, emptyLabel }) {
  if (!options.length) {
    return <p className="configuration-muted">{emptyLabel || "No options available."}</p>;
  }
  return (
    <div className="configuration-choice-grid">
      {options.map(([key, label]) => {
        const selected = value.includes(key);
        return (
          <button
            type="button"
            key={key}
            className={cx(selected && "is-selected")}
            onClick={() =>
              onChange(
                selected
                  ? value.filter((item) => item !== key)
                  : [...value, key]
              )
            }
          >
            <span>{selected && <Check size={11} />}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function AddEntryDialog({
  title,
  description,
  existing,
  label = "Name",
  onCancel,
  onCreate
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const resolvedKey = slugifyKey(key, "");
  const invalid = !name.trim() || !resolvedKey || Object.hasOwn(existing, resolvedKey);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop configuration-dialog-backdrop">
      <form
        className="dialog configuration-add-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) onCreate({ key: resolvedKey, label: name.trim() });
        }}
      >
        <div className="dialog__top">
          <span className="dialog__icon"><Plus size={18} /></span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="dialog__body configuration-add-dialog__body">
          <FormField label={label}>
            <TextInput
              autoFocus
              value={name}
              onChange={(value) => {
                setName(value);
                if (!keyEdited) setKey(slugifyKey(value, ""));
              }}
            />
          </FormField>
          <FormField
            label="Configuration key"
            hint="A stable technical identifier. It cannot contain spaces."
          >
            <TextInput
              value={key}
              onChange={(value) => {
                setKeyEdited(true);
                setKey(value);
              }}
            />
          </FormField>
          {resolvedKey && Object.hasOwn(existing, resolvedKey) && (
            <p className="configuration-inline-error">
              <CircleAlert size={14} /> “{resolvedKey}” already exists.
            </p>
          )}
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={invalid}>
            <Plus size={14} /> Add
          </button>
        </div>
      </form>
    </div>
  );
}

function SiteEditor({ site, update }) {
  return (
    <div className="configuration-editor-pane">
      <SectionHeading
        icon={Settings2}
        title="Project settings"
        description="The public identity and media defaults for this project."
      />
      <section className="configuration-card configuration-card--form">
        <FormField label="Project name">
          <TextInput
            value={site.name}
            onChange={(value) => update((next) => {
              next.site.name = value;
            })}
          />
        </FormField>
        <FormField label="Language">
          <TextInput
            value={site.locale}
            onChange={(value) => update((next) => {
              next.site.locale = value;
            })}
            placeholder="en"
          />
        </FormField>
      </section>
      <AdvancedSection
        title="Media paths"
        description="Change these only when the project’s public file setup differs."
      >
        <FormField label="Media storage folder">
          <TextInput
            value={site.media_folder}
            onChange={(value) => update((next) => {
              next.site.media_folder = value;
            })}
          />
        </FormField>
        <FormField label="Public media URL">
          <TextInput
            value={site.public_folder}
            onChange={(value) => update((next) => {
              next.site.public_folder = value;
            })}
          />
        </FormField>
      </AdvancedSection>
    </div>
  );
}

function SelectOptionsEditor({ options = [], onChange }) {
  const normalized = options.map((option) =>
    typeof option === "object"
      ? { label: option.label ?? option.value, value: option.value ?? "" }
      : { label: String(option), value: option }
  );
  return (
    <div className="configuration-options">
      <div className="configuration-subheading">
        <div>
          <strong>Dropdown options</strong>
          <small>Add the choices editors can select.</small>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          onClick={() =>
            onChange([...normalized, { label: "New option", value: "new_option" }])
          }
        >
          <Plus size={13} /> Add option
        </button>
      </div>
      {normalized.map((option, index) => (
        <div className="configuration-option-row" key={index}>
          <TextInput
            value={option.label}
            aria-label={`Option ${index + 1} label`}
            placeholder="Editor label"
            onChange={(value) =>
              onChange(normalized.map((item, itemIndex) =>
                itemIndex === index ? { ...item, label: value } : item
              ))
            }
          />
          <TextInput
            value={option.value}
            aria-label={`Option ${index + 1} value`}
            placeholder="stored_value"
            onChange={(value) =>
              onChange(normalized.map((item, itemIndex) =>
                itemIndex === index ? { ...item, value } : item
              ))
            }
          />
          <button
            type="button"
            className="configuration-icon-button danger"
            title="Remove option"
            onClick={() => onChange(normalized.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {!normalized.length && (
        <p className="configuration-muted">No options yet.</p>
      )}
    </div>
  );
}

function FieldEditor({
  fieldKey,
  field,
  index,
  count,
  collections,
  onChange,
  onMove,
  onDuplicate,
  onDelete
}) {
  const widget = field.widget || "string";
  return (
    <article className="configuration-entry-card">
      <div className="configuration-entry-card__top">
        <span className="configuration-entry-card__identity">
          <FileCog size={15} />
          <span>
            <strong>{field.label || labelFromKey(fieldKey)}</strong>
            <code>{fieldKey}</code>
          </span>
        </span>
        <EntryActions
          index={index}
          count={count}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
      <div className="configuration-entry-card__grid">
        <FormField label="Label">
          <TextInput
            value={field.label}
            onChange={(value) => onChange((nextField) => {
              nextField.label = value;
            })}
          />
        </FormField>
        <FormField label="Input type">
          <SelectInput
            value={widget}
            onChange={(value) => onChange((nextField) => {
              nextField.widget = value;
              if (value === "select" && !Array.isArray(nextField.options)) {
                nextField.options = [];
              } else if (value !== "select") {
                delete nextField.options;
              }
              if (value !== "reference") {
                delete nextField.collection;
                delete nextField.value_field;
              }
            })}
          >
            {WIDGET_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectInput>
        </FormField>
      </div>
      <div className="configuration-inline-setting">
        <span>
          <strong>Required</strong>
          <small>Editors must provide a value.</small>
        </span>
        <Switch
          checked={field.required !== false}
          label={`${field.label || fieldKey} required`}
          onChange={(checked) => onChange((nextField) => {
            nextField.required = checked;
          })}
        />
      </div>
      {widget === "select" && (
        <SelectOptionsEditor
          options={field.options}
          onChange={(options) => onChange((nextField) => {
            nextField.options = options;
            if (
              nextField.default !== undefined &&
              !options.some((option) => option.value === nextField.default)
            ) {
              delete nextField.default;
            }
          })}
        />
      )}
      {widget === "reference" && (
        <div className="configuration-entry-card__grid">
          <FormField label="Referenced collection">
            <SelectInput
              value={field.collection}
              onChange={(value) => onChange((nextField) => {
                nextField.collection = value;
              })}
            >
              <option value="">Choose a collection…</option>
              {Object.entries(collections).map(([key, collection]) => (
                <option key={key} value={key}>{collection.label || key}</option>
              ))}
            </SelectInput>
          </FormField>
        </div>
      )}
      <AdvancedSection
        title="Advanced field settings"
        description="Defaults, help text, and widget-specific behavior."
      >
        <FormField label="Help text" optional>
          <TextInput
            value={field.hint}
            onChange={(value) => onChange((nextField) => {
              setOptional(nextField, "hint", value);
            })}
          />
        </FormField>
        {widget === "boolean" ? (
          <div className="configuration-inline-setting">
            <span><strong>Default value</strong></span>
            <Switch
              checked={Boolean(field.default)}
              label={`${field.label || fieldKey} default`}
              onChange={(checked) => onChange((nextField) => {
                nextField.default = checked;
              })}
            />
          </div>
        ) : widget === "select" ? (
          <FormField label="Default option" optional>
            <SelectInput
              value={field.default}
              onChange={(value) => onChange((nextField) => {
                setOptional(nextField, "default", value);
              })}
            >
              <option value="">No default</option>
              {(field.options ?? []).map((option) => {
                const item = typeof option === "object"
                  ? option
                  : { label: option, value: option };
                return <option key={item.value} value={item.value}>{item.label}</option>;
              })}
            </SelectInput>
          </FormField>
        ) : !["uuid", "image", "reference"].includes(widget) ? (
          <FormField label="Default value" optional>
            <TextInput
              type={widget === "number" ? "number" : "text"}
              value={field.default}
              onChange={(value) => onChange((nextField) => {
                const nextValue =
                  widget === "number" && value !== "" ? Number(value) : value;
                setOptional(nextField, "default", nextValue);
              })}
            />
          </FormField>
        ) : null}
        {widget === "image" && (
          <FormField
            label="Accepted file types"
            hint="A comma-separated browser accept value."
            optional
          >
            <TextInput
              value={field.accept}
              placeholder="image/jpeg,image/png,image/webp"
              onChange={(value) => onChange((nextField) => {
                setOptional(nextField, "accept", value);
              })}
            />
          </FormField>
        )}
        {widget === "reference" && (
          <FormField
            label="Stored reference field"
            hint="Leave empty to use the collection’s reference view value."
            optional
          >
            <TextInput
              value={field.value_field}
              onChange={(value) => onChange((nextField) => {
                setOptional(nextField, "value_field", value);
              })}
            />
          </FormField>
        )}
        {widget !== "uuid" && (
          <div className="configuration-inline-setting">
            <span>
              <strong>Read only</strong>
              <small>Show the value without allowing edits.</small>
            </span>
            <Switch
              checked={field.readonly === true}
              label={`${field.label || fieldKey} read only`}
              onChange={(checked) => onChange((nextField) => {
                if (checked) nextField.readonly = true;
                else delete nextField.readonly;
              })}
            />
          </div>
        )}
        {widget === "uuid" && (
          <div className="configuration-inline-setting">
            <span>
              <strong>Read only</strong>
              <small>Keep generated UUIDs protected from manual edits.</small>
            </span>
            <Switch
              checked={field.readonly !== false}
              label={`${field.label || fieldKey} read only`}
              onChange={(checked) => onChange((nextField) => {
                nextField.readonly = checked;
              })}
            />
          </div>
        )}
      </AdvancedSection>
    </article>
  );
}

function SlotEditor({
  slotKey,
  slot,
  index,
  count,
  nodeTypes,
  onChange,
  onMove,
  onDelete
}) {
  return (
    <article className="configuration-entry-card configuration-entry-card--compact">
      <div className="configuration-entry-card__top">
        <span className="configuration-entry-card__identity">
          <FolderTree size={15} />
          <span>
            <strong>{slot.label || labelFromKey(slotKey)}</strong>
            <code>{slotKey}</code>
          </span>
        </span>
        <EntryActions
          index={index}
          count={count}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
      <FormField label="Label">
        <TextInput
          value={slot.label}
          onChange={(value) => onChange((nextSlot) => {
            nextSlot.label = value;
          })}
        />
      </FormField>
      <FormField label="Allowed content types">
        <MultiChoice
          options={Object.entries(nodeTypes).map(([key, type]) => [
            key,
            type.label || key
          ])}
          value={slot.allowed_types ?? []}
          onChange={(value) => onChange((nextSlot) => {
            nextSlot.allowed_types = value;
          })}
        />
      </FormField>
      <div className="configuration-entry-card__grid">
        <FormField label="Minimum items" optional>
          <TextInput
            type="number"
            min="0"
            value={slot.min}
            onChange={(value) => onChange((nextSlot) => {
              setOptional(nextSlot, "min", value === "" ? "" : Number(value));
            })}
          />
        </FormField>
        <FormField label="Maximum items" optional>
          <TextInput
            type="number"
            min="1"
            value={slot.max}
            onChange={(value) => onChange((nextSlot) => {
              setOptional(nextSlot, "max", value === "" ? "" : Number(value));
            })}
          />
        </FormField>
      </div>
    </article>
  );
}

function InspectorLayoutEditor({
  type,
  updateType,
  onAdd
}) {
  const panels = type.views?.detail?.panels ?? {};
  const fields = Object.entries(type.fields ?? {}).map(([key, field]) => [
    key,
    field.label || key
  ]);
  return (
    <AdvancedSection
      title="Inspector layout"
      description="Organize fields into ordered tabs and groups."
    >
      <div className="configuration-subheading">
        <div>
          <strong>Inspector panels</strong>
          <small>Panel and group order follows this list.</small>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          onClick={() => onAdd({ kind: "panel" })}
        >
          <Plus size={13} /> Add panel
        </button>
      </div>
      {Object.entries(panels).map(([panelKey, panel], panelIndex) => (
        <article className="configuration-layout-panel" key={panelKey}>
          <div className="configuration-entry-card__top">
            <span className="configuration-entry-card__identity">
              <Layers3 size={15} />
              <span>
                <strong>{panel.label || labelFromKey(panelKey)}</strong>
                <code>{panelKey}</code>
              </span>
            </span>
            <EntryActions
              index={panelIndex}
              count={Object.keys(panels).length}
              onMove={(direction) => updateType((nextType) => {
                nextType.views.detail.panels = moveMappingEntry(
                  nextType.views.detail.panels,
                  panelKey,
                  direction
                );
              })}
              onDelete={() => updateType((nextType) => {
                delete nextType.views.detail.panels[panelKey];
              })}
            />
          </div>
          <FormField label="Panel label">
            <TextInput
              value={panel.label}
              onChange={(value) => updateType((nextType) => {
                nextType.views.detail.panels[panelKey].label = value;
              })}
            />
          </FormField>
          <div className="configuration-subheading">
            <div>
              <strong>Groups</strong>
              <small>Groups separate related editing tasks.</small>
            </div>
            <button
              type="button"
              className="configuration-small-button"
              onClick={() => onAdd({ kind: "group", panelKey })}
            >
              <Plus size={13} /> Add group
            </button>
          </div>
          {Object.entries(panel.groups ?? {}).map(([groupKey, group], groupIndex) => (
            <div className="configuration-layout-group" key={groupKey}>
              <div className="configuration-layout-group__top">
                <span><strong>{group.label || labelFromKey(groupKey)}</strong><code>{groupKey}</code></span>
                <EntryActions
                  index={groupIndex}
                  count={Object.keys(panel.groups ?? {}).length}
                  onMove={(direction) => updateType((nextType) => {
                    const groups = nextType.views.detail.panels[panelKey].groups;
                    nextType.views.detail.panels[panelKey].groups =
                      moveMappingEntry(groups, groupKey, direction);
                  })}
                  onDelete={() => updateType((nextType) => {
                    delete nextType.views.detail.panels[panelKey].groups[groupKey];
                  })}
                />
              </div>
              <div className="configuration-entry-card__grid">
                <FormField label="Group label">
                  <TextInput
                    value={group.label}
                    onChange={(value) => updateType((nextType) => {
                      nextType.views.detail.panels[panelKey].groups[groupKey].label = value;
                    })}
                  />
                </FormField>
                <FormField label="Icon" optional>
                  <SelectInput
                    value={group.icon}
                    onChange={(value) => updateType((nextType) => {
                      setOptional(
                        nextType.views.detail.panels[panelKey].groups[groupKey],
                        "icon",
                        value
                      );
                    })}
                  >
                    <option value="">Default</option>
                    {ICON_OPTIONS.map((icon) => <option key={icon}>{icon}</option>)}
                  </SelectInput>
                </FormField>
              </div>
              <FormField label="Description" optional>
                <TextInput
                  value={group.description}
                  onChange={(value) => updateType((nextType) => {
                    setOptional(
                      nextType.views.detail.panels[panelKey].groups[groupKey],
                      "description",
                      value
                    );
                  })}
                />
              </FormField>
              <FormField label="Fields">
                <MultiChoice
                  options={fields}
                  value={(group.fields ?? []).filter((field) => typeof field === "string")}
                  onChange={(value) => updateType((nextType) => {
                    nextType.views.detail.panels[panelKey].groups[groupKey].fields = value;
                  })}
                  emptyLabel="Add fields to this content type first."
                />
              </FormField>
            </div>
          ))}
        </article>
      ))}
      {!Object.keys(panels).length && (
        <p className="configuration-muted">No inspector panels configured.</p>
      )}
    </AdvancedSection>
  );
}

function TypeEditor({
  typeKey,
  type,
  nodeTypes,
  collections,
  updateType,
  onMoveType,
  onDeleteType,
  onAdd
}) {
  const fields = type.fields ?? {};
  const slots = type.slots ?? {};
  return (
    <div className="configuration-editor-pane">
      <SectionHeading
        icon={Layers3}
        title={type.label || labelFromKey(typeKey)}
        description={`Content type · ${typeKey}`}
        action={
          <div className="configuration-heading-actions">
            <button type="button" title="Move type up" onClick={() => onMoveType(-1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" title="Move type down" onClick={() => onMoveType(1)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" className="danger" title="Delete type" onClick={onDeleteType}>
              <Trash2 size={14} />
            </button>
          </div>
        }
      />
      <section className="configuration-card configuration-card--form">
        <div className="configuration-entry-card__grid">
          <FormField label="Type label">
            <TextInput
              value={type.label}
              onChange={(value) => updateType((nextType) => {
                nextType.label = value;
              })}
            />
          </FormField>
          <FormField label="Purpose">
            <SelectInput
              value={type.kind || "content"}
              onChange={(value) => updateType((nextType) => {
                nextType.kind = value;
              })}
            >
              <option value="document">Collection document</option>
              <option value="content">Content element</option>
              <option value="structure">Layout / structure</option>
            </SelectInput>
          </FormField>
          <FormField label="Icon">
            <SelectInput
              value={type.icon || "file-text"}
              onChange={(value) => updateType((nextType) => {
                nextType.icon = value;
              })}
            >
              {ICON_OPTIONS.map((icon) => <option key={icon}>{icon}</option>)}
            </SelectInput>
          </FormField>
        </div>
      </section>

      <div className="configuration-subheading configuration-subheading--major">
        <div>
          <strong>Fields</strong>
          <small>The properties editors can fill in for this type.</small>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          onClick={() => onAdd({ kind: "field" })}
        >
          <Plus size={13} /> Add field
        </button>
      </div>
      <div className="configuration-entry-list">
        {Object.entries(fields).map(([fieldKey, field], index) => (
          <FieldEditor
            key={fieldKey}
            fieldKey={fieldKey}
            field={field}
            index={index}
            count={Object.keys(fields).length}
            collections={collections}
            onChange={(change) => updateType((nextType) => {
              change(nextType.fields[fieldKey]);
            })}
            onMove={(direction) => updateType((nextType) => {
              nextType.fields = moveMappingEntry(nextType.fields, fieldKey, direction);
              for (const panel of Object.values(
                nextType.views?.detail?.panels ?? {}
              )) {
                for (const group of Object.values(panel.groups ?? {})) {
                  const references = group.fields ?? [];
                  const referenceIndex = references.findIndex(
                    (reference) =>
                      (typeof reference === "string"
                        ? reference
                        : reference.field) === fieldKey
                  );
                  const destination = referenceIndex + direction;
                  if (
                    referenceIndex !== -1 &&
                    destination >= 0 &&
                    destination < references.length
                  ) {
                    const [moving] = references.splice(referenceIndex, 1);
                    references.splice(destination, 0, moving);
                  }
                }
              }
            })}
            onDuplicate={() => updateType((nextType) => {
              const duplicateKey = uniqueKey(nextType.fields, `${fieldKey}_copy`);
              const entries = Object.entries(nextType.fields);
              const sourceIndex = entries.findIndex(([key]) => key === fieldKey);
              entries.splice(sourceIndex + 1, 0, [
                duplicateKey,
                {
                  ...structuredClone(nextType.fields[fieldKey]),
                  label: `${nextType.fields[fieldKey].label || labelFromKey(fieldKey)} copy`
                }
              ]);
              nextType.fields = Object.fromEntries(entries);
              for (const panel of Object.values(
                nextType.views?.detail?.panels ?? {}
              )) {
                for (const group of Object.values(panel.groups ?? {})) {
                  const referenceIndex = (group.fields ?? []).findIndex(
                    (reference) =>
                      (typeof reference === "string"
                        ? reference
                        : reference.field) === fieldKey
                  );
                  if (referenceIndex !== -1) {
                    group.fields.splice(referenceIndex + 1, 0, duplicateKey);
                    return;
                  }
                }
              }
            })}
            onDelete={() => onAdd({ kind: "delete-field", fieldKey })}
          />
        ))}
        {!Object.keys(fields).length && (
          <div className="configuration-empty-list">
            <FileCog size={20} />
            <strong>No fields yet</strong>
            <span>Add the first editable property.</span>
          </div>
        )}
      </div>

      <AdvancedSection
        title="Content areas"
        description="Allow this type to contain other structured content."
      >
        <div className="configuration-subheading">
          <div>
            <strong>Slots</strong>
            <small>Named places where child content may be inserted.</small>
          </div>
          <button
            type="button"
            className="configuration-small-button"
            onClick={() => onAdd({ kind: "slot" })}
          >
            <Plus size={13} /> Add content area
          </button>
        </div>
        <div className="configuration-entry-list">
          {Object.entries(slots).map(([slotKey, slot], index) => (
            <SlotEditor
              key={slotKey}
              slotKey={slotKey}
              slot={slot}
              index={index}
              count={Object.keys(slots).length}
              nodeTypes={nodeTypes}
              onChange={(change) => updateType((nextType) => {
                change(nextType.slots[slotKey]);
              })}
              onMove={(direction) => updateType((nextType) => {
                nextType.slots = moveMappingEntry(nextType.slots, slotKey, direction);
              })}
              onDelete={() => updateType((nextType) => {
                delete nextType.slots[slotKey];
                if (!Object.keys(nextType.slots).length) delete nextType.slots;
              })}
            />
          ))}
        </div>
      </AdvancedSection>

      <InspectorLayoutEditor
        type={type}
        updateType={updateType}
        onAdd={onAdd}
      />
    </div>
  );
}

function TableColumnsEditor({ collection, type, updateCollection }) {
  const fields = Object.entries(type?.fields ?? {});
  const columns = collection.views?.list?.columns ?? [];
  return (
    <section className="configuration-card">
      <div className="configuration-subheading">
        <div>
          <strong>Table columns</strong>
          <small>Choose what editors see in the collection list.</small>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          disabled={!fields.length}
          onClick={() => updateCollection((nextCollection) => {
            const field = fields[0];
            nextCollection.views.list.columns = [
              ...(nextCollection.views.list.columns ?? []),
              {
                field: field[0],
                label: field[1].label || labelFromKey(field[0]),
                width: "minmax(10rem, 1fr)",
                mode: "read"
              }
            ];
          })}
        >
          <Plus size={13} /> Add column
        </button>
      </div>
      <div className="configuration-table-columns">
        {columns.map((column, index) => {
          const configured =
            typeof column === "string" ? { field: column } : column;
          return (
            <article className="configuration-table-column" key={index}>
              <EntryActions
                index={index}
                count={columns.length}
                onMove={(direction) => updateCollection((nextCollection) => {
                  const nextColumns = [...nextCollection.views.list.columns];
                  const destination = index + direction;
                  if (destination < 0 || destination >= nextColumns.length) return;
                  const [moving] = nextColumns.splice(index, 1);
                  nextColumns.splice(destination, 0, moving);
                  nextCollection.views.list.columns = nextColumns;
                })}
                onDelete={() => updateCollection((nextCollection) => {
                  nextCollection.views.list.columns =
                    nextCollection.views.list.columns.filter((_, itemIndex) => itemIndex !== index);
                })}
              />
              <div className="configuration-entry-card__grid">
                <FormField label="Field">
                  <SelectInput
                    value={configured.field}
                    onChange={(value) => updateCollection((nextCollection) => {
                      nextCollection.views.list.columns[index] = {
                        ...configured,
                        field: value
                      };
                    })}
                  >
                    {fields.map(([key, field]) => (
                      <option key={key} value={key}>{field.label || key}</option>
                    ))}
                    <option value="$filename">File name</option>
                    <option value="$updated_at">Updated</option>
                  </SelectInput>
                </FormField>
                <FormField label="Column label">
                  <TextInput
                    value={configured.label}
                    onChange={(value) => updateCollection((nextCollection) => {
                      nextCollection.views.list.columns[index] = {
                        ...configured,
                        label: value
                      };
                    })}
                  />
                </FormField>
              </div>
              <AdvancedSection title="Column behavior">
                <div className="configuration-entry-card__grid">
                  <FormField label="Width">
                    <TextInput
                      value={configured.width}
                      placeholder="minmax(10rem, 1fr)"
                      onChange={(value) => updateCollection((nextCollection) => {
                        nextCollection.views.list.columns[index] = {
                          ...configured,
                          width: value
                        };
                      })}
                    />
                  </FormField>
                  <FormField label="Mode">
                    <SelectInput
                      value={configured.mode || "read"}
                      onChange={(value) => updateCollection((nextCollection) => {
                        nextCollection.views.list.columns[index] = {
                          ...configured,
                          mode: value
                        };
                      })}
                    >
                      <option value="read">Read only</option>
                      <option value="edit">Editable</option>
                    </SelectInput>
                  </FormField>
                  <FormField label="Display">
                    <SelectInput
                      value={configured.display || "text"}
                      onChange={(value) => updateCollection((nextCollection) => {
                        nextCollection.views.list.columns[index] = {
                          ...configured,
                          display: value
                        };
                      })}
                    >
                      {["text", "date", "datetime", "toggle", "select", "badge", "code", "image"].map(
                        (value) => <option key={value}>{value}</option>
                      )}
                    </SelectInput>
                  </FormField>
                  <FormField label="Alignment">
                    <SelectInput
                      value={configured.align || "left"}
                      onChange={(value) => updateCollection((nextCollection) => {
                        nextCollection.views.list.columns[index] = {
                          ...configured,
                          align: value
                        };
                      })}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </SelectInput>
                  </FormField>
                  <FormField label="Appearance">
                    <SelectInput
                      value={configured.appearance || ""}
                      onChange={(value) => updateCollection((nextCollection) => {
                        const nextColumn = {
                          ...configured
                        };
                        setOptional(nextColumn, "appearance", value);
                        nextCollection.views.list.columns[index] = nextColumn;
                      })}
                    >
                      <option value="">Default</option>
                      <option value="title">Title</option>
                      <option value="muted">Muted</option>
                      <option value="monospace">Monospaced</option>
                    </SelectInput>
                  </FormField>
                </div>
                <div className="configuration-inline-setting">
                  <span>
                    <strong>Sortable</strong>
                    <small>Allow editors to sort the table by this column.</small>
                  </span>
                  <Switch
                    checked={configured.sortable !== false}
                    label={`${configured.label || configured.field} sortable`}
                    onChange={(checked) => updateCollection((nextCollection) => {
                      nextCollection.views.list.columns[index] = {
                        ...configured,
                        sortable: checked
                      };
                    })}
                  />
                </div>
              </AdvancedSection>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CollectionEditor({
  collectionKey,
  collection,
  nodeTypes,
  updateCollection,
  onMove,
  onDelete
}) {
  const type = nodeTypes[collection.node_type];
  const fields = Object.entries(type?.fields ?? {}).map(([key, field]) => [
    key,
    field.label || key
  ]);
  const listType = collection.views?.list?.type || "tree";
  const hierarchyEnabled = Boolean(collection.hierarchy?.enabled);
  return (
    <div className="configuration-editor-pane">
      <SectionHeading
        icon={Database}
        title={collection.label || labelFromKey(collectionKey)}
        description={`Collection · ${collectionKey}`}
        action={
          <div className="configuration-heading-actions">
            <button type="button" title="Move collection up" onClick={() => onMove(-1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" title="Move collection down" onClick={() => onMove(1)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" className="danger" title="Delete collection" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </div>
        }
      />
      <section className="configuration-card configuration-card--form">
        <div className="configuration-entry-card__grid">
          <FormField label="Collection name">
            <TextInput
              value={collection.label}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.label = value;
              })}
            />
          </FormField>
          <FormField label="Singular name">
            <TextInput
              value={collection.label_singular}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.label_singular = value;
              })}
            />
          </FormField>
          <FormField label="Content type">
            <SelectInput
              value={collection.node_type}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.node_type = value;
                nextCollection.allowed_types = [value];
                nextCollection.views ??= {};
                nextCollection.views.list ??= { type: "tree" };
                delete nextCollection.views.list.search;
                delete nextCollection.views.list.sort;
                delete nextCollection.views.reference;
                if (nextCollection.views.list.type === "table") {
                  nextCollection.views.list.columns = [];
                } else {
                  delete nextCollection.views.list.columns;
                }
                if (nextCollection.hierarchy?.enabled) {
                  const fieldKeys = Object.keys(nodeTypes[value]?.fields ?? {});
                  nextCollection.hierarchy.id_field =
                    fieldKeys.includes("uuid") ? "uuid" : fieldKeys[0] || "";
                  nextCollection.hierarchy.allowed_child_types = [value];
                }
              })}
            >
              {Object.entries(nodeTypes).map(([key, nodeType]) => (
                <option key={key} value={key}>{nodeType.label || key}</option>
              ))}
            </SelectInput>
          </FormField>
          <FormField label="Editor view">
            <SelectInput
              value={listType}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.views ??= {};
                nextCollection.views.list ??= {};
                nextCollection.views.list.type = value;
                if (value === "table") {
                  nextCollection.views.list.columns ??= [];
                  delete nextCollection.hierarchy;
                }
              })}
            >
              <option value="tree">Hierarchy and preview</option>
              <option value="table">Sortable table</option>
            </SelectInput>
          </FormField>
        </div>
      </section>

      <section className="configuration-card configuration-card--form">
        <div className="configuration-subheading">
          <div>
            <strong>Storage</strong>
            <small>Where complete YAML records are saved.</small>
          </div>
        </div>
        <div className="configuration-entry-card__grid">
          <FormField label="Content folder">
            <TextInput
              value={collection.folder}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.folder = value;
              })}
            />
          </FormField>
          <FormField label="Filename pattern">
            <TextInput
              value={collection.slug}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.slug = value;
              })}
              placeholder="{{title}}-{{year}}-{{month}}"
            />
          </FormField>
        </div>
      </section>

      {listType === "table" && (
        <TableColumnsEditor
          collection={collection}
          type={type}
          updateCollection={updateCollection}
        />
      )}

      {listType === "tree" && (
        <section className="configuration-card">
          <div className="configuration-inline-setting">
            <span>
              <strong>Nested collection items</strong>
              <small>Allow records to be placed inside other records.</small>
            </span>
            <Switch
              checked={hierarchyEnabled}
              label="Nested collection items"
              onChange={(checked) => updateCollection((nextCollection) => {
                if (checked) {
                  nextCollection.hierarchy = {
                    enabled: true,
                    id_field: nextCollection.hierarchy?.id_field || "uuid",
                    parent_field:
                      nextCollection.hierarchy?.parent_field || "parent_uuid",
                    allowed_child_types:
                      nextCollection.hierarchy?.allowed_child_types ||
                      [nextCollection.node_type]
                  };
                } else {
                  delete nextCollection.hierarchy;
                }
              })}
            />
          </div>
          {hierarchyEnabled && (
            <div className="configuration-card__nested">
              <FormField label="Allowed child types">
                <MultiChoice
                  options={Object.entries(nodeTypes).map(([key, nodeType]) => [
                    key,
                    nodeType.label || key
                  ])}
                  value={collection.hierarchy?.allowed_child_types ?? []}
                  onChange={(value) => updateCollection((nextCollection) => {
                    nextCollection.hierarchy.allowed_child_types = value;
                  })}
                />
              </FormField>
            </div>
          )}
        </section>
      )}

      <AdvancedSection
        title="Advanced collection settings"
        description="Technical identifiers, search, hierarchy, and reference cards."
      >
        <div className="configuration-entry-card__grid">
          <FormField label="Icon" optional>
            <SelectInput
              value={collection.icon}
              onChange={(value) => updateCollection((nextCollection) => {
                setOptional(nextCollection, "icon", value);
              })}
            >
              <option value="">Default</option>
              {ICON_OPTIONS.map((icon) => <option key={icon}>{icon}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="File extension">
            <SelectInput
              value={collection.extension || "yml"}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.extension = value;
              })}
            >
              <option value="yml">.yml</option>
              <option value="yaml">.yaml</option>
            </SelectInput>
          </FormField>
          <FormField label="Title field">
            <SelectInput
              value={collection.identifier_field || "title"}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.identifier_field = value;
              })}
            >
              {fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Record summary template" optional>
            <TextInput
              value={collection.summary}
              placeholder="{{properties.title}}"
              onChange={(value) => updateCollection((nextCollection) => {
                setOptional(nextCollection, "summary", value);
              })}
            />
          </FormField>
        </div>
        <FormField label="Allowed root types">
          <MultiChoice
            options={Object.entries(nodeTypes).map(([key, nodeType]) => [
              key,
              nodeType.label || key
            ])}
            value={collection.allowed_types ?? [collection.node_type]}
            onChange={(value) => updateCollection((nextCollection) => {
              nextCollection.allowed_types = value;
            })}
          />
        </FormField>
        {hierarchyEnabled && (
          <div className="configuration-entry-card__grid">
            <FormField label="Hierarchy ID field">
              <SelectInput
                value={collection.hierarchy?.id_field}
                onChange={(value) => updateCollection((nextCollection) => {
                  nextCollection.hierarchy.id_field = value;
                })}
              >
                {fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </SelectInput>
            </FormField>
            <FormField label="Parent field">
              <TextInput
                value={collection.hierarchy?.parent_field}
                onChange={(value) => updateCollection((nextCollection) => {
                  nextCollection.hierarchy.parent_field = value;
                })}
              />
            </FormField>
          </div>
        )}
        <FormField label="Search fields">
          <MultiChoice
            options={fields}
            value={collection.views?.list?.search?.fields ?? []}
            onChange={(value) => updateCollection((nextCollection) => {
              nextCollection.views.list.search ??= {};
              nextCollection.views.list.search.fields = value;
            })}
          />
        </FormField>
        <div className="configuration-entry-card__grid">
          <FormField label="Default sort field" optional>
            <SelectInput
              value={collection.views?.list?.sort?.field}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.views.list.sort ??= {};
                setOptional(nextCollection.views.list.sort, "field", value);
              })}
            >
              <option value="">No default sort</option>
              {fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Sort direction">
            <SelectInput
              value={collection.views?.list?.sort?.direction || "asc"}
              onChange={(value) => updateCollection((nextCollection) => {
                nextCollection.views.list.sort ??= {};
                nextCollection.views.list.sort.direction = value;
              })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </SelectInput>
          </FormField>
        </div>
        <div className="configuration-subheading">
          <div>
            <strong>Reference card</strong>
            <small>How this collection appears in reference pickers.</small>
          </div>
        </div>
        <div className="configuration-entry-card__grid">
          {["value", "image", "title"].map((name) => (
            <FormField key={name} label={`${labelFromKey(name)} field`} optional>
              <SelectInput
                value={collection.views?.reference?.[name]}
                onChange={(value) => updateCollection((nextCollection) => {
                  nextCollection.views.reference ??= {};
                  setOptional(nextCollection.views.reference, name, value);
                })}
              >
                <option value="">Not configured</option>
                {fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </SelectInput>
            </FormField>
          ))}
        </div>
        <FormField label="Reference description fields" optional>
          <MultiChoice
            options={fields}
            value={
              Array.isArray(collection.views?.reference?.description)
                ? collection.views.reference.description
                : collection.views?.reference?.description
                  ? [collection.views.reference.description]
                  : []
            }
            onChange={(value) => updateCollection((nextCollection) => {
              nextCollection.views.reference ??= {};
              if (value.length) nextCollection.views.reference.description = value;
              else delete nextCollection.views.reference.description;
            })}
          />
        </FormField>
      </AdvancedSection>
    </div>
  );
}

function RawYamlEditor({ config, onApply }) {
  const [source, setSource] = useState(() =>
    `${yaml.dump(config, DUMP_OPTIONS).trimEnd()}\n`
  );
  const [error, setError] = useState("");

  return (
    <div className="configuration-editor-pane configuration-editor-pane--yaml">
      <SectionHeading
        icon={Braces}
        title="Expert YAML"
        description="Direct access for options the guided editor does not expose."
      />
      <div className="configuration-expert-warning">
        <CircleAlert size={15} />
        <span>
          Applying YAML replaces the current form draft. The server performs the
          final validation when you save.
        </span>
      </div>
      <textarea
        className="configuration-yaml"
        spellCheck="false"
        value={source}
        onChange={(event) => setSource(event.target.value)}
      />
      {error && (
        <p className="configuration-inline-error">
          <CircleAlert size={14} /> {error}
        </p>
      )}
      <div className="configuration-yaml-actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            setSource(`${yaml.dump(config, DUMP_OPTIONS).trimEnd()}\n`);
            setError("");
          }}
        >
          Reset from forms
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            try {
              const next = yaml.load(source, { schema: yaml.JSON_SCHEMA });
              if (
                !next ||
                typeof next !== "object" ||
                Array.isArray(next) ||
                !next.collections ||
                !next.node_types
              ) {
                throw new Error("The YAML must define collections and node_types.");
              }
              onApply(next);
              setError("");
            } catch (parseError) {
              setError(parseError.message);
            }
          }}
        >
          <Check size={14} /> Apply YAML to draft
        </button>
      </div>
    </div>
  );
}

export default function ConfigurationEditor({
  config,
  onClose,
  onSave
}) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [savedDraft, setSavedDraft] = useState(() => structuredClone(config));
  const [selection, setSelection] = useState({ section: "site", key: null });
  const [search, setSearch] = useState("");
  const [entryDialog, setEntryDialog] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft]
  );
  const collectionEntries = Object.entries(draft.collections ?? {});
  const typeEntries = Object.entries(draft.node_types ?? {});
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleCollections = collectionEntries.filter(([key, collection]) =>
    !normalizedSearch ||
    [key, collection.label, collection.label_singular].some((value) =>
      String(value || "").toLocaleLowerCase().includes(normalizedSearch)
    )
  );
  const visibleTypes = typeEntries.filter(([key, type]) =>
    !normalizedSearch ||
    [key, type.label, type.kind].some((value) =>
      String(value || "").toLocaleLowerCase().includes(normalizedSearch)
    )
  );

  function update(change) {
    setDraft((current) => {
      const next = structuredClone(current);
      next.site ??= {};
      next.collections ??= {};
      next.node_types ??= {};
      change(next);
      return next;
    });
  }

  function updateCollection(key, change) {
    update((next) => change(next.collections[key]));
  }

  function updateType(key, change) {
    update((next) => {
      next.node_types[key].fields ??= {};
      change(next.node_types[key]);
    });
  }

  function requestClose() {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmation({
      title: "Discard configuration changes?",
      description: "The Settings draft contains changes that have not been saved.",
      confirmLabel: "Discard changes",
      danger: true,
      onConfirm: onClose
    });
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || entryDialog || confirmation || saving) return;
      event.preventDefault();
      requestClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  });

  function createEntry({ key, label }) {
    const dialog = entryDialog;
    update((next) => {
      if (dialog.kind === "collection") {
        const nodeType = Object.keys(next.node_types)[0] || "";
        next.collections[key] = {
          label,
          label_singular: label.replace(/s$/i, "") || label,
          icon: "files",
          folder: `content/${key}`,
          extension: "yml",
          slug: "{{title}}-{{year}}-{{month}}",
          identifier_field: "title",
          node_type: nodeType,
          allowed_types: nodeType ? [nodeType] : [],
          views: { list: { type: "tree" } }
        };
        setSelection({ section: "collections", key });
      } else if (dialog.kind === "type") {
        next.node_types[key] = {
          label,
          kind: "content",
          icon: "file-text",
          fields: {}
        };
        setSelection({ section: "types", key });
      } else {
        const type = next.node_types[selection.key];
        if (dialog.kind === "field") {
          type.fields[key] = {
            label,
            widget: "string",
            required: false
          };
          type.views ??= {};
          type.views.detail ??= {};
          type.views.detail.panels ??= {};
          if (!Object.keys(type.views.detail.panels).length) {
            type.views.detail.panels.inspector = {
              label: "Inspector",
              groups: {
                content: {
                  label: "Content",
                  fields: []
                }
              }
            };
          }
          const firstPanel = Object.values(type.views.detail.panels)[0];
          firstPanel.groups ??= {};
          if (!Object.keys(firstPanel.groups).length) {
            firstPanel.groups.content = { label: "Content", fields: [] };
          }
          const firstGroup = Object.values(firstPanel.groups)[0];
          firstGroup.fields ??= [];
          firstGroup.fields.push(key);
        } else if (dialog.kind === "slot") {
          type.slots ??= {};
          type.slots[key] = { label, allowed_types: [] };
        } else if (dialog.kind === "panel") {
          type.views ??= {};
          type.views.detail ??= {};
          type.views.detail.panels ??= {};
          type.views.detail.panels[key] = { label, groups: {} };
        } else if (dialog.kind === "group") {
          const panel = type.views.detail.panels[dialog.panelKey];
          panel.groups ??= {};
          panel.groups[key] = { label, fields: [] };
        }
      }
    });
    setEntryDialog(null);
  }

  function entryDialogMapping() {
    if (!entryDialog) return {};
    if (entryDialog.kind === "collection") return draft.collections;
    if (entryDialog.kind === "type") return draft.node_types;
    const type = draft.node_types[selection.key];
    if (entryDialog.kind === "field") return type.fields;
    if (entryDialog.kind === "slot") return type.slots ?? {};
    if (entryDialog.kind === "panel") return type.views?.detail?.panels ?? {};
    if (entryDialog.kind === "group") {
      return type.views?.detail?.panels?.[entryDialog.panelKey]?.groups ?? {};
    }
    return {};
  }

  function requestDeleteType(typeKey) {
    if (typeEntries.length === 1) {
      setError("A project must keep at least one content type.");
      return;
    }
    const collectionUse = collectionEntries.find(
      ([, collection]) =>
        collection.node_type === typeKey ||
        collection.allowed_types?.includes(typeKey) ||
        collection.hierarchy?.allowed_child_types?.includes(typeKey)
    );
    const slotUse = typeEntries.find(([, type]) =>
      Object.values(type.slots ?? {}).some((slot) =>
        slot.allowed_types?.includes(typeKey)
      )
    );
    if (collectionUse || slotUse) {
      setError(
        `“${draft.node_types[typeKey].label || typeKey}” is still used by ${
          collectionUse
            ? `the ${collectionUse[1].label || collectionUse[0]} collection`
            : `the ${slotUse[1].label || slotUse[0]} content type`
        }. Remove that connection first.`
      );
      return;
    }
    setConfirmation({
      title: `Delete ${draft.node_types[typeKey].label || typeKey}?`,
      description: "This removes the type definition. Existing YAML records are not changed.",
      confirmLabel: "Delete content type",
      danger: true,
      onConfirm: () => {
        update((next) => {
          delete next.node_types[typeKey];
        });
        setSelection({ section: "types", key: Object.keys(draft.node_types).find((key) => key !== typeKey) || null });
      }
    });
  }

  function requestDeleteCollection(collectionKey) {
    if (collectionEntries.length === 1) {
      setError("A project must keep at least one collection.");
      return;
    }
    const referenceUse = typeEntries.find(([, type]) =>
      Object.values(type.fields ?? {}).some(
        (field) =>
          field.widget === "reference" && field.collection === collectionKey
      )
    );
    if (referenceUse) {
      setError(
        `This collection is referenced by ${referenceUse[1].label || referenceUse[0]}. Remove that reference field first.`
      );
      return;
    }
    setConfirmation({
      title: `Delete ${draft.collections[collectionKey].label || collectionKey}?`,
      description: "This removes only the collection configuration. Content files are not deleted.",
      confirmLabel: "Delete collection",
      danger: true,
      onConfirm: () => {
        update((next) => {
          delete next.collections[collectionKey];
        });
        setSelection({
          section: "collections",
          key: Object.keys(draft.collections).find((key) => key !== collectionKey) || null
        });
      }
    });
  }

  function requestDeleteField(fieldKey) {
    const typeKey = selection.key;
    const field = draft.node_types[typeKey].fields[fieldKey];
    setConfirmation({
      title: `Delete ${field.label || fieldKey}?`,
      description: "The field is also removed from inspector groups and collection lists.",
      confirmLabel: "Delete field",
      danger: true,
      onConfirm: () => update((next) => {
        const type = next.node_types[typeKey];
        delete type.fields[fieldKey];
        for (const panel of Object.values(type.views?.detail?.panels ?? {})) {
          for (const group of Object.values(panel.groups ?? {})) {
            group.fields = (group.fields ?? []).filter((reference) =>
              (typeof reference === "string" ? reference : reference.field) !== fieldKey
            );
          }
        }
        for (const collection of Object.values(next.collections)) {
          if (collection.node_type !== typeKey) continue;
          const list = collection.views?.list;
          if (list?.columns) {
            list.columns = list.columns.filter((column) =>
              (typeof column === "string" ? column : column.field) !== fieldKey
            );
          }
          if (list?.search?.fields) {
            list.search.fields = list.search.fields.filter((name) => name !== fieldKey);
          }
          if (list?.sort?.field === fieldKey) delete list.sort.field;
          for (const name of ["value", "image", "title"]) {
            if (collection.views?.reference?.[name] === fieldKey) {
              delete collection.views.reference[name];
            }
          }
        }
      })
    });
  }

  const selectedCollection =
    selection.section === "collections"
      ? draft.collections?.[selection.key]
      : null;
  const selectedType =
    selection.section === "types"
      ? draft.node_types?.[selection.key]
      : null;

  return (
    <div className="configuration-overlay" role="dialog" aria-modal="true" aria-label="CMS Settings">
      <header className="configuration-overlay__topbar">
        <span className="configuration-overlay__title">
          <span><Settings2 size={17} /></span>
          <span>
            <strong>Settings</strong>
            <small>cms.config.yml</small>
          </span>
        </span>
        <span className={cx("save-state", dirty && "save-state--dirty")}>
          <i />
          {dirty ? "Unsaved configuration" : "Configuration saved"}
        </span>
        <button
          type="button"
          className="button button--save"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              const saved = await onSave(draft);
              setDraft(structuredClone(saved));
              setSavedDraft(structuredClone(saved));
            } catch (saveError) {
              setError(saveError.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Spinner small /> : <Save size={14} />}
          {saving ? "Saving" : "Save settings"}
        </button>
        <button
          type="button"
          className="configuration-overlay__close"
          title="Close Settings"
          onClick={requestClose}
          disabled={saving}
        >
          <X size={18} />
        </button>
      </header>

      <div className="configuration-overlay__workspace">
        <aside className="configuration-navigation">
          <div className="configuration-navigation__search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a setting…"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}><X size={12} /></button>
            )}
          </div>
          <nav>
            <button
              type="button"
              className={cx(selection.section === "site" && "is-active")}
              onClick={() => setSelection({ section: "site", key: null })}
            >
              <Settings2 size={15} />
              <span><strong>Project</strong><small>Identity and media</small></span>
            </button>
          </nav>
          <div className="configuration-navigation__group">
            <div className="configuration-navigation__heading">
              <span>Collections <small>{collectionEntries.length}</small></span>
              <button
                type="button"
                title="Add collection"
                onClick={() => setEntryDialog({ kind: "collection" })}
              >
                <Plus size={14} />
              </button>
            </div>
            <nav>
              {visibleCollections.map(([key, collection]) => (
                <button
                  type="button"
                  key={key}
                  className={cx(
                    selection.section === "collections" &&
                    selection.key === key &&
                    "is-active"
                  )}
                  onClick={() => setSelection({ section: "collections", key })}
                >
                  <Database size={15} />
                  <span>
                    <strong>{collection.label || labelFromKey(key)}</strong>
                    <small>{collection.views?.list?.type || "tree"} collection</small>
                  </span>
                </button>
              ))}
            </nav>
          </div>
          <div className="configuration-navigation__group">
            <div className="configuration-navigation__heading">
              <span>Content types <small>{typeEntries.length}</small></span>
              <button
                type="button"
                title="Add content type"
                onClick={() => setEntryDialog({ kind: "type" })}
              >
                <Plus size={14} />
              </button>
            </div>
            <nav>
              {visibleTypes.map(([key, type]) => (
                <button
                  type="button"
                  key={key}
                  className={cx(
                    selection.section === "types" &&
                    selection.key === key &&
                    "is-active"
                  )}
                  onClick={() => setSelection({ section: "types", key })}
                >
                  <Layers3 size={15} />
                  <span>
                    <strong>{type.label || labelFromKey(key)}</strong>
                    <small>{Object.keys(type.fields ?? {}).length} fields</small>
                  </span>
                </button>
              ))}
            </nav>
          </div>
          <details className="configuration-navigation__expert">
            <summary>
              <SlidersHorizontal size={14} />
              Expert tools
              <ChevronDown size={13} />
            </summary>
            <button
              type="button"
              className={cx(selection.section === "expert" && "is-active")}
              onClick={() => setSelection({ section: "expert", key: null })}
            >
              <Braces size={15} />
              <span><strong>Expert YAML</strong><small>Full configuration</small></span>
            </button>
          </details>
        </aside>

        <main className="configuration-overlay__content">
          {selection.section === "site" && (
            <SiteEditor site={draft.site ?? {}} update={update} />
          )}
          {selectedCollection && (
            <CollectionEditor
              collectionKey={selection.key}
              collection={selectedCollection}
              nodeTypes={draft.node_types}
              updateCollection={(change) => updateCollection(selection.key, change)}
              onMove={(direction) => update((next) => {
                next.collections = moveMappingEntry(next.collections, selection.key, direction);
              })}
              onDelete={() => requestDeleteCollection(selection.key)}
            />
          )}
          {selectedType && (
            <TypeEditor
              typeKey={selection.key}
              type={selectedType}
              nodeTypes={draft.node_types}
              collections={draft.collections}
              updateType={(change) => updateType(selection.key, change)}
              onMoveType={(direction) => update((next) => {
                next.node_types = moveMappingEntry(next.node_types, selection.key, direction);
              })}
              onDeleteType={() => requestDeleteType(selection.key)}
              onAdd={(dialog) => {
                if (dialog.kind === "delete-field") {
                  requestDeleteField(dialog.fieldKey);
                } else {
                  setEntryDialog(dialog);
                }
              }}
            />
          )}
          {selection.section === "expert" && (
            <RawYamlEditor
              config={draft}
              onApply={(next) => setDraft(structuredClone(next))}
            />
          )}
          {(
            (selection.section === "collections" && !selectedCollection) ||
            (selection.section === "types" && !selectedType)
          ) && (
            <div className="configuration-empty-selection">
              <FileText size={22} />
              <strong>Choose an item</strong>
              <span>Select an entry from the Settings navigation.</span>
            </div>
          )}
        </main>
      </div>

      {error && (
        <div className="error-banner configuration-error-banner">
          <CircleAlert size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}><X size={14} /></button>
        </div>
      )}

      {entryDialog && (
        <AddEntryDialog
          title={
            entryDialog.kind === "collection"
              ? "Add collection"
              : entryDialog.kind === "type"
                ? "Add content type"
                : entryDialog.kind === "field"
                  ? "Add field"
                  : entryDialog.kind === "slot"
                    ? "Add content area"
                    : entryDialog.kind === "panel"
                      ? "Add inspector panel"
                      : "Add inspector group"
          }
          description="Give it an editor-facing name and a stable configuration key."
          existing={entryDialogMapping()}
          onCancel={() => setEntryDialog(null)}
          onCreate={createEntry}
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
