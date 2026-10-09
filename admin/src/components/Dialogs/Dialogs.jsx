import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  FileText,
  Layers3,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./Dialogs.scss";
import {
  cx,
  defaultFieldValue,
  defaultProperties,
  iconFor,
  isSaveShortcut,
  isDiscardShortcut,
  typeField,
  typeFields
} from "../../model/editor.js";
import { populateInitialSlugFields } from "../../model/nodeFactory.js";
import {
  renderSlugTemplate,
  slugTemplateFieldNames
} from "../../../../core/slug.js";
import { ChoiceTabs, EmptyState, PrimaryShortcut, Spinner } from "../Common/Common.jsx";
import { Field } from "../Fields/Fields.jsx";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";

function InsertionDialog({
  kind,
  modes,
  nodeTypes,
  collection,
  collections,
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
  const [propertyOverridesByType, setPropertyOverridesByType] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const previewProperties = populateInitialSlugFields(selectedType, {
    ...initialProperties,
    ...propertyOverrides,
    title: title.trim()
  });
  const templateFields = collection?.slug
    ? slugTemplateFieldNames(collection.slug, identifierField)
        .filter((name) => name !== "title")
        .map((name) => typeField(selectedType, name))
        .filter(Boolean)
    : [];
  const filenameSlug = collection?.slug
    ? renderSlugTemplate(collection.slug, {
        fields: previewProperties,
        identifierField,
        date: creationDate,
        fallback: ""
      })
    : "";
  const canInsert =
    selectedChoice &&
    !busy &&
    (kind !== "collection" || title.trim());

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

        <ChoiceTabs
          items={modes.map((mode) => ({
            value: mode.id,
            label: mode.label,
            icon: mode.id === "before"
              ? <ArrowUp size={14} />
              : mode.id === "after"
                ? <ArrowDown size={14} />
                : <Plus size={14} />,
            meta: mode.choices.length,
            disabled: !mode.choices.length
          }))}
          value={activeMode?.id}
          label="Insertion position"
          onChange={(nextModeId) => {
            const nextMode = modes.find((mode) => mode.id === nextModeId);
            if (nextMode) chooseMode(nextMode);
          }}
        />

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
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={`Untitled ${nodeTypes[selectedChoice.typeName]?.label || "item"}`}
                />
              </div>
              <div className="field">
                <div className="field__heading">
                  <label>Filename</label>
                </div>
                <div className="generated-filename">
                  <code>{`${filenameSlug ? `${filenameSlug}-` : ""}<id>.${String(
                    collection?.extension || "yml"
                  ).replace(/^\./, "")}`}</code>
                  {collection?.slug && (
                    <small title={collection.slug}>
                      Generated from {collection.slug}
                    </small>
                  )}
                </div>
              </div>
              {templateFields.map((field) => (
                <Field
                  key={field.name}
                  field={field}
                  value={previewProperties[field.name]}
                  properties={previewProperties}
                  idPrefix="insert-field"
                  collectionName={collection?.name}
                  collections={collections}
                  nodeTypes={nodeTypes}
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

function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  secondaryLabel,
  discard = false,
  danger = false,
  onCancel,
  onSecondary,
  onConfirm
}) {
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const busy = Boolean(busyAction);
  const hasSecondaryAction = Boolean(onSecondary && secondaryLabel);

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    const restoreIsolation = isolateFocusSurface(dialogRef.current);
    return () => {
      restoreIsolation();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyboard(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;
      if (discard && isDiscardShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) void runAction(onConfirm, "confirm");
        return;
      }
      if (isSaveShortcut(event)) {
        if (!hasSecondaryAction) return;
        event.preventDefault();
        if (!busy) void runAction(onSecondary, "secondary");
        return;
      }
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current?.contains(event.target)) {
        return;
      }
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyboard, true);
    return () => document.removeEventListener("keydown", handleKeyboard, true);
  }, [busy, discard, hasSecondaryAction, onCancel, onConfirm, onSecondary]);

  async function runAction(action, name) {
    setBusyAction(name);
    setError("");
    try {
      await action();
      onCancel();
    } catch (confirmError) {
      setError(confirmError.message);
      setBusyAction("");
    }
  }

  function submit(event) {
    event.preventDefault();
    if (hasSecondaryAction) runAction(onSecondary, "secondary");
    else runAction(onConfirm, "confirm");
  }

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="dialog confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        onSubmit={submit}
      >
        <div className="dialog__top">
          <span
            className={cx(
              "dialog__icon",
              danger && "dialog__icon--danger"
            )}
            aria-hidden="true"
          >
            {danger ? <Trash2 size={18} /> : <CircleAlert size={18} />}
          </span>
          <div>
            <h2 id="confirmation-dialog-title">{title}</h2>
            <p id="confirmation-dialog-description">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className="dialog__body">
            <div className="inline-error" role="alert">
              <CircleAlert size={15} aria-hidden="true" />
              {error}
            </div>
          </div>
        )}
        <div className="dialog__footer">
          <button
            type="button"
            className="button button--secondary"
            autoFocus={!hasSecondaryAction}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type={hasSecondaryAction ? "button" : "submit"}
            className={cx(
              "button",
              danger ? "button--danger" : "button--primary"
            )}
            onClick={
              hasSecondaryAction
                ? () => runAction(onConfirm, "confirm")
                : undefined
            }
            disabled={busy}
            aria-keyshortcuts={discard ? "Meta+D Control+D" : undefined}
          >
            {busyAction === "confirm" ? (
              <Spinner small />
            ) : danger ? (
              <Trash2 size={15} />
            ) : (
              <Check size={15} />
            )}
            {confirmLabel}
            {discard && <PrimaryShortcut keyName="D" />}
          </button>
          {hasSecondaryAction && (
            <button
              type="submit"
              className="button button--primary"
              aria-keyshortcuts="Enter Control+S Meta+S"
              title={`${secondaryLabel} (Command/Ctrl+S)`}
              autoFocus
              disabled={busy}
            >
              {busyAction === "secondary" ? (
                <Spinner small />
              ) : (
                <Check size={15} />
              )}
              {secondaryLabel}
              <PrimaryShortcut keyName="S" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export { ConfirmationDialog, InsertionDialog };
