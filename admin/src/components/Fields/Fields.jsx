import {
  Check,
  ChevronDown,
  CircleAlert,
  Image,
  Search,
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

function referenceItemValue(item, name, collection) {
  if (!name || name === "id" || name === "$id") return item.id;
  const extension = String(collection?.extension || "yml").replace(/^\./, "");
  if (name === "$filename") return `${item.id}.${extension}`;
  if (name === "$storage_path") {
    return `${String(collection?.folder || "").replace(/\/$/, "")}/${item.id}.${extension}`;
  }
  if (name === "$created_at") return item.created_at;
  if (name === "$updated_at") return item.updated_at;
  return item.properties?.[name] ?? item[name] ?? "";
}

function ReferenceCard({ item, view, collection, compact = false }) {
  const image = referenceItemValue(item, view.image, collection);
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
    (item) => referenceItemValue(item, valueField, targetCollection) === value
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
        <ReferenceCard
          item={selected}
          view={referenceView}
          collection={targetCollection}
          compact
        />
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
                      referenceItemValue(item, valueField, targetCollection) ===
                        value &&
                        "is-selected"
                    )}
                    onClick={() => {
                      onChange(
                        referenceItemValue(item, valueField, targetCollection)
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
                      value && (
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
