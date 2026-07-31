import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Image,
  Plus,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./Fields.scss";
import { api } from "../../api.js";
import {
  cx,
  defaultFieldValue
} from "../../model/editor.js";
import { EmptyState, Spinner } from "../Common/Common.jsx";

function ImageUploadField({ id, field, value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadMedia(file);
      onChange(result.path);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="image-field">
      <div className="image-field__preview">
        {value ? (
          <img src={value} alt="" />
        ) : (
          <>
            <Image size={20} />
            <span>No image uploaded</span>
          </>
        )}
      </div>
      <div className="image-field__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner small /> : <Upload size={14} />}
          {value ? "Replace image" : "Upload image"}
        </button>
        {value && field.required === false && (
          <button
            type="button"
            className="button button--secondary"
            disabled={uploading}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      {value && <code className="image-field__path">{value}</code>}
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden"
        type="file"
        accept={field.accept || "image/jpeg,image/png,image/gif,image/webp,image/avif"}
        onChange={upload}
      />
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function referenceItemValue(item, name) {
  if (!name || name === "id" || name === "$id") return item.id;
  return item.properties?.[name] ?? item[name] ?? "";
}

function ReferenceCard({ item, view, compact = false }) {
  const image = referenceItemValue(item, view.image);
  const title =
    referenceItemValue(item, view.title || "title") || item.title || item.id;
  const descriptions = (Array.isArray(view.description)
    ? view.description
    : view.description
      ? [view.description]
      : []
  )
    .map((name) => referenceItemValue(item, name))
    .filter(Boolean);
  return (
    <span className={cx("reference-card", compact && "reference-card--compact")}>
      <span className="reference-card__image">
        {image ? <img src={image} alt="" /> : <Image size={18} />}
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
  const targetCollection = collections.find(
    (collection) => collection.name === field.collection
  );
  const referenceView = targetCollection?.views?.reference ?? {};
  const valueField = field.value_field || referenceView.value || "id";
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selected = items.find(
    (item) => referenceItemValue(item, valueField) === value
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
    ? items.filter((item) => {
        const values = [
          item.id,
          item.title,
          ...Object.values(item.properties ?? {})
        ];
        return values.some((entry) =>
          String(entry).toLocaleLowerCase().includes(normalizedSearch)
        );
      })
    : items;

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
        <ReferenceCard item={selected} view={referenceView} compact />
      ) : value ? (
        <div className="reference-field__missing">
          <CircleAlert size={15} />
          Missing reference <code>{value}</code>
        </div>
      ) : (
        <div className="reference-field__empty">No image selected</div>
      )}
      <div className="reference-field__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setOpen(true)}
        >
          <Search size={14} />
          {value ? "Change image" : "Choose image"}
        </button>
        {value && field.required === false && (
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
                <Image size={18} />
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
                      referenceItemValue(item, valueField) === value &&
                        "is-selected"
                    )}
                    onClick={() => {
                      onChange(referenceItemValue(item, valueField));
                      setOpen(false);
                    }}
                  >
                    <ReferenceCard item={item} view={referenceView} />
                    {referenceItemValue(item, valueField) === value && (
                      <Check size={15} />
                    )}
                  </button>
                ))}
                {!loading && !visibleItems.length && (
                  <EmptyState icon={Image} title="No matching images" />
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

function normalizedObjectFieldValue(field, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const fallback = defaultFieldValue(field, true);
  if (value !== undefined && value !== null && value !== "") {
    if (Object.hasOwn(fallback, "value")) fallback.value = value;
    if (Object.hasOwn(fallback, "label")) fallback.label = String(value);
  }
  return fallback;
}

function ObjectFieldControl({
  field,
  value,
  onChange,
  idPrefix,
  collections
}) {
  const objectValue = normalizedObjectFieldValue(field, value);
  return (
    <div className="object-field">
      {Object.entries(field.fields ?? {}).map(([name, nestedField]) => (
        <Field
          key={name}
          field={{ ...nestedField, name }}
          value={objectValue[name]}
          idPrefix={`${idPrefix}-${field.name}`}
          collections={collections}
          onChange={(nextValue) =>
            onChange({ ...objectValue, [name]: nextValue })
          }
        />
      ))}
    </div>
  );
}

function ListFieldControl({
  field,
  value,
  onChange,
  idPrefix,
  collections
}) {
  const items = Array.isArray(value) ? value : [];
  const itemField = {
    label: "Item",
    widget: "string",
    ...(field.item ?? {}),
    name: "item"
  };

  function updateItem(index, nextValue) {
    onChange(items.map((item, itemIndex) => (
      itemIndex === index ? nextValue : item
    )));
  }

  function moveItem(index, direction) {
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    const nextItems = [...items];
    const [moving] = nextItems.splice(index, 1);
    nextItems.splice(destination, 0, moving);
    onChange(nextItems);
  }

  return (
    <div className="list-field">
      <div className="list-field__items">
        {items.map((item, index) => (
          <div className="list-field__item" key={index}>
            <div className="list-field__item-actions">
              <span>{index + 1}</span>
              <button
                type="button"
                title="Move up"
                disabled={index === 0}
                onClick={() => moveItem(index, -1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                title="Move down"
                disabled={index === items.length - 1}
                onClick={() => moveItem(index, 1)}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                title="Duplicate"
                onClick={() => {
                  const nextItems = [...items];
                  nextItems.splice(index + 1, 0, structuredClone(item));
                  onChange(nextItems);
                }}
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                className="danger"
                title="Remove"
                onClick={() =>
                  onChange(items.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            <Field
              field={{
                ...itemField,
                label: itemField.label || `Item ${index + 1}`
              }}
              value={
                itemField.widget === "object"
                  ? normalizedObjectFieldValue(itemField, item)
                  : item
              }
              idPrefix={`${idPrefix}-${field.name}-${index}`}
              collections={collections}
              onChange={(nextValue) => updateItem(index, nextValue)}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="button button--secondary list-field__add"
        onClick={() =>
          onChange([...items, defaultFieldValue(itemField, true)])
        }
      >
        <Plus size={14} />
        Add {String(itemField.label || "item").toLowerCase()}
      </button>
    </div>
  );
}

function ScalarFieldControl({ id, value, onChange, placeholder }) {
  const valueType =
    value === null
      ? "null"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
  const [draft, setDraft] = useState(
    value === null ? "null" : String(value ?? "")
  );

  useEffect(() => {
    setDraft(value === null ? "null" : String(value ?? ""));
  }, [value]);

  function commit() {
    let nextValue = draft;
    if (valueType === "number" && draft !== "" && Number.isFinite(Number(draft))) {
      nextValue = Number(draft);
    } else if (valueType === "null") {
      nextValue = null;
    }
    if (nextValue !== value) onChange(nextValue);
  }

  return (
    <div className="scalar-field">
      <div className="select-wrap scalar-field__type">
        <select
          aria-label="Scalar type"
          value={valueType}
          onChange={(event) => {
            const nextType = event.target.value;
            if (nextType === "null") onChange(null);
            else if (nextType === "boolean") onChange(Boolean(value));
            else if (nextType === "number") {
              onChange(Number.isFinite(Number(value)) ? Number(value) : 0);
            } else onChange(value === null ? "" : String(value ?? ""));
          }}
        >
          <option value="string">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="null">Null</option>
        </select>
        <ChevronDown size={14} />
      </div>
      {valueType === "boolean" ? (
        <div className="select-wrap">
          <select
            id={id}
            value={value ? "true" : "false"}
            onChange={(event) => onChange(event.target.value === "true")}
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <ChevronDown size={14} />
        </div>
      ) : valueType === "null" ? (
        <code className="scalar-field__null">null</code>
      ) : (
        <input
          id={id}
          type={valueType === "number" ? "number" : "text"}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value === null ? "null" : String(value ?? ""));
              event.currentTarget.blur();
            }
          }}
        />
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
  const resolvedValue = value ?? defaultFieldValue(field);
  const common = {
    id,
    value: resolvedValue,
    onChange: (event) => onChange(event.target.value)
  };

  let control;
  if (field.widget === "object") {
    control = (
      <ObjectFieldControl
        field={field}
        value={resolvedValue}
        onChange={onChange}
        idPrefix={idPrefix}
        collections={collections}
      />
    );
  } else if (field.widget === "list") {
    control = (
      <ListFieldControl
        field={field}
        value={resolvedValue}
        onChange={onChange}
        idPrefix={idPrefix}
        collections={collections}
      />
    );
  } else if (field.widget === "boolean") {
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
          {resolvedValue === "" && (
            <option value="" disabled={field.required !== false}>
              Select…
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
  } else if (["text", "markdown"].includes(field.widget)) {
    control = (
      <textarea
        {...common}
        rows={field.widget === "markdown" ? 7 : 3}
        placeholder={field.hint || ""}
      />
    );
  } else if (field.widget === "uuid") {
    control = (
      <div className="uuid-field">
        <input
          {...common}
          type="text"
          readOnly={field.readonly !== false}
          spellCheck="false"
          placeholder="Generated UUID"
        />
        <span>UUID</span>
      </div>
    );
  } else if (field.widget === "image") {
    control = (
      <ImageUploadField
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
  } else if (field.widget === "scalar") {
    control = (
      <ScalarFieldControl
        id={id}
        value={value}
        onChange={onChange}
        placeholder={field.hint || ""}
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
        <label htmlFor={id}>{field.label || field.name}</label>
        {field.required === false && <span>Optional</span>}
      </div>
      {control}
      {field.hint && field.widget !== "string" && <small>{field.hint}</small>}
    </div>
  );
}


export { Field };
