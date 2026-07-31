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
  slugifyId,
  typeField,
  typeFields
} from "../../model/editor.js";
import {
  renderSlugTemplate,
  slugTemplateFieldNames,
  uniqueFilenameStem
} from "../../../shared/slug.js";
import { EmptyState, Spinner } from "../Common/Common.jsx";
import { Field } from "../Fields/Fields.jsx";

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

export { ConfirmationDialog, InsertionDialog };
