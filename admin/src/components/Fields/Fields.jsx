import {
  Check,
  ChevronDown,
  CircleAlert,
  Files as FilesIcon,
  Plus,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import "./Fields.scss";
import { isGeneratedIdWidget } from "../../../../core/id.js";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  cx,
  defaultFieldValue,
  iconFor,
  isSaveShortcut,
  referenceItemsForField,
  typeFields
} from "../../model/editor.js";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";
import {
  compactReferenceValue,
  createReferencedRecordDraft,
  hasReferenceValue,
  normalizeReferenceValue,
  referenceImageSource,
  referenceItemLabel,
  referenceItemValue,
  referencePickerOption,
  referenceRecordCreationConfig,
  referenceSelectionDefinitions,
  referenceSelectionOptions,
  referenceValueAfterSelection,
  storeReferencedRecordDraft
} from "../../model/reference.js";
import { fieldIsVisible } from "../../model/views.js";
import { EmptyState, Spinner } from "../Common/Common.jsx";
import { AnnotatedImageField } from "./AnnotatedImageField.jsx";
import { FileUploadField } from "./FileUploadField.jsx";
import { ReferenceSelectionsDialog } from "./ReferenceSelectionsDialog.jsx";
import { TagsField } from "./TagsField.jsx";

const MarkdownField = lazy(() =>
  import("../MarkdownField/MarkdownField.jsx")
);

function ReferenceCard({ item, view, collection, compact = false }) {
  const adapter = useAdapter();
  const ReferenceIcon = iconFor(collection?.icon, FilesIcon);
  const source = referenceImageSource(item, view, collection);
  const image = source
    ? adapter.resolveImageUrl(source, {
      width: 320,
      height: 320,
      fit: "inside",
      collection: collection.name
    })
    : "";
  const title = referenceItemLabel(item, view, collection);
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

function ReferenceField({
  field,
  value,
  onChange,
  onPreviewChange,
  onPreviewEnd,
  collections,
  nodeTypes,
  referenceCreateStack = []
}) {
  const api = useAdapter();
  const targetCollection = collections.find(
    (collection) => collection.name === field.collection
  );
  const referenceView = targetCollection?.views?.reference ?? {};
  const reference = normalizeReferenceValue(value);
  const hasReference = hasReferenceValue(reference.ref);
  const selectionDefinitions = referenceSelectionDefinitions(
    field,
    targetCollection
  );
  const ReferenceIcon = iconFor(targetCollection?.icon, FilesIcon);
  const singularLabel =
    targetCollection?.label_singular?.toLowerCase() || "item";
  const dialogId = useId();
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("select");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creationDraft, setCreationDraft] = useState(null);
  const [creationDate, setCreationDate] = useState(() => new Date());
  const [selectionsOpen, setSelectionsOpen] = useState(false);
  const allowedItems = referenceItemsForField(items, field);
  const optionForItem = (item) =>
    referencePickerOption(item, field, targetCollection);
  const pickerOptions = allowedItems.flatMap((item) => {
    const option = optionForItem(item);
    return option ? [option] : [];
  });
  const selectedOption = pickerOptions.find(
    (option) => option.value === reference.ref
  );
  const selected = selectedOption?.item;
  const creation = referenceRecordCreationConfig(targetCollection, nodeTypes, {
    allowedTypes: field.allowed_types
  });
  const CreationIcon = iconFor(creation?.type?.icon, ReferenceIcon);
  const creationBlocked = referenceCreateStack.includes(
    targetCollection?.name
  );
  const canOpenCreate = Boolean(
    creation && !creationBlocked && !loading && !listError
  );
  const creationFields = creationDraft && creation
    ? typeFields(creation.type).filter((candidate) =>
        fieldIsVisible(candidate, creationDraft.properties)
      )
    : [];

  useEffect(() => {
    if (!targetCollection) return;
    let cancelled = false;
    setListError("");
    setLoading(true);
    api
      .list(targetCollection.name)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((loadError) => {
        if (!cancelled) setListError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, open, targetCollection?.name]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = returnFocusRef.current;
    const restoreIsolation = isolateFocusSurface(dialogRef.current);
    return () => {
      restoreIsolation();
      requestAnimationFrame(() => {
        if (!dialogRef.current?.isConnected && previousFocus?.isConnected) {
          previousFocus.focus();
        }
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      if (activeTab === "select") searchRef.current?.focus();
      else {
        dialogRef.current
          ?.querySelector(
            '[role="tabpanel"] input:not([readonly]), [role="tabpanel"] textarea, [role="tabpanel"] select, [role="tabpanel"] button'
          )
          ?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;

      if (isSaveShortcut(event) && activeTab === "create") {
        event.preventDefault();
        event.stopPropagation();
        if (!creating && creationDraft && !loading && !listError) {
          void storeReference();
        }
        return;
      }
      if (!dialogRef.current?.contains(event.target)) return;
      if (event.key === "Escape") {
        if (creating) return;
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTab, creating, creationDraft, listError, loading, open]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleOptions = normalizedSearch
    ? pickerOptions.filter((option) => {
        const item = option.item;
        const values = [
          option.label,
          item.id,
          item.title,
          ...Object.values(item.properties ?? {})
        ];
        return values.some((entry) =>
          String(entry).toLocaleLowerCase().includes(normalizedSearch)
        );
      })
    : pickerOptions;

  function resetPicker() {
    setOpen(false);
    setActiveTab("select");
    setSearch("");
    setCreateError("");
    setCreationDraft(null);
  }

  function openPicker() {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setActiveTab("select");
    setSearch("");
    setCreateError("");
    setCreationDraft(null);
    setCreationDate(new Date());
    setOpen(true);
  }

  function closePicker() {
    if (creating) return;
    resetPicker();
  }

  function chooseReference(option) {
    onChange(referenceValueAfterSelection(value, option.value));
    resetPicker();
  }

  function showCreateTab() {
    if (!canOpenCreate || creating) return;
    setCreateError("");
    setCreationDraft((current) =>
      current ?? createReferencedRecordDraft({
        collection: targetCollection,
        nodeTypes,
        allowedTypes: field.allowed_types,
        items
      })
    );
    setActiveTab("create");
  }

  async function storeReference() {
    if (!creationDraft || creating || loading || listError) return;
    setCreating(true);
    setCreateError("");
    try {
      const result = await storeReferencedRecordDraft({
        adapter: api,
        draft: creationDraft,
        fields: creationFields,
        collection: targetCollection,
        nodeTypes,
        allowedTypes: field.allowed_types,
        items,
        date: creationDate,
        optionForItem
      });
      setItems(result.items);
      chooseReference(result.option);
    } catch (createError) {
      setCreateError(
        createError?.message || "The referenced item could not be created."
      );
    } finally {
      setCreating(false);
    }
  }

  function selectDialogTab(tab) {
    if (tab === "create") showCreateTab();
    else if (!creating) setActiveTab("select");
  }

  function handleDialogTabKey(event, tab) {
    let nextTab = "";
    if (event.key === "Home") nextTab = "select";
    if (event.key === "End") nextTab = canOpenCreate ? "create" : "select";
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextTab = tab === "select" && canOpenCreate ? "create" : "select";
    }
    if (!nextTab) return;
    event.preventDefault();
    selectDialogTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`${dialogId}-${nextTab}-tab`)?.focus();
    });
  }

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
          onClick={openPicker}
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
      {!open && listError && (
        <small className="field-error">{listError}</small>
      )}
      {selectionsOpen && selected && (
        <ReferenceSelectionsDialog
          collection={targetCollection}
          definitions={selectionDefinitions}
          item={selected}
          value={value}
          onPreviewChange={(selections) =>
            onPreviewChange?.(
              compactReferenceValue({ ref: reference.ref, selections })
            )
          }
          onCancel={() => {
            onPreviewEnd?.();
            setSelectionsOpen(false);
          }}
          onApply={(selections) => {
            onPreviewEnd?.();
            onChange(
              compactReferenceValue({ ref: reference.ref, selections })
            );
            setSelectionsOpen(false);
          }}
        />
      )}
      {open && createPortal(
        <div
          ref={backdropRef}
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (!creating && event.target === event.currentTarget) closePicker();
          }}
        >
          <div
            ref={dialogRef}
            className="dialog reference-dialog"
            data-reference-dialog=""
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            aria-busy={creating}
          >
            <div className="dialog__top">
              <span className="dialog__icon">
                <ReferenceIcon size={18} />
              </span>
              <div>
                <h2 id={`${dialogId}-title`}>
                  Reference {targetCollection.label_singular}
                </h2>
                <p>
                  Select an existing {singularLabel} or create a new one.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close reference dialog"
                disabled={creating}
                onClick={closePicker}
              >
                <X size={18} />
              </button>
            </div>
            <div
              className="reference-dialog__tabs"
              role="tablist"
              aria-label="Reference item action"
            >
              <button
                type="button"
                id={`${dialogId}-select-tab`}
                role="tab"
                aria-selected={activeTab === "select"}
                aria-controls={`${dialogId}-select-panel`}
                tabIndex={activeTab === "select" ? 0 : -1}
                className={cx(activeTab === "select" && "is-active")}
                disabled={creating}
                onClick={() => selectDialogTab("select")}
                onKeyDown={(event) => handleDialogTabKey(event, "select")}
              >
                <Search size={14} />
                Select
              </button>
              <button
                type="button"
                id={`${dialogId}-create-tab`}
                role="tab"
                aria-selected={activeTab === "create"}
                aria-controls={`${dialogId}-create-panel`}
                tabIndex={activeTab === "create" ? 0 : -1}
                className={cx(activeTab === "create" && "is-active")}
                disabled={!canOpenCreate || creating}
                title={
                  creationBlocked
                    ? "Creation is unavailable inside this nested reference."
                    : creation
                      ? undefined
                      : "This referenced collection cannot create its primary type."
                }
                onClick={showCreateTab}
                onKeyDown={(event) => handleDialogTabKey(event, "create")}
              >
                <Plus size={14} />
                Create
              </button>
            </div>

            {activeTab === "select" && (
              <div
                id={`${dialogId}-select-panel`}
                className="dialog__body reference-dialog__body reference-dialog__body--select"
                role="tabpanel"
                aria-labelledby={`${dialogId}-select-tab`}
              >
                <div className="insertion-dialog__search">
                  <Search size={15} />
                  <input
                    ref={searchRef}
                    value={search}
                    disabled={creating}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Search ${targetCollection.label.toLowerCase()}…`}
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      disabled={creating}
                      onClick={() => setSearch("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="reference-dialog__items">
                  {listError && (
                    <div className="reference-dialog__error" role="alert">
                      <CircleAlert size={15} />
                      <span>{listError}</span>
                    </div>
                  )}
                  {visibleOptions.map((option) => {
                    const item = option.item;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        disabled={creating}
                        className={cx(
                          option.value === reference.ref && "is-selected"
                        )}
                        onClick={() => chooseReference(option)}
                      >
                        <ReferenceCard
                          item={item}
                          view={referenceView}
                          collection={targetCollection}
                        />
                        {option.value === reference.ref && (
                          <Check size={15} />
                        )}
                      </button>
                    );
                  })}
                  {!loading && !visibleOptions.length && !listError && (
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
            )}

            {activeTab === "create" && creationDraft && creation && (
              <div
                id={`${dialogId}-create-panel`}
                className="dialog__body reference-dialog__body reference-dialog__body--create"
                role="tabpanel"
                aria-labelledby={`${dialogId}-create-tab`}
              >
                <section
                  className="reference-dialog__inspector"
                  aria-label={`New ${targetCollection.label_singular} inspector`}
                >
                  <div className="reference-dialog__inspector-identity">
                    <span className="reference-dialog__inspector-icon">
                      <CreationIcon size={16} />
                    </span>
                    <span>
                      <strong>{creation.type.label || creation.typeName}</strong>
                      <small>New {singularLabel}</small>
                    </span>
                  </div>
                  <div className="reference-dialog__inspector-heading">
                    Inspector
                  </div>
                  <div className="reference-dialog__inspector-fields">
                    {(createError || listError) && (
                      <div className="reference-dialog__error" role="alert">
                        <CircleAlert size={15} />
                        <span>{createError || listError}</span>
                      </div>
                    )}
                    {creationFields.map((creationField) => (
                      <Field
                        key={creationField.name}
                        field={creationField}
                        value={creationDraft.properties?.[creationField.name]}
                        idPrefix={`${dialogId}-create-field`}
                        collectionName={targetCollection.name}
                        collections={collections}
                        nodeTypes={nodeTypes}
                        referenceCreateStack={[
                          ...referenceCreateStack,
                          targetCollection.name
                        ]}
                        onChange={(nextValue) => {
                          setCreateError("");
                          setCreationDraft((current) => ({
                            ...current,
                            properties: {
                              ...current.properties,
                              [creationField.name]: nextValue
                            }
                          }));
                        }}
                      />
                    ))}
                    {!creationFields.length && (
                      <EmptyState title="No fields configured" />
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "create" && (
              <div className="dialog__footer">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={creating}
                  onClick={closePicker}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={
                    !creationDraft ||
                    loading ||
                    Boolean(listError) ||
                    creating
                  }
                  onClick={() => void storeReference()}
                >
                  {creating ? "Creating…" : "Create and select"}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  onPreviewChange,
  onPreviewEnd,
  idPrefix = "field",
  collectionName,
  collections = [],
  nodeTypes = {},
  referenceCreateStack = []
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
          {(resolvedValue === "" || field.required !== true) && (
            <option value="" disabled={field.required === true}>
              {field.required === true ? "Select…" : "None"}
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
          blocknote={field.blocknote}
          collections={collections}
          nodeTypes={nodeTypes}
          referenceCreateStack={referenceCreateStack}
          renderReferenceField={(props) => <Field {...props} />}
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
        collectionName={collectionName}
        onChange={onChange}
      />
    );
  } else if (field.widget === "file") {
    control = (
      <FileUploadField
        id={id}
        field={field}
        value={resolvedValue}
        collectionName={collectionName}
        onChange={onChange}
      />
    );
  } else if (field.widget === "reference") {
    control = (
      <ReferenceField
        field={field}
        value={resolvedValue}
        onChange={onChange}
        onPreviewChange={onPreviewChange}
        onPreviewEnd={onPreviewEnd}
        collections={collections}
        nodeTypes={nodeTypes}
        referenceCreateStack={referenceCreateStack}
      />
    );
  } else if (field.widget === "tags") {
    control = (
      <TagsField
        id={id}
        headingId={headingId}
        field={field}
        value={resolvedValue}
        onChange={onChange}
        collections={collections}
        nodeTypes={nodeTypes}
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
              : field.widget === "url"
                ? "url"
                : "text"
        }
        inputMode={field.widget === "url" ? "url" : undefined}
        autoCapitalize={field.widget === "url" ? "none" : undefined}
        autoCorrect={field.widget === "url" ? "off" : undefined}
        spellCheck={field.widget === "url" ? false : undefined}
        readOnly={field.readonly === true}
        placeholder={
          field.hint || (field.widget === "url" ? "https://" : "")
        }
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
        {field.required !== true && <span>Optional</span>}
      </div>
      {control}
      {field.hint && field.widget !== "string" && <small>{field.hint}</small>}
    </div>
  );
}


export { Field };
