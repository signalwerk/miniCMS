import { Component, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Sparkles } from "lucide-react";
import "./Preview.scss";
import { getNode } from "../../model/editor.js";
import { BrandMark } from "../Common/Common.jsx";
import { focusPropsForNode } from "./preview.js";

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

[data-minicms-node-id] { cursor: pointer; }
[data-minicms-node-id]:hover {
  outline: 2px dashed rgb(74 112 255 / 72%);
  outline-offset: 2px;
}
[data-minicms-node-id]:hover:has([data-minicms-node-id]:hover) { outline: 0; }
[data-minicms-node-id]:focus-visible {
  outline: 2px dashed #4a70ff;
  outline-offset: 2px;
}
[data-minicms-node-id][data-minicms-selected="true"] {
  outline: 3px solid #4a70ff;
  outline-offset: 2px;
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

class PreviewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ProjectPreviewFrame({
  PreviewComponent,
  data,
  selectedId,
  onSelectNode,
  revealRequest,
  onError
}) {
  const [mount, setMount] = useState(null);
  const boundariesRef = useRef(new Map());
  const revealRequestRef = useRef(revealRequest);
  revealRequestRef.current = revealRequest;

  const frameRef = useCallback((frame) => {
    if (!frame) {
      setMount(null);
      return;
    }
    const connect = () => {
      const document = frame.contentDocument;
      const root = document?.getElementById("minicms-project-preview");
      if (document && root) {
        setMount((current) =>
          current?.root === root ? current : { document, root }
        );
      }
    };
    frame.addEventListener("load", connect, { once: true });
    if (frame.contentDocument?.readyState === "complete") connect();
  }, []);

  const scrollBoundary = useCallback(
    (nodeId) => {
      const boundary = boundariesRef.current.get(nodeId);
      if (!boundary || !mount) return false;
      const view = mount.document.defaultView;
      const scroll = () =>
        boundary.scrollIntoView?.({
          behavior: view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: nodeId === data.item.id ? "start" : "center",
          inline: "nearest"
        });
      if (view?.requestAnimationFrame) view.requestAnimationFrame(scroll);
      else scroll();
      return true;
    },
    [data.item.id, mount]
  );

  const focus = useCallback(
    (nodeId) =>
      focusPropsForNode(nodeId, {
        selectedId,
        onSelectNode,
        onBoundary(id, element) {
          if (element) {
            boundariesRef.current.set(id, element);
            const request = revealRequestRef.current;
            if (
              request?.recordId === data.item.id &&
              request.nodeId === id
            ) {
              scrollBoundary(id);
            }
          } else {
            boundariesRef.current.delete(id);
          }
        }
      }),
    [data.item.id, onSelectNode, scrollBoundary, selectedId]
  );

  useEffect(() => {
    if (!mount) return undefined;
    mount.document.documentElement.lang = data.config?.site?.locale || "en";
    const style = mount.document.createElement("style");
    style.setAttribute("data-minicms-preview-foundation", "");
    style.textContent = FRAME_STYLES;
    mount.document.head.append(style);
    return () => style.remove();
  }, [data.config?.site?.locale, mount]);

  useEffect(() => {
    if (
      revealRequest?.recordId === data.item.id &&
      revealRequest?.nodeId === selectedId
    ) {
      scrollBoundary(revealRequest.nodeId);
    }
  }, [data.item.id, revealRequest, scrollBoundary, selectedId]);

  return (
    <>
      <iframe
        ref={frameRef}
        className="preview__iframe"
        title={`${data.item.properties?.title || data.item.id} preview`}
        srcDoc={FRAME_SOURCE}
      />
      {mount
        ? createPortal(
            <PreviewErrorBoundary onError={onError}>
              <PreviewComponent data={data} focus={focus} />
            </PreviewErrorBoundary>,
            mount.root
          )
        : null}
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
          <p>Register the website preview from this page’s admin HTML.</p>
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
  PreviewComponent,
  record,
  selectedId,
  nodeTypes,
  collection,
  content,
  onSelectNode,
  revealRequest,
  siteName = "miniCMS"
}) {
  const [device, setDevice] = useState("desktop");
  const [resolved, setResolved] = useState({ source: null, data: null, error: "" });
  const [renderError, setRenderError] = useState("");
  const reportRenderError = useCallback(
    (error) => setRenderError(error?.message || String(error)),
    []
  );

  useEffect(() => {
    let active = true;
    setRenderError("");
    if (!PreviewComponent || !record || !collection || !content) {
      setResolved({ source: null, data: null, error: "" });
      return () => {
        active = false;
      };
    }
    content
      .get(collection.name, record)
      .then((data) => {
        if (!data) {
          throw new Error(
            `The content adapter could not resolve ${collection.name}/${record.id}.`
          );
        }
        if (active) setResolved({ source: record, data, error: "" });
      })
      .catch((error) => {
        if (active) {
          setResolved({
            source: record,
            data: null,
            error: error.message || String(error)
          });
        }
      });
    return () => {
      active = false;
    };
  }, [PreviewComponent, collection, content, record]);

  const activeResolution = resolved.source === record ? resolved : null;
  const error = renderError || activeResolution?.error;
  return (
    <div className="preview">
      <PreviewToolbar device={device} onDeviceChange={setDevice} />
      {PreviewComponent ? (
        <div className="preview__stage preview__stage--live">
          <div className={`preview__viewport preview__viewport--${device}`}>
            {error ? (
              <div className="preview__error" role="alert">
                <strong>The project preview could not be rendered.</strong>
                <span>{error}</span>
              </div>
            ) : activeResolution?.data ? (
              <ProjectPreviewFrame
                PreviewComponent={PreviewComponent}
                data={activeResolution.data}
                selectedId={selectedId}
                onSelectNode={onSelectNode}
                revealRequest={revealRequest}
                onError={reportRenderError}
              />
            ) : (
              <div className="preview__loading">Resolving preview data…</div>
            )}
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

export { Preview };
