import { MoreHorizontal, Sparkles } from "lucide-react";
import "./Preview.scss";
import { getNode } from "../../model/editor.js";
import { BrandMark } from "../Common/Common.jsx";

function Preview({ record, selectedId, nodeTypes, siteName = "miniCMS" }) {
  const selected = getNode(record, selectedId);
  const type = selected ? nodeTypes[selected.type] : null;
  const title = record?.properties?.title || "Untitled";
  const selectedLabel =
    selected?.properties?.heading ||
    selected?.properties?.title ||
    selected?.properties?.alt ||
    type?.label;

  return (
    <div className="preview">
      <div className="preview__toolbar">
        <div className="device-toggle">
          <button type="button" className="is-active">
            Desktop
          </button>
          <button type="button">Tablet</button>
          <button type="button">Mobile</button>
        </div>
        <span className="preview__scale">Fit · 82%</span>
        <button type="button" className="icon-button" title="More preview options">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="preview__stage">
        <div className="preview__paper">
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
    </div>
  );
}

export { Preview };
