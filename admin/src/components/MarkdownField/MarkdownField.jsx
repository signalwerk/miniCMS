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
  useCreateBlockNote
} from "@blocknote/react";
import { Code2, PenLine } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { cx } from "../../model/editor.js";
import "./MarkdownField.scss";

function DeleteOnlyDragHandleMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

function MarkdownField({
  id,
  label,
  value,
  placeholder = "",
  readOnly = false,
  onChange
}) {
  const markdown = typeof value === "string" ? value : String(value ?? "");
  const [viewMode, setViewMode] = useState("editor");
  const applyingExternalMarkdown = useRef(false);
  const onChangeRef = useRef(onChange);
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

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    if (viewMode === "code") return;
    const parsedBlocks = editor.tryParseMarkdownToBlocks(markdown);
    const nextBlocks = parsedBlocks.length
      ? parsedBlocks
      : [{ type: "paragraph" }];
    const nextMarkdown = editor.blocksToMarkdownLossy(nextBlocks);
    const currentMarkdown = editor.blocksToMarkdownLossy(editor.document);
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
      changedEditor.blocksToMarkdownLossy(changedEditor.document)
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
          <div className="markdown-field__editor">
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
                linkToolbar={(props) => (
                  <LinkToolbar {...props}>
                    <EditLinkButton
                      range={props.range}
                      setToolbarOpen={props.setToolbarOpen}
                      setToolbarPositionFrozen={
                        props.setToolbarPositionFrozen
                      }
                      text={props.text}
                      url={props.url}
                    />
                    <OpenLinkButton url={props.url} />
                    <DeleteLinkButton
                      range={props.range}
                      setToolbarOpen={props.setToolbarOpen}
                    />
                  </LinkToolbar>
                )}
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
    </div>
  );
}

export default MarkdownField;
