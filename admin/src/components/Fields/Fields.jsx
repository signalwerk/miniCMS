import {
  Check,
  ChevronDown,
  CircleAlert,
  Files as FilesIcon,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import "./Fields.scss";
import { isGeneratedIdWidget } from "../../../../core/id.js";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  cx,
  defaultFieldValue,
  iconFor,
  referenceItemsForField
} from "../../model/editor.js";
import { imageSource } from "../../model/image.js";
import {
  compactReferenceValue,
  hasReferenceValue,
  normalizeReferenceValue,
  referenceItemValue,
  referenceSelectionDefinitions,
  referenceSelectionOptions
} from "../../model/reference.js";
import { EmptyState, Spinner } from "../Common/Common.jsx";
import { AnnotatedImageField } from "./AnnotatedImageField.jsx";
import { FileUploadField } from "./FileUploadField.jsx";
import { ReferenceSelectionsDialog } from "./ReferenceSelectionsDialog.jsx";

const MarkdownField = lazy(() =>
  import("../MarkdownField/MarkdownField.jsx")
);

function ReferenceCard({ item, view, collection, compact = false }) {
  const adapter = useAdapter();
  const ReferenceIcon = iconFor(collection?.icon, FilesIcon);
  const image = adapter.resolveMediaUrl(
    imageSource(referenceItemValue(item, view.image, collection))
  );
  const title =
    referenceItemValue(item, view.title || "title", collection) ||
    item.title ||
    item.id;
  const descriptions = (Array.isArray(view.description)
    ? view.description
    : view.description
      ? [view.description]
      : []
  )
    .map((name) => referenceItemValue(item, name, collection))
    .filter(Boolean);
  return (
    <span className={cx("reference-card", compact && "reference-card--compact")}>
      <span className="reference-card__image">
        {image ? <img src={image} alt="" /> : <ReferenceIcon size={18} />}
      </span>
      <span className="reference-card__body">
        <strong>{title}</strong>
        {descriptions.map((description, index) => (
          <small key={`${description}-${index}`}>{description}</small>
        ))}
      </span>
    </span>
  );
}

function ReferenceField({ field, value, onChange, collections }) {
  const api = useAdapter();
  const targetCollection = collections.find(
    (collection) => collection.name === field.collection
  );
  const referenceView = targetCollection?.views?.reference ?? {};
  const valueField = field.value_field || referenceView.value || "id";
  const reference = normalizeReferenceValue(value);
  const hasReference = hasReferenceValue(reference.ref);
  const selectionDefinitions = referenceSelectionDefinitions(
    field,
    targetCollection
  );
  const ReferenceIcon = iconFor(targetCollection?.icon, FilesIcon);
  const singularLabel =
    targetCollection?.label_singular?.toLowerCase() || "item";
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectionsOpen, setSelectionsOpen] = useState(false);
  const allowedItems = referenceItemsForField(items, field);
  const selected = allowedItems.find(
    (item) =>
      referenceItemValue(item, valueField, targetCollection) === reference.ref
  );

  useEffect(() => {
    if (!targetCollection) return;
    let cancelled = false;
    setLoading(true);
    api
      .list(targetCollection.name)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetCollection?.name]);

  useEffect(() => {
    if (!open) return undefined;
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = normalizedSearch
    ? allowedItems.filter((item) => {
        const values = [
          item.id,
          item.title,
          ...Object.values(item.properties ?? {})
        ];
        return values.some((entry) =>
          String(entry).toLocaleLowerCase().includes(normalizedSearch)
        );
      })
    : allowedItems;

  if (!targetCollection) {
    return (
      <div className="inline-error">
        <CircleAlert size={15} />
        Collection “{field.collection}” does not exist.
      </div>
    );
  }

  return (
    <div className="reference-field">
      {selected ? (
        <ReferenceCard
          item={selected}
          view={referenceView}
          collection={targetCollection}
          compact
        />
      ) : hasReference ? (
        <div className="reference-field__missing">
          <CircleAlert size={15} />
          Missing reference <code>{String(reference.ref)}</code>
        </div>
      ) : (
        <div className="reference-field__empty">No {singularLabel} selected</div>
      )}
      {selected && selectionDefinitions.length > 0 && (
        <div className="reference-field__selections">
          {selectionDefinitions.map((definition) => {
            const selectedValue = reference.selections[definition.name];
            const option = referenceSelectionOptions(
              selected,
              definition,
              targetCollection
            ).find((candidate) => candidate.value === selectedValue);
            return (
              <span key={definition.name}>
                <strong>{definition.label || definition.name}</strong>
                <small className={cx(selectedValue && !option && "is-missing")}>
                  {option?.label || (selectedValue ? "Missing annotation" : "None")}
                </small>
              </span>
            );
          })}
        </div>
      )}
      <div className="reference-field__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setOpen(true)}
        >
          <Search size={14} />
          {hasReference
            ? `Change ${singularLabel}`
            : `Choose ${singularLabel}`}
        </button>
        {selected && selectionDefinitions.length > 0 && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setSelectionsOpen(true)}
          >
            <SlidersHorizontal size={14} />
            Configure selections
          </button>
        )}
        {hasReference && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      {error && <small className="field-error">{error}</small>}
      {selectionsOpen && selected && (
        <ReferenceSelectionsDialog
          collection={targetCollection}
          definitions={selectionDefinitions}
          item={selected}
          value={value}
          onCancel={() => setSelectionsOpen(false)}
          onApply={(selections) => {
            onChange(
              compactReferenceValue({ ref: reference.ref, selections })
            );
            setSelectionsOpen(false);
          }}
        />
      )}
      {open && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog reference-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-dialog-title"
          >
            <div className="dialog__top">
              <span className="dialog__icon">
                <ReferenceIcon size={18} />
              </span>
              <div>
                <h2 id="reference-dialog-title">
                  Choose {targetCollection.label_singular}
                </h2>
                <p>
                  Select an entry from the {targetCollection.label} collection.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog__body reference-dialog__body">
              <div className="insertion-dialog__search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${targetCollection.label.toLowerCase()}…`}
                  autoFocus
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="reference-dialog__items">
                {visibleItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={cx(
                      referenceItemValue(item, valueField, targetCollection) ===
                        reference.ref &&
                        "is-selected"
                    )}
                    onClick={() => {
                      const nextReference = referenceItemValue(
                        item,
                        valueField,
                        targetCollection
                      );
                      onChange(
                        nextReference === reference.ref
                          ? compactReferenceValue(reference)
                          : nextReference
                      );
                      setOpen(false);
                    }}
                  >
                    <ReferenceCard
                      item={item}
                      view={referenceView}
                      collection={targetCollection}
                    />
                    {referenceItemValue(item, valueField, targetCollection) ===
                      reference.ref && (
                      <Check size={15} />
                    )}
                  </button>
                ))}
                {!loading && !visibleItems.length && (
                  <EmptyState
                    icon={ReferenceIcon}
                    title={`No matching ${targetCollection.label.toLowerCase()}`}
                  />
                )}
                {loading && (
                  <div className="panel-loader">
                    <Spinner />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  idPrefix = "field",
  collections = []
}) {
  const id = `${idPrefix}-${field.name}`;
  const headingId = `${id}-label`;
  const resolvedValue = value ?? defaultFieldValue(field);
  const common = {
    id,
    value: resolvedValue,
    onChange: (event) => onChange(event.target.value)
  };

  let control;
  if (field.widget === "boolean") {
    control = (
      <button
        type="button"
        id={id}
        className={cx("switch", resolvedValue && "switch--on")}
        role="switch"
        aria-checked={Boolean(resolvedValue)}
        onClick={() => onChange(!resolvedValue)}
      >
        <span />
      </button>
    );
  } else if (field.widget === "select") {
    control = (
      <div className="select-wrap">
        <select {...common}>
          {(resolvedValue === "" || field.required === false) && (
            <option value="" disabled={field.required !== false}>
              {field.required === false ? "None" : "Select…"}
            </option>
          )}
          {(field.options ?? []).map((option) => {
            const optionObject =
              typeof option === "object" ? option : { label: option, value: option };
            return (
              <option key={optionObject.value} value={optionObject.value}>
                {optionObject.label}
              </option>
            );
          })}
        </select>
        <ChevronDown size={14} />
      </div>
    );
  } else if (field.widget === "text") {
    control = (
      <textarea
        {...common}
        rows={3}
        placeholder={field.hint || ""}
      />
    );
  } else if (field.widget === "markdown") {
    control = (
      <Suspense
        fallback={
          <textarea
            {...common}
            rows={7}
            placeholder={field.hint || ""}
          />
        }
      >
        <MarkdownField
          id={id}
          label={field.label || field.name}
          value={resolvedValue}
          placeholder={field.hint || ""}
          readOnly={field.readonly === true}
          onChange={onChange}
        />
      </Suspense>
    );
  } else if (isGeneratedIdWidget(field.widget)) {
    control = (
      <div className="generated-id-field">
        <input
          {...common}
          type="text"
          readOnly={field.readonly !== false}
          spellCheck="false"
          placeholder="Generated ID"
        />
        <span>ID</span>
      </div>
    );
  } else if (field.widget === "image") {
    control = (
      <AnnotatedImageField
        id={id}
        field={field}
        value={resolvedValue}
        onChange={onChange}
      />
    );
  } else if (field.widget === "file") {
    control = (
      <FileUploadField
        id={id}
        field={field}
        value={resolvedValue}
        onChange={onChange}
      />
    );
  } else if (field.widget === "reference") {
    control = (
      <ReferenceField
        field={field}
        value={resolvedValue}
        onChange={onChange}
        collections={collections}
      />
    );
  } else {
    control = (
      <input
        {...common}
        onChange={
          field.widget === "number"
            ? (event) =>
                onChange(
                  event.target.value === ""
                    ? ""
                    : Number(event.target.value)
                )
            : common.onChange
        }
        type={
          field.widget === "datetime"
            ? "date"
            : field.widget === "number"
              ? "number"
              : "text"
        }
        placeholder={field.hint || ""}
      />
    );
  }

  return (
    <div className={cx("field", field.widget === "boolean" && "field--inline")}>
      <div className="field__heading">
        <label
          id={headingId}
          htmlFor={id}
          onClick={
            field.widget === "markdown"
              ? () => document.getElementById(id)?.focus()
              : undefined
          }
        >
          {field.label || field.name}
        </label>
        {field.required === false && <span>Optional</span>}
      </div>
      {control}
      {field.hint && field.widget !== "string" && <small>{field.hint}</small>}
    </div>
  );
}


export { Field };
