import CreatableSelect from "react-select/creatable";
import { useEffect, useState } from "react";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  createOrReuseTag,
  normalizeTagIds,
  normalizedTagLabel,
  tagOption,
  tagOptions
} from "../../model/tags.js";
import "./TagsField.scss";

function TagsField({
  id,
  headingId,
  field,
  value,
  onChange,
  collections,
  nodeTypes
}) {
  const adapter = useAdapter();
  const targetCollection = collections.find(
    (collection) => collection.name === field.collection
  );
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const errorId = `${id}-error`;
  const menuPortalTarget =
    typeof document === "undefined" ? undefined : document.body;
  const tagIds = normalizeTagIds(value);
  const options = tagOptions(items, targetCollection);
  const optionsByValue = new Map(
    options.map((option) => [option.value, option])
  );
  const selectedOptions = tagIds.map(
    (tagId) =>
      optionsByValue.get(tagId) ?? {
        value: tagId,
        label: `Missing tag · ${tagId}`,
        missing: true
      }
  );

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError("");

    if (!targetCollection) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    adapter
      .list(targetCollection.name)
      .then((result) => {
        if (!cancelled) setItems(result.items ?? []);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError?.message || "Could not load tags.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, targetCollection?.name]);

  if (!targetCollection) {
    return (
      <div className="tags-field__configuration-error" role="alert">
        {field.collection
          ? `Collection “${field.collection}” does not exist.`
          : "Choose a tag collection in Settings."}
      </div>
    );
  }

  function selectTag(option) {
    onChange(normalizeTagIds([...tagIds, option.value]));
  }

  async function createTag(inputValue) {
    const label = String(inputValue ?? "").trim();
    if (!label || creating) return;

    setCreating(true);
    setError("");
    try {
      const result = await createOrReuseTag({
        adapter,
        label,
        collection: targetCollection,
        nodeTypes,
        items
      });
      const createdOption = tagOption(result.item, targetCollection);
      if (!createdOption) {
        throw new Error("The created tag did not return its generated ID.");
      }
      setItems(
        result.created
          ? [
              ...result.items.filter((item) => item.id !== result.item.id),
              result.item
            ]
          : result.items
      );
      selectTag(createdOption);
    } catch (createError) {
      setError(createError?.message || "Could not create the tag.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="tags-field"
      data-field-popup-open={menuOpen ? "true" : undefined}
    >
      <CreatableSelect
        unstyled
        isMulti
        inputId={id}
        instanceId={id}
        aria-labelledby={headingId}
        aria-errormessage={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        required={field.required === true}
        className="tags-select"
        classNamePrefix="tags-select"
        classNames={{
          multiValue: ({ data }) =>
            data.missing ? "tags-select__multi-value--missing" : ""
        }}
        value={selectedOptions}
        options={options}
        isClearable
        isLoading={loading || creating}
        isDisabled={field.readonly === true || loading || creating}
        closeMenuOnSelect={false}
        menuPortalTarget={menuPortalTarget}
        menuPlacement="auto"
        menuPosition="fixed"
        maxMenuHeight={240}
        placeholder={loading ? "Loading tags…" : "Select or create tags…"}
        formatCreateLabel={(inputValue) => `Create “${inputValue.trim()}”`}
        isValidNewOption={(inputValue) => {
          const label = normalizedTagLabel(inputValue);
          return Boolean(label) && !options.some(
            (option) => normalizedTagLabel(option.label) === label
          );
        }}
        loadingMessage={() => (creating ? "Creating tag…" : "Loading tags…")}
        noOptionsMessage={({ inputValue }) =>
          inputValue.trim() ? "No matching tags" : "No tags yet"
        }
        onMenuOpen={() => setMenuOpen(true)}
        onMenuClose={() => setMenuOpen(false)}
        onChange={(nextOptions) =>
          onChange(normalizeTagIds((nextOptions ?? []).map(({ value }) => value)))
        }
        onCreateOption={(inputValue) => void createTag(inputValue)}
      />
      <div
        id={errorId}
        className="tags-field__status"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {error && <small className="field-error">{error}</small>}
      </div>
    </div>
  );
}

export { TagsField };
