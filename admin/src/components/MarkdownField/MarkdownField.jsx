import { filterSuggestionItems } from "@blocknote/core/extensions";
import { en } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DeleteLinkButton,
  DragHandleMenu,
  EditLinkButton,
  FileCaptionButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  LinkToolbar,
  LinkToolbarController,
  NestBlockButton,
  OpenLinkButton,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  UnnestBlockButton,
  useComponentsContext,
  useCreateBlockNote
} from "@blocknote/react";
import { Code2, Link2, PenLine, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  buildInlineReferenceUrl,
  isAllowedMarkdownLink,
  parseInlineReferenceUrl
} from "../../../../core/inline-reference.js";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { cx, isSaveShortcut, typeFields } from "../../model/editor.js";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";
import {
  blocksToMarkdownWithSafeReferences,
  inlineReferenceCreationConfig,
  inlineReferenceOption,
  inlineReferenceOptions
} from "../../model/markdown.js";
import {
  createReferencedRecordDraft,
  referenceRecordCreationConfig,
  storeReferencedRecordDraft
} from "../../model/reference.js";
import { fieldIsVisible } from "../../model/views.js";
import "./MarkdownField.scss";

function parsedInlineReference(url) {
  try {
    return parseInlineReferenceUrl(url);
  } catch {
    return null;
  }
}

function isValidEditorLink(url) {
  return typeof url === "string" && isAllowedMarkdownLink(url);
}

function preventInlineReferenceNavigation(event) {
  const target = event.target;
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (anchor && parsedInlineReference(anchor.getAttribute("href"))) {
    event.preventDefault();
  }
}

function DeleteOnlyDragHandleMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

function ReplaceInlineReferenceButton({ onClick }) {
  const Components = useComponentsContext();
  if (!Components) return null;
  return (
    <Components.LinkToolbar.Button
      label="Replace reference"
      mainTooltip="Replace reference"
      icon={<Link2 size={14} />}
      onClick={onClick}
    />
  );
}

function InlineReferenceDialog({
  collection,
  listError,
  createError,
  items,
  loading,
  creating,
  creation,
  creationDraft,
  creationFields,
  renderCreationField,
  onCancel,
  onChoose,
  onStartCreate,
  onStore
}) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("select");
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const titleId = useId();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = normalizedSearch
    ? items.filter((item) => item.searchText.includes(normalizedSearch))
    : items;
  const singularLabel = collection?.label_singular || "item";
  const creationEnabled = Boolean(creation);

  useEffect(() => {
    const restoreIsolation = isolateFocusSurface(dialogRef.current);
    return restoreIsolation;
  }, []);

  useEffect(() => {
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
  }, [activeTab]);

  useEffect(() => {
    function handleKeyDown(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;

      if (isSaveShortcut(event) && activeTab === "create") {
        event.preventDefault();
        event.stopPropagation();
        if (!creating && creationDraft && !loading) void onStore();
        return;
      }
      if (!dialogRef.current?.contains(event.target)) return;
      if (event.key === "Escape") {
        if (creating) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
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
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTab, creating, creationDraft, loading, onCancel, onStore]);

  function selectTab(tab) {
    if (creating) return;
    if (tab === "create") {
      if (!creationEnabled) return;
      onStartCreate(search.trim());
    }
    setActiveTab(tab);
  }

  function handleTabKey(event, tab) {
    let nextTab = "";
    if (event.key === "Home") nextTab = "select";
    if (event.key === "End") {
      nextTab = creationEnabled ? "create" : "select";
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextTab = tab === "select" && creationEnabled ? "create" : "select";
    }
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`${titleId}-${nextTab}-tab`)?.focus();
    });
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="dialog-backdrop markdown-reference-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!creating && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="markdown-reference-dialog"
        data-reference-dialog=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={creating}
      >
        <header className="markdown-reference-dialog__header">
          <span className="markdown-reference-dialog__icon" aria-hidden="true">
            <Link2 size={17} />
          </span>
          <div>
            <h2 id={titleId}>Insert {singularLabel.toLocaleLowerCase()}</h2>
            <p>{collection?.label || "Referenced content"}</p>
          </div>
          <button
            type="button"
            aria-label="Close reference picker"
            disabled={creating}
            onClick={onCancel}
          >
            <X size={17} />
          </button>
        </header>

        <div
          className="markdown-reference-dialog__tabs"
          role="tablist"
          aria-label="Reference item action"
        >
          {["select", "create"].map((tab) => {
            const selected = activeTab === tab;
            const disabled = tab === "create" && !creationEnabled;
            return (
              <button
                key={tab}
                id={`${titleId}-${tab}-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${titleId}-${tab}-panel`}
                tabIndex={selected ? 0 : -1}
                className={cx(selected && "is-active")}
                disabled={disabled || creating}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => handleTabKey(event, tab)}
              >
                {tab === "select" ? "Select" : "Create"}
              </button>
            );
          })}
        </div>

        {activeTab === "select" ? (
          <div
            id={`${titleId}-select-panel`}
            className="markdown-reference-dialog__select-panel"
            role="tabpanel"
            aria-labelledby={`${titleId}-select-tab`}
          >
            <div className="markdown-reference-dialog__search">
              <Search size={15} aria-hidden="true" />
              <label className="visually-hidden" htmlFor={`${titleId}-search`}>
                Search {collection?.label || "referenced content"}
              </label>
              <input
                ref={searchRef}
                id={`${titleId}-search`}
                type="search"
                value={search}
                placeholder={`Search ${String(collection?.label || "items").toLocaleLowerCase()}…`}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="markdown-reference-dialog__results">
              {listError ? (
                <p className="markdown-reference-dialog__message" role="alert">
                  {listError}
                </p>
              ) : loading ? (
                <p className="markdown-reference-dialog__message" role="status">
                  Loading…
                </p>
              ) : visibleItems.length ? (
                <ul aria-label={collection?.label || "Referenced content"}>
                  {visibleItems.map((item) => (
                    <li key={`${item.recordId}-${item.value}`}>
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => onChoose(item)}
                      >
                        <strong>{item.label}</strong>
                        {item.label !== item.recordId && (
                          <span>{item.recordId}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="markdown-reference-dialog__message" role="status">
                  No matching {singularLabel.toLocaleLowerCase()}.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            id={`${titleId}-create-panel`}
            className="markdown-reference-dialog__create-panel"
            role="tabpanel"
            aria-labelledby={`${titleId}-create-tab`}
          >
            <section
              className="markdown-reference-dialog__inspector"
              aria-label={`New ${singularLabel.toLocaleLowerCase()} inspector`}
            >
              <header>
                <strong>{creation?.type?.label || creation?.typeName}</strong>
                <small>New {singularLabel.toLocaleLowerCase()}</small>
              </header>
              <div className="markdown-reference-dialog__inspector-heading">
                Inspector
              </div>
              <div className="markdown-reference-dialog__inspector-fields">
                {createError && (
                  <p className="markdown-reference-dialog__create-error" role="alert">
                    {createError}
                  </p>
                )}
                {creationFields.map((field) => renderCreationField(field))}
                {!creationFields.length && (
                  <p className="markdown-reference-dialog__message">
                    No fields configured.
                  </p>
                )}
              </div>
            </section>
            <footer className="markdown-reference-dialog__footer">
              <button type="button" disabled={creating} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!creationDraft || loading || creating}
                onClick={() => void onStore()}
              >
                {creating ? "Creating…" : "Create and insert"}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

function MarkdownField({
  id,
  label,
  value,
  blocknote,
  collections = [],
  nodeTypes = {},
  referenceCreateStack = [],
  renderReferenceField,
  placeholder = "",
  readOnly = false,
  onChange
}) {
  const adapter = useAdapter();
  const markdown = typeof value === "string" ? value : String(value ?? "");
  const [viewMode, setViewMode] = useState("editor");
  const [referencePicker, setReferencePicker] = useState(null);
  const [referenceItems, setReferenceItems] = useState([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceCreating, setReferenceCreating] = useState(false);
  const [referenceListError, setReferenceListError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [referenceDraft, setReferenceDraft] = useState(null);
  const [referenceCreationDate, setReferenceCreationDate] = useState(
    () => new Date()
  );
  const applyingExternalMarkdown = useRef(false);
  const onChangeRef = useRef(onChange);
  const inlineReference = blocknote?.inline_reference;
  const targetCollection = collections.find(
    (collection) => collection.name === inlineReference?.collection
  );
  const referenceCreation = referenceRecordCreationConfig(
    targetCollection,
    nodeTypes
  );
  const referenceCreationBlocked = referenceCreateStack.includes(
    targetCollection?.name
  );
  const availableReferenceCreation =
    referenceCreation && !referenceCreationBlocked
      ? referenceCreation
      : null;
  const quickReferenceCreation = inlineReferenceCreationConfig(
    targetCollection,
    nodeTypes,
    inlineReference?.preview_field
  );
  const referenceCreationFields = referenceDraft && referenceCreation
    ? typeFields(referenceCreation.type).filter((field) =>
        fieldIsVisible(field, referenceDraft.properties)
      )
    : [];
  const dictionary = useMemo(
    () => ({
      ...en,
      placeholders: {
        ...en.placeholders,
        ...(placeholder ? { default: placeholder } : {})
      }
    }),
    [placeholder]
  );
  const editor = useCreateBlockNote({
    dictionary,
    domAttributes: {
      editor: {
        id,
        "aria-label": label
      }
    },
    links: {
      isValidLink: isValidEditorLink,
      onClick: (event) => {
        event.preventDefault();
        return false;
      }
    }
  }, [dictionary, id, label]);
  const slashMenuItems = useMemo(
    () => getDefaultReactSlashMenuItems(editor),
    [editor]
  );
  const referenceOptions = useMemo(() => {
    if (!targetCollection) return [];
    return inlineReferenceOptions(
      referenceItems,
      targetCollection,
      inlineReference?.preview_field
    );
  }, [inlineReference?.preview_field, referenceItems, targetCollection]);

  useEffect(() => {
    if (!referencePicker) return undefined;
    setReferenceItems([]);
    setReferenceListError("");
    if (!targetCollection) {
      setReferenceLoading(false);
      setReferenceListError(
        `Collection “${inlineReference?.collection || ""}” does not exist.`
      );
      return undefined;
    }

    let cancelled = false;
    setReferenceLoading(true);
    adapter
      .list(targetCollection.name)
      .then((result) => {
        if (!cancelled) {
          setReferenceItems(Array.isArray(result?.items) ? result.items : []);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setReferenceListError(
            loadError?.message || "The referenced collection could not be loaded."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setReferenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    inlineReference?.collection,
    Boolean(referencePicker),
    targetCollection?.name
  ]);

  const openReferencePicker = useCallback((editPosition = null) => {
    if (readOnly || !inlineReference?.collection) return;
    setReferencePicker({
      editPosition,
      returnFocus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    });
    setReferenceCreating(false);
    setReferenceDraft(null);
    setReferenceCreationDate(new Date());
    setReferenceListError("");
    setReferenceError("");
  }, [inlineReference?.collection, readOnly]);

  const closeReferencePicker = useCallback(() => {
    const returnFocus = referencePicker?.returnFocus;
    setReferencePicker(null);
    setReferenceDraft(null);
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus();
      else editor.focus();
    });
  }, [editor, referencePicker]);

  const chooseReference = useCallback((option) => {
    if (!targetCollection || !referencePicker) return;
    const url = buildInlineReferenceUrl(targetCollection.name, option.value);
    if (Number.isFinite(referencePicker.editPosition)) {
      editor.editLink(url, option.label, referencePicker.editPosition);
    } else {
      editor.createLink(url, option.label);
    }
    closeReferencePicker();
  }, [closeReferencePicker, editor, referencePicker, targetCollection]);

  const startReferenceCreation = useCallback((seed = "") => {
    if (!availableReferenceCreation || !targetCollection) return;
    setReferenceError("");
    setReferenceDraft((current) => {
      if (current) return current;
      const draft = createReferencedRecordDraft({
        collection: targetCollection,
        nodeTypes,
        items: referenceItems
      });
      return seed && quickReferenceCreation
        ? {
            ...draft,
            properties: {
              ...draft.properties,
              [quickReferenceCreation.fieldName]: seed
            }
          }
        : draft;
    });
  }, [
    availableReferenceCreation,
    nodeTypes,
    quickReferenceCreation,
    referenceItems,
    targetCollection
  ]);

  const storeReference = useCallback(async () => {
    if (
      referenceCreating ||
      !referencePicker ||
      !targetCollection ||
      !availableReferenceCreation ||
      !referenceDraft ||
      referenceLoading ||
      referenceListError
    ) {
      return;
    }
    setReferenceCreating(true);
    setReferenceError("");
    try {
      const result = await storeReferencedRecordDraft({
        adapter,
        draft: referenceDraft,
        fields: referenceCreationFields,
        collection: targetCollection,
        nodeTypes,
        items: referenceItems,
        date: referenceCreationDate,
        optionForItem: (item) =>
          inlineReferenceOption(
            item,
            targetCollection,
            inlineReference?.preview_field
          )
      });
      setReferenceItems(result.items);
      chooseReference(result.option);
    } catch (createError) {
      setReferenceError(
        createError?.message || "The referenced item could not be created."
      );
    } finally {
      setReferenceCreating(false);
    }
  }, [
    adapter,
    availableReferenceCreation,
    chooseReference,
    inlineReference?.preview_field,
    nodeTypes,
    referenceCreating,
    referenceCreationDate,
    referenceCreationFields,
    referenceDraft,
    referenceItems,
    referenceListError,
    referenceLoading,
    referencePicker,
    targetCollection
  ]);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    if (viewMode === "code") return;
    const parsedBlocks = editor.tryParseMarkdownToBlocks(markdown);
    const nextBlocks = parsedBlocks.length
      ? parsedBlocks
      : [{ type: "paragraph" }];
    const nextMarkdown = blocksToMarkdownWithSafeReferences(editor, nextBlocks);
    const currentMarkdown = blocksToMarkdownWithSafeReferences(
      editor,
      editor.document
    );
    if (nextMarkdown === currentMarkdown) return;

    applyingExternalMarkdown.current = true;
    try {
      editor.replaceBlocks(editor.document, nextBlocks);
    } finally {
      applyingExternalMarkdown.current = false;
    }
  }, [editor, markdown, viewMode]);

  const handleEditorChange = useCallback((changedEditor) => {
    if (applyingExternalMarkdown.current) return;
    onChangeRef.current(
      blocksToMarkdownWithSafeReferences(
        changedEditor,
        changedEditor.document
      )
    );
  }, []);

  return (
    <div
      className={cx("markdown-field", `markdown-field--${viewMode}`)}
      role="group"
      aria-label={label}
    >
      <div className="markdown-field__toolbar">
        <div role="group" aria-label="Markdown view">
          <button
            type="button"
            className={cx(viewMode === "editor" && "is-active")}
            aria-pressed={viewMode === "editor"}
            onClick={() => setViewMode("editor")}
          >
            <PenLine size={13} /> Editor
          </button>
          <button
            type="button"
            className={cx(viewMode === "code" && "is-active")}
            aria-pressed={viewMode === "code"}
            onClick={() => setViewMode("code")}
          >
            <Code2 size={13} /> Code
          </button>
        </div>
        {inlineReference?.collection && (
          <button
            type="button"
            className="markdown-field__reference-trigger"
            aria-haspopup="dialog"
            aria-expanded={Boolean(referencePicker)}
            disabled={readOnly || viewMode !== "editor"}
            title={
              viewMode === "code"
                ? "Switch to Editor to insert a reference"
                : `Insert ${targetCollection?.label_singular?.toLocaleLowerCase() || "reference"}`
            }
            onClick={() => openReferencePicker()}
          >
            <Link2 size={13} /> Reference
          </button>
        )}
      </div>

      <div className="markdown-field__body">
        {viewMode === "code" ? (
          <textarea
            id={id}
            aria-label={label}
            className="markdown-field__code"
            readOnly={readOnly}
            spellCheck={false}
            value={markdown}
            placeholder={placeholder}
            onChange={(event) => onChangeRef.current(event.target.value)}
          />
        ) : (
          <div
            className="markdown-field__editor"
            onClickCapture={preventInlineReferenceNavigation}
            onAuxClickCapture={preventInlineReferenceNavigation}
          >
            <BlockNoteView
              editable={!readOnly}
              editor={editor}
              theme="dark"
              formattingToolbar={false}
              linkToolbar={false}
              onChange={handleEditorChange}
              sideMenu={false}
              slashMenu={false}
            >
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) =>
                  filterSuggestionItems(slashMenuItems, query)
                }
              />
              <FormattingToolbarController
                formattingToolbar={() => (
                  <FormattingToolbar>
                    <BlockTypeSelect />
                    <FileCaptionButton />
                    <FileReplaceButton />
                    <BasicTextStyleButton basicTextStyle="bold" />
                    <BasicTextStyleButton basicTextStyle="italic" />
                    <BasicTextStyleButton basicTextStyle="strike" />
                    <BasicTextStyleButton basicTextStyle="code" />
                    <NestBlockButton />
                    <UnnestBlockButton />
                    <CreateLinkButton />
                  </FormattingToolbar>
                )}
              />
              <LinkToolbarController
                linkToolbar={(props) => {
                  const internalReference = parsedInlineReference(props.url);
                  return (
                    <LinkToolbar {...props}>
                      {internalReference ? (
                        inlineReference?.collection && !readOnly && (
                          <ReplaceInlineReferenceButton
                            onClick={() => {
                              props.setToolbarOpen?.(false);
                              openReferencePicker(props.range.from);
                            }}
                          />
                        )
                      ) : (
                        <>
                          {!readOnly && (
                            <EditLinkButton
                              range={props.range}
                              setToolbarOpen={props.setToolbarOpen}
                              setToolbarPositionFrozen={
                                props.setToolbarPositionFrozen
                              }
                              text={props.text}
                              url={props.url}
                            />
                          )}
                          <OpenLinkButton url={props.url} />
                        </>
                      )}
                      {!readOnly && (
                        <DeleteLinkButton
                          range={props.range}
                          setToolbarOpen={props.setToolbarOpen}
                        />
                      )}
                    </LinkToolbar>
                  );
                }}
              />
              <SideMenuController
                sideMenu={(props) => (
                  <SideMenu
                    {...props}
                    dragHandleMenu={DeleteOnlyDragHandleMenu}
                  />
                )}
              />
            </BlockNoteView>
          </div>
        )}
      </div>
      {referencePicker && (
        <InlineReferenceDialog
          collection={targetCollection}
          listError={referenceListError}
          createError={referenceError}
          items={referenceOptions}
          loading={referenceLoading}
          creating={referenceCreating}
          creation={
            referenceLoading || referenceListError
              ? null
              : availableReferenceCreation
          }
          creationDraft={referenceDraft}
          creationFields={referenceCreationFields}
          renderCreationField={(field) =>
            renderReferenceField?.({
              key: field.name,
              field,
              value: referenceDraft?.properties?.[field.name],
              idPrefix: `${id}-reference-create`,
              collectionName: targetCollection?.name,
              collections,
              nodeTypes,
              referenceCreateStack: [
                ...referenceCreateStack,
                targetCollection?.name
              ].filter(Boolean),
              onChange: (nextValue) => {
                setReferenceError("");
                setReferenceDraft((current) => ({
                  ...current,
                  properties: {
                    ...current.properties,
                    [field.name]: nextValue
                  }
                }));
              }
            })
          }
          onCancel={closeReferencePicker}
          onChoose={chooseReference}
          onStartCreate={startReferenceCreation}
          onStore={storeReference}
        />
      )}
    </div>
  );
}

export default MarkdownField;
