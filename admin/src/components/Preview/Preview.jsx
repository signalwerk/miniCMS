import { Component, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Sparkles } from "lucide-react";
import projectPreview from "virtual:minicms-project-preview";
import "./Preview.scss";
import { getNode } from "../../model/editor.js";
import { BrandMark } from "../Common/Common.jsx";

const DEVICES = [
  { id: "desktop", label: "Desktop", description: "Responsive" },
  { id: "tablet", label: "Tablet", description: "768px" },
  { id: "mobile", label: "Mobile", description: "390px" }
];

const FRAME_SOURCE = `<!doctype html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body><div id="minicms-project-preview"></div></body>
</html>`;

const FRAME_STYLES = `
html,
body,
#minicms-project-preview {
  min-height: 100%;
  margin: 0;
}

[data-minicms-node-id] {
  cursor: pointer;
}

[data-minicms-node-id]:hover {
  outline: 2px dashed rgb(74 112 255 / 72%);
  outline-offset: 2px;
}

[data-minicms-node-id]:hover:has([data-minicms-node-id]:hover) {
  outline: 0;
}

[data-minicms-node-id]:focus-visible {
  outline: 2px dashed #4a70ff;
  outline-offset: 2px;
}

[data-minicms-node-id][data-minicms-selected="true"] {
  outline: 3px solid #4a70ff;
  outline-offset: 2px;
}

.minicms-project-preview-error {
  box-sizing: border-box;
  width: min(40rem, calc(100% - 2rem));
  margin: 2rem auto;
  padding: 1rem;
  color: #67221f;
  font: 14px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #fff4f2;
  border: 1px solid #e6b5b0;
}

.minicms-project-preview-error strong,
.minicms-project-preview-error span {
  display: block;
}

.minicms-project-preview-error span {
  margin-top: 0.35rem;
}
`;

function PreviewToolbar({ device, onDeviceChange }) {
  const activeDevice = DEVICES.find((entry) => entry.id === device) || DEVICES[0];
  return (
    <div className="preview__toolbar">
      <div className="device-toggle" aria-label="Preview width">
        {DEVICES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={entry.id === device ? "is-active" : undefined}
            aria-pressed={entry.id === device}
            onClick={() => onDeviceChange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <span className="preview__scale">{activeDevice.description}</span>
      <button type="button" className="icon-button" title="More preview options">
        <MoreHorizontal size={17} />
      </button>
    </div>
  );
}

class ProjectPreviewErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="minicms-project-preview-error" role="alert">
          <strong>The project preview could not be rendered.</strong>
          <span>{this.state.error.message || String(this.state.error)}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function eventNodeBoundary(event, root) {
  const target = event.target;
  const boundary = target?.closest?.("[data-minicms-node-id]");
  return boundary && root.contains(boundary) ? boundary : null;
}

function synchronizeNodeBoundaries(root, selectedId) {
  for (const boundary of root.querySelectorAll("[data-minicms-node-id]")) {
    if (!boundary.hasAttribute("tabindex") || boundary.tabIndex < 0) {
      boundary.tabIndex = 0;
    }
    const nativeInteractive = boundary.matches(
      "a[href], button, input, select, textarea, summary, [contenteditable='true']"
    );
    if (!boundary.hasAttribute("role") && !nativeInteractive) {
      boundary.setAttribute("role", "button");
      boundary.setAttribute("data-minicms-authoring-role", "");
    }
    if (
      boundary.hasAttribute("data-minicms-authoring-role") &&
      !boundary.hasAttribute("aria-label")
    ) {
      const type = boundary.dataset.minicmsNodeType || "content";
      boundary.setAttribute(
        "aria-label",
        `Select ${type} ${boundary.dataset.minicmsNodeId}`
      );
    }
    const selected = boundary.dataset.minicmsNodeId === selectedId;
    if (selected) {
      boundary.setAttribute("data-minicms-selected", "true");
    } else {
      boundary.removeAttribute("data-minicms-selected");
    }
    if (boundary.hasAttribute("data-minicms-authoring-role")) {
      boundary.setAttribute("aria-pressed", String(selected));
    } else if (selected) {
      if (!boundary.hasAttribute("aria-current")) {
        boundary.setAttribute("aria-current", "true");
        boundary.setAttribute("data-minicms-authoring-current", "");
      }
    } else if (boundary.hasAttribute("data-minicms-authoring-current")) {
      boundary.removeAttribute("aria-current");
      boundary.removeAttribute("data-minicms-authoring-current");
    }
  }
}

function InvalidProjectPreview({ message }) {
  throw new Error(message);
}

function ProjectPreviewFrame({
  Renderer,
  stylesheet,
  record,
  selectedId,
  config,
  collection,
  items,
  contentSource,
  onSelectNode,
  registrationError
}) {
  const [mount, setMount] = useState(null);
  const frameRef = useCallback((frame) => {
    if (!frame) return;
    const connect = () => {
      const document = frame.contentDocument;
      const root = document?.getElementById("minicms-project-preview");
      if (document && root) setMount({ document, root });
    };
    frame.addEventListener("load", connect, { once: true });
    if (frame.contentDocument?.readyState === "complete") connect();
  }, []);

  useEffect(() => {
    if (!mount) return undefined;
    mount.document.documentElement.lang = config.site?.locale || "en";
    const synchronize = () =>
      synchronizeNodeBoundaries(mount.root, selectedId);
    synchronize();
    const Observer = mount.document.defaultView?.MutationObserver;
    if (!Observer) return undefined;
    const observer = new Observer(synchronize);
    observer.observe(mount.root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [config.site?.locale, mount, record, selectedId]);

  const selectBoundary = (event) => {
    if (!mount) return;
    const boundary = eventNodeBoundary(event, mount.root);
    if (!boundary) return;
    const nodeId = boundary.dataset.minicmsNodeId;
    if (!nodeId) return;
    if (
      event.target?.closest?.(
        "a[href], button[type='submit'], input[type='submit'], [formaction]"
      )
    ) {
      event.preventDefault();
    }
    boundary.focus({ preventScroll: true });
    onSelectNode(nodeId);
  };

  const selectBoundaryWithKeyboard = (event) => {
    if (!["Enter", " "].includes(event.key) || event.repeat || !mount) return;
    const boundary = eventNodeBoundary(event, mount.root);
    if (!boundary) return;
    if (event.target !== boundary) return;
    const nodeId = boundary.dataset.minicmsNodeId;
    if (!nodeId) return;
    event.preventDefault();
    onSelectNode(nodeId);
  };

  return (
    <>
      <iframe
        ref={frameRef}
        className="preview__iframe"
        title={`${record.properties?.title || record.id} preview`}
        srcDoc={FRAME_SOURCE}
      />
      {mount &&
        createPortal(
          <>
            {stylesheet ? (
              <style data-minicms-project-styles="">{stylesheet}</style>
            ) : null}
            <style data-minicms-preview-foundation="">{FRAME_STYLES}</style>
          </>,
          mount.document.head
        )}
      {mount &&
        createPortal(
          <div
            className="minicms-project-preview"
            onClickCapture={selectBoundary}
            onKeyDownCapture={selectBoundaryWithKeyboard}
          >
            <ProjectPreviewErrorBoundary resetKey={record}>
              {registrationError ? (
                <InvalidProjectPreview message={registrationError} />
              ) : (
                <Renderer
                  record={record}
                  selectedId={selectedId}
                  config={config}
                  collection={collection}
                  items={items}
                  contentSource={contentSource}
                />
              )}
            </ProjectPreviewErrorBoundary>
          </div>,
          mount.root
        )}
    </>
  );
}

function PlaceholderPreview({ record, selectedId, nodeTypes, siteName, device }) {
  const selected = getNode(record, selectedId);
  const type = selected ? nodeTypes[selected.type] : null;
  const title = record?.properties?.title || "Untitled";
  const selectedLabel =
    selected?.properties?.heading ||
    selected?.properties?.title ||
    selected?.properties?.alt ||
    type?.label;

  return (
    <div className="preview__stage">
      <div className={`preview__paper preview__paper--${device}`}>
        <div className="preview__paper-nav">
          <BrandMark />
          <span>{siteName}</span>
          <i />
          <i />
          <i />
        </div>
        <div className="preview__paper-body">
          <span className="preview__eyebrow">Preview surface</span>
          <h1>{title}</h1>
          <p>
            The live site preview will be connected here. The editor structure and
            selection context are already in place.
          </p>
          <div className="preview__placeholder">
            <Sparkles size={18} />
            <div>
              <strong>{selectedLabel || "Select a content node"}</strong>
              <span>
                {selected
                  ? `${type?.label || selected.type} selected in the content tree`
                  : "Selection details will appear here"}
              </span>
            </div>
          </div>
        </div>
        <div className="preview__paper-footer">
          <span>{siteName}</span>
          <span>Content preview reserved</span>
        </div>
      </div>
    </div>
  );
}

function Preview({
  record,
  selectedId,
  nodeTypes,
  config,
  collection,
  items,
  contentSource,
  onSelectNode,
  siteName = "miniCMS"
}) {
  const [device, setDevice] = useState("desktop");
  const configuredRenderer = projectPreview?.collections?.[collection?.name];
  const rendererIsValid = typeof configuredRenderer === "function";
  const rendererIsConfigured = configuredRenderer !== undefined;
  const stylesheetIsValid =
    projectPreview?.stylesheet === undefined ||
    typeof projectPreview.stylesheet === "string";
  const registrationError = !rendererIsValid && rendererIsConfigured
    ? `The project preview registered for "${collection.name}" is not a React component.`
    : !stylesheetIsValid
      ? "The project preview stylesheet must be a string."
      : "";
  const Renderer = rendererIsValid ? configuredRenderer : InvalidProjectPreview;
  const hasProjectPreview = rendererIsConfigured;
  const stylesheet = stylesheetIsValid ? projectPreview?.stylesheet || "" : "";

  return (
    <div className="preview">
      <PreviewToolbar device={device} onDeviceChange={setDevice} />
      {hasProjectPreview ? (
        <div className="preview__stage preview__stage--live">
          <div className={`preview__viewport preview__viewport--${device}`}>
            <ProjectPreviewFrame
              Renderer={Renderer}
              stylesheet={stylesheet}
              record={record}
              selectedId={selectedId}
              config={config}
              collection={collection}
              items={items}
              contentSource={contentSource}
              onSelectNode={onSelectNode}
              registrationError={registrationError}
            />
          </div>
        </div>
      ) : (
        <PlaceholderPreview
          record={record}
          selectedId={selectedId}
          nodeTypes={nodeTypes}
          siteName={siteName}
          device={device}
        />
      )}
    </div>
  );
}

function hasProjectPreview(collectionName) {
  return Boolean(
    collectionName &&
      Object.prototype.hasOwnProperty.call(
        projectPreview?.collections ?? {},
        collectionName
      )
  );
}

export { hasProjectPreview, Preview };
