import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Database,
  FileCog,
  FileText,
  Files,
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
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
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
  ICON_NAMES,
  TREE_AUTO_SCROLL,
  cx,
  iconFor
} from "../../model/editor.js";
import { DEFAULT_IMAGE_ACCEPT } from "../../../shared/media.js";
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

const SYSTEM_FIELD_OPTIONS = [
  ["$id", "Record ID"],
  ["$filename", "File name"],
  ["$storage_path", "Storage path"],
  ["$created_at", "Created"],
  ["$updated_at", "Updated"]
];

const FIELD_DISPLAY_OPTIONS = [
  ["", "Automatic"],
  ["text", "Text"],
  ["date", "Date"],
  ["datetime", "Date and time"],
  ["toggle", "Toggle"],
  ["select", "Dropdown label"],
  ["badge", "Badge"],
  ["code", "Code"],
  ["image", "Image"]
];

const FIELD_APPEARANCE_OPTIONS = [
  ["", "Default"],
  ["title", "Title"],
  ["muted", "Muted"],
  ["monospace", "Monospaced"]
];

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

function moveArrayEntry(entries, sourceIndex, destinationIndex) {
  const nextEntries = [...entries];
  const [moving] = nextEntries.splice(sourceIndex, 1);
  nextEntries.splice(destinationIndex, 0, moving);
  return nextEntries;
}

function moveMappingEntryTo(mapping, key, destinationIndex) {
  const entries = Object.entries(mapping ?? {});
  const sourceIndex = entries.findIndex(([name]) => name === key);
  if (
    sourceIndex < 0 ||
    destinationIndex < 0 ||
    destinationIndex >= entries.length ||
    sourceIndex === destinationIndex
  ) {
    return mapping;
  }
  return Object.fromEntries(
    moveArrayEntry(entries, sourceIndex, destinationIndex)
  );
}

function moveTypeFieldTo(type, fieldKey, sourceIndex, destinationIndex) {
  const direction = Math.sign(destinationIndex - sourceIndex);
  if (!direction) return;
  for (
    let currentIndex = sourceIndex;
    currentIndex !== destinationIndex;
    currentIndex += direction
  ) {
    type.fields = moveMappingEntry(type.fields, fieldKey, direction);
    for (const panel of Object.values(type.views?.detail?.panels ?? {})) {
      for (const group of Object.values(panel.groups ?? {})) {
        const references = group.fields ?? [];
        const referenceIndex = references.findIndex(
          (reference) =>
            (typeof reference === "string"
              ? reference
              : reference.field) === fieldKey
        );
        const referenceDestination = referenceIndex + direction;
        if (
          referenceIndex !== -1 &&
          referenceDestination >= 0 &&
          referenceDestination < references.length
        ) {
          const [moving] = references.splice(referenceIndex, 1);
          references.splice(referenceDestination, 0, moving);
        }
      }
    }
  }
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
  const labelId = useId();
  const control = isValidElement(children)
    ? cloneElement(children, {
        "aria-labelledby":
          children.props["aria-labelledby"] ||
          (children.props["aria-label"] ? undefined : labelId)
      })
    : children;
  return (
    <div className="configuration-form-field">
      <span id={labelId} className="configuration-form-field__label">
        <strong>{label}</strong>
        {optional && <small>Optional</small>}
      </span>
      {control}
      {hint && <small className="configuration-form-field__hint">{hint}</small>}
    </div>
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

function IconSelect({
  value,
  onChange,
  includeDefault = false,
  defaultIcon: DefaultIcon = FileText,
  ...props
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxId = useId();
  const values = [
    ...(includeDefault ? [""] : []),
    ...ICON_NAMES,
    ...(value && !ICON_NAMES.includes(value) ? [value] : [])
  ];
  const options = values.map((optionValue) => ({
    value: optionValue,
    label: optionValue ? labelFromKey(optionValue) : "Default"
  }));
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === (value || ""))
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] ?? options[0];
  const SelectedIcon = selectedOption?.value
    ? iconFor(selectedOption.value, DefaultIcon)
    : DefaultIcon;

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(selectedIndex);
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(index) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(offset) {
    const startIndex = open ? activeIndex : selectedIndex;
    setActiveIndex(
      (startIndex + offset + options.length) % options.length
    );
    setOpen(true);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      setOpen(true);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setActiveIndex(selectedIndex);
        setOpen(true);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const search = event.key.toLocaleLowerCase();
      const startIndex = open ? activeIndex : selectedIndex;
      const matchingIndex = options.findIndex(
        (option, index) =>
          index !== startIndex &&
          option.label.toLocaleLowerCase().startsWith(search)
      );
      if (matchingIndex !== -1) {
        event.preventDefault();
        setActiveIndex(matchingIndex);
        setOpen(true);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={cx("configuration-icon-select", open && "is-open")}
    >
      <button
        {...props}
        ref={triggerRef}
        type="button"
        className="configuration-icon-select__trigger"
        role="combobox"
        aria-autocomplete="none"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="configuration-icon-select__preview" aria-hidden="true">
          <SelectedIcon size={15} />
        </span>
        <span>{selectedOption?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={listboxId}
          className="configuration-icon-select__options"
          role="listbox"
        >
          {options.map((option, index) => {
            const OptionIcon = option.value
              ? iconFor(option.value, DefaultIcon)
              : DefaultIcon;
            const selected = index === selectedIndex;
            return (
              <button
                type="button"
                id={`${listboxId}-option-${index}`}
                key={option.value || "default"}
                className={cx(
                  "configuration-icon-select__option",
                  index === activeIndex && "is-active"
                )}
                role="option"
                aria-selected={selected}
                data-option-index={index}
                tabIndex="-1"
                onPointerMove={() => setActiveIndex(index)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
              >
                <span aria-hidden="true"><OptionIcon size={15} /></span>
                <span>{option.label}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, meta, action }) {
  return (
    <div className="configuration-section-heading">
      <span aria-hidden="true"><Icon size={16} /></span>
      <div>
        <h1>{title}</h1>
        {meta && <code>{meta}</code>}
      </div>
      {action}
    </div>
  );
}

function AdvancedSection({ title, children }) {
  return (
    <details className="configuration-advanced">
      <summary>
        <span>
          <SlidersHorizontal size={14} aria-hidden="true" />
          <strong>{title}</strong>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="configuration-advanced__body">{children}</div>
    </details>
  );
}

function EntryActions({
  count,
  onDuplicate,
  onDelete,
  dragHandleProps,
  dragLabel = "item"
}) {
  return (
    <div className="configuration-entry-actions">
      {dragHandleProps ? (
        <button
          {...dragHandleProps}
          type="button"
          className="configuration-drag-handle"
          title={`Drag to move ${dragLabel}`}
          aria-label={`Drag to move ${dragLabel}`}
          disabled={count < 2}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
      ) : (
        <GripVertical size={14} aria-hidden="true" />
      )}
      {onDuplicate && (
        <button
          type="button"
          title="Duplicate"
          aria-label="Duplicate"
          onClick={onDuplicate}
        >
          <Copy size={13} />
        </button>
      )}
      <button
        type="button"
        className="danger"
        title="Delete"
        aria-label="Delete"
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function ConfigurationDropLine({
  id,
  insertionIndex,
  enabled,
  visible,
  placement = "before"
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: { insertionIndex },
    disabled: !enabled
  });
  return (
    <div
      className={cx(
        "configuration-drop-anchor",
        placement === "after" && "configuration-drop-anchor--after",
        visible && "is-visible",
        enabled && isOver && "is-over"
      )}
      aria-hidden="true"
    >
      <div ref={setNodeRef} className="configuration-drop-target">
        <span />
      </div>
    </div>
  );
}

function ConfigurationDragPreview({ item }) {
  if (!item) return null;
  return (
    <div className="configuration-drag-preview">
      <GripVertical size={15} aria-hidden="true" />
      <span>
        <small>Moving</small>
        <strong>{item.label}</strong>
      </span>
    </div>
  );
}

function ConfigurationDndItem({
  scope,
  item,
  index,
  count,
  activeIndex,
  renderItem
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef
  } = useDraggable({
    id: `${scope}:item:${item.id}`,
    data: { index, item },
    disabled: count < 2
  });
  const beforeEnabled =
    activeIndex !== null &&
    index !== activeIndex &&
    index !== activeIndex + 1;
  const afterIndex = count;
  const afterEnabled =
    activeIndex !== null &&
    index === count - 1 &&
    afterIndex !== activeIndex &&
    afterIndex !== activeIndex + 1;
  const dragHandleProps = {
    ref: setActivatorNodeRef,
    ...attributes,
    ...listeners
  };

  return (
    <div
      ref={setNodeRef}
      role="listitem"
      className={cx(
        "configuration-dnd-item",
        isDragging && "configuration-dnd-item--dragging"
      )}
    >
      <ConfigurationDropLine
        id={`${scope}:drop:${index}`}
        insertionIndex={index}
        enabled={beforeEnabled}
        visible={beforeEnabled}
      />
      {renderItem({ dragHandleProps, isDragging })}
      {index === count - 1 && (
        <ConfigurationDropLine
          id={`${scope}:drop:${afterIndex}`}
          insertionIndex={afterIndex}
          enabled={afterEnabled}
          visible={afterEnabled}
          placement="after"
        />
      )}
    </div>
  );
}

function ConfigurationDndList({
  items,
  onReorder,
  className,
  ariaLabel,
  children
}) {
  const scope = useId();
  const [activeDrag, setActiveDrag] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const activeIndex = activeDrag?.index ?? null;

  return (
    <DndContext
      sensors={sensors}
      autoScroll={TREE_AUTO_SCROLL}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveDrag(active.data.current)}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={({ active, over }) => {
        const sourceIndex = active.data.current?.index;
        const insertionIndex = over?.data.current?.insertionIndex;
        setActiveDrag(null);
        if (
          !Number.isInteger(sourceIndex) ||
          !Number.isInteger(insertionIndex)
        ) {
          return;
        }
        const destinationIndex =
          insertionIndex > sourceIndex
            ? insertionIndex - 1
            : insertionIndex;
        if (destinationIndex !== sourceIndex) {
          onReorder(sourceIndex, destinationIndex);
        }
      }}
    >
      <div className={className} role="list" aria-label={ariaLabel}>
        {items.map((item, index) => (
          <ConfigurationDndItem
            key={item.id}
            scope={scope}
            item={item}
            index={index}
            count={items.length}
            activeIndex={activeIndex}
            renderItem={(dragState) => children(item, index, dragState)}
          />
        ))}
      </div>
      <DragOverlay
        dropAnimation={null}
        modifiers={DRAG_OVERLAY_MODIFIERS}
      >
        <ConfigurationDragPreview item={activeDrag?.item} />
      </DragOverlay>
    </DndContext>
  );
}

function MultiChoice({
  options,
  value = [],
  onChange,
  emptyLabel,
  ...props
}) {
  if (!options.length) {
    return <p className="configuration-muted">{emptyLabel || "No options available."}</p>;
  }
  return (
    <div
      {...props}
      className="configuration-choice-grid"
      role="group"
    >
      {options.map(([key, label]) => {
        const selected = value.includes(key);
        return (
          <button
            type="button"
            key={key}
            className={cx(selected && "is-selected")}
            aria-pressed={selected}
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="configuration-add-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) onCreate({ key: resolvedKey, label: name.trim() });
        }}
      >
        <div className="dialog__top">
          <span className="dialog__icon" aria-hidden="true"><Plus size={18} /></span>
          <div>
            <h2 id="configuration-add-dialog-title">{title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onCancel}>
            <X size={18} />
          </button>
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
            label="Key"
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

function SiteEditor({ site, backend = {}, update }) {
  const backendName = backend.name || "node";
  return (
    <div className="configuration-editor-pane">
      <SectionHeading
        icon={Settings2}
        title="Project settings"
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
        <FormField label="Storage adapter">
          <SelectInput
            value={backendName}
            onChange={(value) => update((next) => {
              if (value === "github") {
                next.backend = {
                  name: "github",
                  repo: backend.repo || "",
                  branch: backend.branch || "main",
                  base_url: backend.base_url || ""
                };
              } else {
                next.backend = {
                  name: "node",
                  ...(backend.api_url ? { api_url: backend.api_url } : {})
                };
              }
            })}
          >
            <option value="node">Node server</option>
            <option value="github">GitHub repository</option>
          </SelectInput>
        </FormField>
      </section>
      {backendName === "github" && (
        <>
          <section className="configuration-card configuration-card--form">
            <FormField label="GitHub repository">
              <TextInput
                value={backend.repo}
                placeholder="owner/repository"
                onChange={(value) => update((next) => {
                  next.backend.repo = value;
                })}
              />
            </FormField>
            <FormField label="Branch">
              <TextInput
                value={backend.branch}
                placeholder="main"
                onChange={(value) => update((next) => {
                  next.backend.branch = value;
                })}
              />
            </FormField>
            <FormField label="Authentication URL">
              <TextInput
                value={backend.base_url}
                placeholder="https://auth.example.com"
                onChange={(value) => update((next) => {
                  next.backend.base_url = value;
                })}
              />
            </FormField>
          </section>
          <AdvancedSection title="GitHub API">
            <FormField label="GitHub API URL">
              <TextInput
                value={backend.api_root}
                placeholder="https://api.github.com"
                onChange={(value) => update((next) => {
                  setOptional(next.backend, "api_root", value);
                })}
              />
            </FormField>
          </AdvancedSection>
        </>
      )}
      {backendName === "node" && (
        <AdvancedSection title="Node adapter">
          <FormField label="API URL">
            <TextInput
              value={backend.api_url}
              placeholder="Same origin"
              onChange={(value) => update((next) => {
                next.backend ??= { name: "node" };
                setOptional(next.backend, "api_url", value);
              })}
            />
          </FormField>
        </AdvancedSection>
      )}
      <AdvancedSection
        title="Media paths"
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
      <ConfigurationDndList
        className="configuration-option-list"
        ariaLabel="Dropdown options"
        items={normalized.map((option, index) => ({
          id: `option-${index}`,
          label: option.label || option.value || `Option ${index + 1}`
        }))}
        onReorder={(sourceIndex, destinationIndex) =>
          onChange(moveArrayEntry(normalized, sourceIndex, destinationIndex))
        }
      >
        {(_, index, { dragHandleProps }) => {
          const option = normalized[index];
          return (
            <div className="configuration-option-row">
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
              <EntryActions
                count={normalized.length}
                dragHandleProps={dragHandleProps}
                dragLabel={option.label || `option ${index + 1}`}
                onDuplicate={() => {
                  const nextOptions = [...normalized];
                  nextOptions.splice(index + 1, 0, {
                    label: `${option.label} copy`,
                    value: uniqueKey(
                      Object.fromEntries(normalized.map((item) => [item.value, true])),
                      `${option.value}_copy`
                    )
                  });
                  onChange(nextOptions);
                }}
                onDelete={() =>
                  onChange(normalized.filter((_, itemIndex) => itemIndex !== index))
                }
              />
            </div>
          );
        }}
      </ConfigurationDndList>
      {!normalized.length && (
        <p className="configuration-muted">No options yet.</p>
      )}
    </div>
  );
}

function FieldEditor({
  fieldKey,
  field,
  count,
  collections,
  nodeTypes,
  onChange,
  onDuplicate,
  onDelete,
  dragHandleProps
}) {
  const widget = field.widget || "string";
  const widgetLabel =
    WIDGET_OPTIONS.find(([value]) => value === widget)?.[1] || widget;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const targetCollection = collections[field.collection];
  const targetFields = Object.entries(
    nodeTypes[targetCollection?.node_type]?.fields ?? {}
  ).map(([key, targetField]) => [key, targetField.label || key]);
  return (
    <article
      className={cx(
        "configuration-entry-card",
        "configuration-entry-card--field",
        open && "is-open"
      )}
    >
      <div className="configuration-entry-card__top">
        <button
          type="button"
          className="configuration-entry-card__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${field.label || labelFromKey(fieldKey)}, ${widgetLabel}${
            field.required === false ? ", optional" : ""
          }`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="configuration-entry-card__identity">
            <FileCog size={15} aria-hidden="true" />
            <span>
              <strong>{field.label || labelFromKey(fieldKey)}</strong>
              <code>{fieldKey}</code>
            </span>
          </span>
          <span className="configuration-entry-card__badges" aria-hidden="true">
            <i>{widgetLabel}</i>
            {field.required === false && <i>Optional</i>}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <EntryActions
          count={count}
          dragHandleProps={dragHandleProps}
          dragLabel={field.label || labelFromKey(fieldKey)}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
      {open && (
        <div id={bodyId} className="configuration-entry-card__body">
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
                delete nextField.value_field;
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
        ) : widget !== "uuid" ? (
          <FormField
            label={
              widget === "image"
                ? "Default media path"
                : widget === "reference"
                  ? "Default reference value"
                  : "Default value"
            }
            optional
          >
            <TextInput
              type={widget === "number" ? "number" : "text"}
              value={field.default}
              placeholder={
                widget === "image"
                  ? "/media/example.jpg"
                  : widget === "reference"
                    ? "Stored reference value"
                    : undefined
              }
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
            optional
          >
            <TextInput
              value={field.accept}
              placeholder={DEFAULT_IMAGE_ACCEPT}
              onChange={(value) => onChange((nextField) => {
                setOptional(nextField, "accept", value);
              })}
            />
          </FormField>
        )}
        {widget === "reference" && (
          <FormField
            label="Stored reference field"
            optional
          >
            <SelectInput
              value={field.value_field}
              onChange={(value) => onChange((nextField) => {
                setOptional(nextField, "value_field", value);
              })}
            >
              <option value="">Use the collection default</option>
              {targetFields.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
              {SYSTEM_FIELD_OPTIONS.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </SelectInput>
          </FormField>
        )}
        {widget !== "uuid" && (
          <div className="configuration-inline-setting">
            <span>
              <strong>Read only</strong>
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
        </div>
      )}
    </article>
  );
}

function SlotEditor({
  slotKey,
  slot,
  count,
  nodeTypes,
  onChange,
  onDelete,
  dragHandleProps
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
          count={count}
          dragHandleProps={dragHandleProps}
          dragLabel={slot.label || labelFromKey(slotKey)}
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

function normalizeFieldReference(reference) {
  return typeof reference === "string"
    ? { field: reference }
    : { ...(reference ?? {}) };
}

function compactFieldReference(reference) {
  const configured = normalizeFieldReference(reference);
  const hasOverrides = Object.entries(configured).some(
    ([key, value]) =>
      key !== "field" &&
      value !== "" &&
      value !== undefined &&
      value !== null
  );
  return hasOverrides ? configured : configured.field;
}

function InspectorFieldsEditor({ references = [], fields, onChange }) {
  const options = [...fields, ...SYSTEM_FIELD_OPTIONS];
  const usedFields = new Set(references.map((reference) =>
    normalizeFieldReference(reference).field
  ));
  const availableOptions = options.filter(([key]) => !usedFields.has(key));
  const [newField, setNewField] = useState("");
  const resolvedNewField = availableOptions.some(([key]) => key === newField)
    ? newField
    : availableOptions[0]?.[0] ?? "";

  function updateReference(index, change) {
    const nextReferences = [...references];
    const nextReference = normalizeFieldReference(nextReferences[index]);
    change(nextReference);
    nextReferences[index] = compactFieldReference(nextReference);
    onChange(nextReferences);
  }

  return (
    <div className="configuration-inspector-fields">
      <div className="configuration-subheading">
        <div>
          <strong>Fields</strong>
        </div>
        <span className="configuration-add-field">
          <SelectInput
            value={resolvedNewField}
            aria-label="Field to add"
            disabled={!availableOptions.length}
            onChange={setNewField}
          >
            {availableOptions.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </SelectInput>
          <button
            type="button"
            className="configuration-small-button"
            disabled={!resolvedNewField}
            onClick={() => {
              onChange([...references, resolvedNewField]);
              setNewField("");
            }}
          >
            <Plus size={13} /> Add field
          </button>
        </span>
      </div>
      <ConfigurationDndList
        className="configuration-inspector-field-list"
        ariaLabel="Inspector fields"
        items={references.map((reference, index) => {
          const configured = normalizeFieldReference(reference);
          return {
            id: `reference-${index}`,
            label:
              configured.label ||
              options.find(([key]) => key === configured.field)?.[1] ||
              labelFromKey(configured.field)
          };
        })}
        onReorder={(sourceIndex, destinationIndex) =>
          onChange(moveArrayEntry(references, sourceIndex, destinationIndex))
        }
      >
        {(_, index, { dragHandleProps }) => {
          const configured = normalizeFieldReference(references[index]);
          const dragLabel =
            configured.label ||
            options.find(([key]) => key === configured.field)?.[1] ||
            labelFromKey(configured.field);
          return (
          <article className="configuration-field-reference">
            <EntryActions
              count={references.length}
              dragHandleProps={dragHandleProps}
              dragLabel={dragLabel}
              onDelete={() =>
                onChange(references.filter((_, itemIndex) => itemIndex !== index))
              }
            />
            <div className="configuration-entry-card__grid">
              <FormField label="Field">
                <SelectInput
                  value={configured.field}
                  onChange={(value) => updateReference(index, (nextReference) => {
                    nextReference.field = value;
                    if (value.startsWith("$")) nextReference.mode = "read";
                    else delete nextReference.mode;
                  })}
                >
                  <optgroup label="Content fields">
                    {fields.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="System information">
                    {SYSTEM_FIELD_OPTIONS.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </optgroup>
                </SelectInput>
              </FormField>
              <FormField label="Custom label" optional>
                <TextInput
                  value={configured.label}
                  onChange={(value) => updateReference(index, (nextReference) => {
                    setOptional(nextReference, "label", value);
                  })}
                />
              </FormField>
            </div>
          </article>
          );
        }}
      </ConfigurationDndList>
      {!references.length && (
        <p className="configuration-muted">No fields assigned yet.</p>
      )}
    </div>
  );
}

function InspectorPanelEditor({
  panelKey,
  panel,
  panelCount,
  fields,
  updateType,
  onAdd,
  dragHandleProps
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const groupCount = Object.keys(panel.groups ?? {}).length;
  const panelLabel = panel.label || labelFromKey(panelKey);

  return (
    <article className={cx("configuration-layout-panel", open && "is-open")}>
      <div className="configuration-entry-card__top">
        <button
          type="button"
          className="configuration-entry-card__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${panelLabel}, ${groupCount} ${groupCount === 1 ? "group" : "groups"}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="configuration-entry-card__identity">
            <Layers3 size={15} aria-hidden="true" />
            <span>
              <strong>{panelLabel}</strong>
              <code>{panelKey}</code>
            </span>
          </span>
          <span className="configuration-entry-card__badges" aria-hidden="true">
            <i>{groupCount} {groupCount === 1 ? "group" : "groups"}</i>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <EntryActions
          count={panelCount}
          dragHandleProps={dragHandleProps}
          dragLabel={panelLabel}
          onDelete={() => updateType((nextType) => {
            delete nextType.views.detail.panels[panelKey];
          })}
        />
      </div>
      {open && (
        <div id={bodyId} className="configuration-entry-card__body">
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
            </div>
            <button
              type="button"
              className="configuration-small-button"
              onClick={() => onAdd({ kind: "group", panelKey })}
            >
              <Plus size={13} /> Add group
            </button>
          </div>
          <ConfigurationDndList
            className="configuration-group-list"
            ariaLabel={`${panelLabel} groups`}
            items={Object.entries(panel.groups ?? {}).map(([groupKey, group]) => ({
              id: groupKey,
              label: group.label || labelFromKey(groupKey)
            }))}
            onReorder={(sourceIndex, destinationIndex) => updateType((nextType) => {
              const groupKey = Object.keys(panel.groups ?? {})[sourceIndex];
              const groups = nextType.views.detail.panels[panelKey].groups;
              nextType.views.detail.panels[panelKey].groups =
                moveMappingEntryTo(groups, groupKey, destinationIndex);
            })}
          >
            {(groupItem, _groupIndex, { dragHandleProps: groupDragHandleProps }) => {
              const groupKey = groupItem.id;
              const group = panel.groups[groupKey];
              return (
                <div className="configuration-layout-group">
                  <div className="configuration-layout-group__top">
                    <span>
                      <strong>{group.label || labelFromKey(groupKey)}</strong>
                      <code>{groupKey}</code>
                    </span>
                    <EntryActions
                      count={groupCount}
                      dragHandleProps={groupDragHandleProps}
                      dragLabel={group.label || labelFromKey(groupKey)}
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
                      <IconSelect
                        value={group.icon}
                        includeDefault
                        defaultIcon={Settings2}
                        onChange={(value) => updateType((nextType) => {
                          setOptional(
                            nextType.views.detail.panels[panelKey].groups[groupKey],
                            "icon",
                            value
                          );
                        })}
                      />
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
                  <InspectorFieldsEditor
                    fields={fields}
                    references={group.fields ?? []}
                    onChange={(value) => updateType((nextType) => {
                      nextType.views.detail.panels[panelKey].groups[groupKey].fields = value;
                    })}
                  />
                </div>
              );
            }}
          </ConfigurationDndList>
        </div>
      )}
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
    >
      <div className="configuration-subheading">
        <div>
          <strong>Inspector panels</strong>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          onClick={() => onAdd({ kind: "panel" })}
        >
          <Plus size={13} /> Add panel
        </button>
      </div>
      <ConfigurationDndList
        className="configuration-panel-list"
        ariaLabel="Inspector panels"
        items={Object.entries(panels).map(([panelKey, panel]) => ({
          id: panelKey,
          label: panel.label || labelFromKey(panelKey)
        }))}
        onReorder={(sourceIndex, destinationIndex) => updateType((nextType) => {
          const panelKey = Object.keys(panels)[sourceIndex];
          nextType.views.detail.panels = moveMappingEntryTo(
            nextType.views.detail.panels,
            panelKey,
            destinationIndex
          );
        })}
      >
        {(panelItem, _panelIndex, { dragHandleProps }) => (
          <InspectorPanelEditor
            panelKey={panelItem.id}
            panel={panels[panelItem.id]}
            panelCount={Object.keys(panels).length}
            fields={fields}
            updateType={updateType}
            onAdd={onAdd}
            dragHandleProps={dragHandleProps}
          />
        )}
      </ConfigurationDndList>
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
        meta={typeKey}
        action={
          <div className="configuration-heading-actions">
            <button
              type="button"
              title="Move type up"
              aria-label="Move content type up"
              onClick={() => onMoveType(-1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              title="Move type down"
              aria-label="Move content type down"
              onClick={() => onMoveType(1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="danger"
              title="Delete type"
              aria-label="Delete content type"
              onClick={onDeleteType}
            >
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
            <IconSelect
              value={type.icon || "file-text"}
              onChange={(value) => updateType((nextType) => {
                nextType.icon = value;
              })}
            />
          </FormField>
        </div>
      </section>

      <div className="configuration-subheading configuration-subheading--major">
        <div>
          <strong>Fields</strong>
        </div>
        <button
          type="button"
          className="configuration-small-button"
          onClick={() => onAdd({ kind: "field" })}
        >
          <Plus size={13} /> Add field
        </button>
      </div>
      <ConfigurationDndList
        className="configuration-entry-list"
        ariaLabel="Content type fields"
        items={Object.entries(fields).map(([fieldKey, field]) => ({
          id: fieldKey,
          label: field.label || labelFromKey(fieldKey)
        }))}
        onReorder={(sourceIndex, destinationIndex) => updateType((nextType) => {
          const fieldKey = Object.keys(fields)[sourceIndex];
          moveTypeFieldTo(
            nextType,
            fieldKey,
            sourceIndex,
            destinationIndex
          );
        })}
      >
        {(fieldItem, _index, { dragHandleProps }) => {
          const fieldKey = fieldItem.id;
          const field = fields[fieldKey];
          return (
          <FieldEditor
            fieldKey={fieldKey}
            field={field}
            count={Object.keys(fields).length}
            collections={collections}
            nodeTypes={nodeTypes}
            dragHandleProps={dragHandleProps}
            onChange={(change) => updateType((nextType) => {
              change(nextType.fields[fieldKey]);
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
          );
        }}
      </ConfigurationDndList>
      {!Object.keys(fields).length && (
        <div className="configuration-empty-list">
          <FileCog size={20} aria-hidden="true" />
          <strong>No fields yet</strong>
        </div>
      )}

      <AdvancedSection
        title="Content areas"
      >
        <div className="configuration-subheading">
          <div>
            <strong>Slots</strong>
          </div>
          <button
            type="button"
            className="configuration-small-button"
            onClick={() => onAdd({ kind: "slot" })}
          >
            <Plus size={13} /> Add content area
          </button>
        </div>
        <ConfigurationDndList
          className="configuration-entry-list"
          ariaLabel="Content areas"
          items={Object.entries(slots).map(([slotKey, slot]) => ({
            id: slotKey,
            label: slot.label || labelFromKey(slotKey)
          }))}
          onReorder={(sourceIndex, destinationIndex) => updateType((nextType) => {
            const slotKey = Object.keys(slots)[sourceIndex];
            nextType.slots = moveMappingEntryTo(
              nextType.slots,
              slotKey,
              destinationIndex
            );
          })}
        >
          {(slotItem, _index, { dragHandleProps }) => {
            const slotKey = slotItem.id;
            const slot = slots[slotKey];
            return (
            <SlotEditor
              slotKey={slotKey}
              slot={slot}
              count={Object.keys(slots).length}
              nodeTypes={nodeTypes}
              dragHandleProps={dragHandleProps}
              onChange={(change) => updateType((nextType) => {
                change(nextType.slots[slotKey]);
              })}
              onDelete={() => updateType((nextType) => {
                delete nextType.slots[slotKey];
                if (!Object.keys(nextType.slots).length) delete nextType.slots;
              })}
            />
            );
          }}
        </ConfigurationDndList>
      </AdvancedSection>

      <InspectorLayoutEditor
        type={type}
        updateType={updateType}
        onAdd={onAdd}
      />
    </div>
  );
}

function TableColumnEditor({
  column,
  fields,
  count,
  onChange,
  onDelete,
  dragHandleProps
}) {
  const configured = typeof column === "string" ? { field: column } : column;
  const system = configured.field?.startsWith("$");
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const fieldLabel =
    fields.find(([key]) => key === configured.field)?.[1] ||
    labelFromKey(configured.field);

  return (
    <article className={cx("configuration-table-column", open && "is-open")}>
      <div className="configuration-table-column__top">
        <button
          type="button"
          className="configuration-table-column__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${configured.label || fieldLabel}, table column`}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            <strong>{configured.label || fieldLabel}</strong>
            <code>{configured.field}</code>
          </span>
          <span className="configuration-entry-card__badges" aria-hidden="true">
            <i>{configured.mode === "edit" && !system ? "Editable" : "Read only"}</i>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <EntryActions
          count={count}
          dragHandleProps={dragHandleProps}
          dragLabel={configured.label || fieldLabel}
          onDelete={onDelete}
        />
      </div>
      {open && (
        <div id={bodyId} className="configuration-table-column__body">
          <div className="configuration-entry-card__grid">
            <FormField label="Field">
              <SelectInput
                value={configured.field}
                onChange={(value) => onChange({
                  ...configured,
                  field: value,
                  ...(value.startsWith("$") ? { mode: "read" } : {})
                })}
              >
                {fields.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Column label">
              <TextInput
                value={configured.label}
                onChange={(value) => onChange({
                  ...configured,
                  label: value
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
                  onChange={(value) => onChange({
                    ...configured,
                    width: value
                  })}
                />
              </FormField>
              <FormField label="Mode">
                <SelectInput
                  value={system ? "read" : configured.mode || "read"}
                  disabled={system}
                  onChange={(value) => onChange({
                    ...configured,
                    mode: value
                  })}
                >
                  <option value="read">Read only</option>
                  <option value="edit">Editable</option>
                </SelectInput>
              </FormField>
              <FormField label="Display">
                <SelectInput
                  value={configured.display || "text"}
                  onChange={(value) => onChange({
                    ...configured,
                    display: value
                  })}
                >
                  {FIELD_DISPLAY_OPTIONS.filter(([value]) => value).map(
                    ([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    )
                  )}
                </SelectInput>
              </FormField>
              <FormField label="Alignment">
                <SelectInput
                  value={configured.align || "left"}
                  onChange={(value) => onChange({
                    ...configured,
                    align: value
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
                  onChange={(value) => {
                    const nextColumn = { ...configured };
                    setOptional(nextColumn, "appearance", value);
                    onChange(nextColumn);
                  }}
                >
                  {FIELD_APPEARANCE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectInput>
              </FormField>
            </div>
            <div className="configuration-inline-setting">
              <span><strong>Sortable</strong></span>
              <Switch
                checked={configured.sortable !== false}
                label={`${configured.label || configured.field} sortable`}
                onChange={(checked) => onChange({
                  ...configured,
                  sortable: checked
                })}
              />
            </div>
          </AdvancedSection>
        </div>
      )}
    </article>
  );
}

function TableColumnsEditor({ collection, type, updateCollection }) {
  const fields = [
    ...Object.entries(type?.fields ?? {}).map(([key, field]) => [
      key,
      field.label || key
    ]),
    ...SYSTEM_FIELD_OPTIONS
  ];
  const columns = collection.views?.list?.columns ?? [];
  return (
    <section className="configuration-card">
      <div className="configuration-subheading">
        <div>
          <strong>Table columns</strong>
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
                label: field[1],
                width: "minmax(10rem, 1fr)",
                mode: "read"
              }
            ];
          })}
        >
          <Plus size={13} /> Add column
        </button>
      </div>
      <ConfigurationDndList
        className="configuration-table-columns"
        ariaLabel="Table columns"
        items={columns.map((column, index) => {
          const configured =
            typeof column === "string" ? { field: column } : column;
          return {
            id: `column-${index}`,
            label:
              configured.label ||
              fields.find(([key]) => key === configured.field)?.[1] ||
              labelFromKey(configured.field)
          };
        })}
        onReorder={(sourceIndex, destinationIndex) =>
          updateCollection((nextCollection) => {
            nextCollection.views.list.columns = moveArrayEntry(
              nextCollection.views.list.columns,
              sourceIndex,
              destinationIndex
            );
          })
        }
      >
        {(_, index, { dragHandleProps }) => (
          <TableColumnEditor
            column={columns[index]}
            fields={fields}
            count={columns.length}
            dragHandleProps={dragHandleProps}
            onChange={(value) => updateCollection((nextCollection) => {
              nextCollection.views.list.columns[index] = value;
            })}
            onDelete={() => updateCollection((nextCollection) => {
              nextCollection.views.list.columns =
                nextCollection.views.list.columns.filter(
                  (_, itemIndex) => itemIndex !== index
                );
            })}
          />
        )}
      </ConfigurationDndList>
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
  const viewFields = [...fields, ...SYSTEM_FIELD_OPTIONS];
  const listType = collection.views?.list?.type || "tree";
  const hierarchyEnabled = Boolean(collection.hierarchy?.enabled);
  return (
    <div className="configuration-editor-pane">
      <SectionHeading
        icon={Database}
        title={collection.label || labelFromKey(collectionKey)}
        meta={collectionKey}
        action={
          <div className="configuration-heading-actions">
            <button
              type="button"
              title="Move collection up"
              aria-label="Move collection up"
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              title="Move collection down"
              aria-label="Move collection down"
              onClick={() => onMove(1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="danger"
              title="Delete collection"
              aria-label="Delete collection"
              onClick={onDelete}
            >
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
                const fieldKeys = Object.keys(nodeTypes[value]?.fields ?? {});
                const identifierField = fieldKeys.includes("title")
                  ? "title"
                  : fieldKeys[0];
                nextCollection.node_type = value;
                setOptional(nextCollection, "identifier_field", identifierField);
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
                  const idField = fieldKeys.includes("uuid")
                    ? "uuid"
                    : fieldKeys[0];
                  setOptional(nextCollection.hierarchy, "id_field", idField);
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
            </span>
            <Switch
              checked={hierarchyEnabled}
              label="Nested collection items"
              onChange={(checked) => updateCollection((nextCollection) => {
                if (checked) {
                  const fieldKeys = Object.keys(
                    nodeTypes[nextCollection.node_type]?.fields ?? {}
                  );
                  const idField = fieldKeys.includes("uuid")
                    ? "uuid"
                    : fieldKeys[0];
                  nextCollection.hierarchy = {
                    enabled: true,
                    ...(idField ? { id_field: idField } : {}),
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
      >
        <div className="configuration-entry-card__grid">
          <FormField label="Icon" optional>
            <IconSelect
              value={collection.icon}
              includeDefault
              defaultIcon={Files}
              onChange={(value) => updateCollection((nextCollection) => {
                setOptional(nextCollection, "icon", value);
              })}
            />
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
              value={collection.identifier_field || ""}
              onChange={(value) => updateCollection((nextCollection) => {
                setOptional(nextCollection, "identifier_field", value);
              })}
            >
              <option value="">Use title when available</option>
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
                value={collection.hierarchy?.id_field || ""}
                onChange={(value) => updateCollection((nextCollection) => {
                  setOptional(nextCollection.hierarchy, "id_field", value);
                })}
              >
                <option value="">Use record ID</option>
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
            options={viewFields}
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
              {viewFields.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
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
                {viewFields.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </SelectInput>
            </FormField>
          ))}
        </div>
        <FormField label="Reference description fields" optional>
          <MultiChoice
            options={viewFields}
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
  const overlayRef = useRef(null);
  const modalOpen = Boolean(entryDialog || confirmation);
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
    const previousFocus = document.activeElement;
    overlayRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyboard(event) {
      if (event.defaultPrevented) return;
      if (event.key === "Tab") {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const focusable = [...overlay.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
        )].filter((element) =>
          !element.closest("[inert]") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!overlay.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || entryDialog || confirmation || saving) return;
      event.preventDefault();
      requestClose();
    }
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  });

  function createEntry({ key, label }) {
    const dialog = entryDialog;
    update((next) => {
      if (dialog.kind === "collection") {
        const nodeType = Object.keys(next.node_types)[0] || "";
        const fieldKeys = Object.keys(next.node_types[nodeType]?.fields ?? {});
        const identifierField = fieldKeys.includes("title")
          ? "title"
          : fieldKeys[0];
        next.collections[key] = {
          label,
          label_singular: label.replace(/s$/i, "") || label,
          icon: "files",
          folder: `content/${key}`,
          extension: "yml",
          slug: "{{title}}-{{year}}-{{month}}",
          ...(identifierField ? { identifier_field: identifierField } : {}),
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
      description: "This removes the type definition. Existing content records are not changed.",
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
          if (collection.identifier_field === fieldKey) {
            delete collection.identifier_field;
          }
          if (collection.hierarchy?.id_field === fieldKey) {
            delete collection.hierarchy.id_field;
          }
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
          const descriptions = collection.views?.reference?.description;
          if (Array.isArray(descriptions)) {
            collection.views.reference.description = descriptions.filter(
              (name) => name !== fieldKey
            );
            if (!collection.views.reference.description.length) {
              delete collection.views.reference.description;
            }
          } else if (descriptions === fieldKey) {
            delete collection.views.reference.description;
          }
        }
        for (const candidateType of Object.values(next.node_types)) {
          for (const candidateField of Object.values(candidateType.fields ?? {})) {
            if (
              candidateField.widget === "reference" &&
              next.collections[candidateField.collection]?.node_type === typeKey &&
              candidateField.value_field === fieldKey
            ) {
              delete candidateField.value_field;
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
    <div
      ref={overlayRef}
      className="configuration-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="configuration-settings-title"
      tabIndex="-1"
    >
      <header
        className="configuration-overlay__topbar"
        inert={modalOpen ? true : undefined}
      >
        <span className="configuration-overlay__title">
          <span aria-hidden="true"><Settings2 size={17} /></span>
          <span>
            <strong id="configuration-settings-title">Settings</strong>
          </span>
        </span>
        <span
          className={cx("save-state", dirty && "save-state--dirty")}
          role="status"
          aria-live="polite"
        >
          <i aria-hidden="true" />
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
          aria-label="Close Settings"
          onClick={requestClose}
          disabled={saving}
        >
          <X size={18} />
        </button>
      </header>

      <div
        className="configuration-overlay__workspace"
        inert={modalOpen ? true : undefined}
      >
        <aside className="configuration-navigation">
          <div className="configuration-navigation__search">
            <Search size={14} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Filter settings"
              placeholder="Filter…"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setSearch("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <nav aria-label="Project settings">
            <button
              type="button"
              className={cx(selection.section === "site" && "is-active")}
              aria-current={selection.section === "site" ? "page" : undefined}
              onClick={() => setSelection({ section: "site", key: null })}
            >
              <Settings2 size={15} aria-hidden="true" />
              <span><strong>Project</strong></span>
            </button>
          </nav>
          <div className="configuration-navigation__group">
            <div className="configuration-navigation__heading">
              <span>Collections <small>{collectionEntries.length}</small></span>
              <button
                type="button"
                title="Add collection"
                aria-label="Add collection"
                onClick={() => setEntryDialog({ kind: "collection" })}
              >
                <Plus size={14} />
              </button>
            </div>
            <nav aria-label="Collections">
              {visibleCollections.map(([key, collection]) => (
                <button
                  type="button"
                  key={key}
                  className={cx(
                    selection.section === "collections" &&
                    selection.key === key &&
                    "is-active"
                  )}
                  aria-current={
                    selection.section === "collections" && selection.key === key
                      ? "page"
                      : undefined
                  }
                  onClick={() => setSelection({ section: "collections", key })}
                >
                  <Database size={15} aria-hidden="true" />
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
                aria-label="Add content type"
                onClick={() => setEntryDialog({ kind: "type" })}
              >
                <Plus size={14} />
              </button>
            </div>
            <nav aria-label="Content types">
              {visibleTypes.map(([key, type]) => (
                <button
                  type="button"
                  key={key}
                  className={cx(
                    selection.section === "types" &&
                    selection.key === key &&
                    "is-active"
                  )}
                  aria-current={
                    selection.section === "types" && selection.key === key
                      ? "page"
                      : undefined
                  }
                  onClick={() => setSelection({ section: "types", key })}
                >
                  <Layers3 size={15} aria-hidden="true" />
                  <span>
                    <strong>{type.label || labelFromKey(key)}</strong>
                    <small>{Object.keys(type.fields ?? {}).length} fields</small>
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <main className="configuration-overlay__content">
          {selection.section === "site" && (
            <SiteEditor
              site={draft.site ?? {}}
              backend={draft.backend ?? {}}
              update={update}
            />
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
          {(
            (selection.section === "collections" && !selectedCollection) ||
            (selection.section === "types" && !selectedType)
          ) && (
            <div className="configuration-empty-selection">
              <FileText size={22} aria-hidden="true" />
              <strong>Choose an item</strong>
            </div>
          )}
        </main>
      </div>

      {error && (
        <div
          className="error-banner configuration-error-banner"
          role="alert"
          aria-live="assertive"
        >
          <CircleAlert size={15} aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
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
