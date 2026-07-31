import { FileText, LoaderCircle } from "lucide-react";
import { useRef } from "react";
import "./Common.scss";
import { cx } from "../../model/editor.js";

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function Spinner({ small = false }) {
  return <LoaderCircle className={cx("spinner", small && "spinner--small")} />;
}

function ResizeHandle({ axis, label, onResize }) {
  const lastCoordinate = useRef(null);
  const orientation = axis === "x" ? "vertical" : "horizontal";

  function finishResize(event) {
    if (lastCoordinate.current === null) return;
    lastCoordinate.current = null;
    document.body.classList.remove(
      "is-resizing-columns",
      "is-resizing-rows"
    );
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className={cx(
        "layout-resizer",
        axis === "x"
          ? "layout-resizer--columns"
          : "layout-resizer--rows"
      )}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        lastCoordinate.current =
          axis === "x" ? event.clientX : event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add(
          axis === "x"
            ? "is-resizing-columns"
            : "is-resizing-rows"
        );
      }}
      onPointerMove={(event) => {
        if (lastCoordinate.current === null) return;
        const coordinate =
          axis === "x" ? event.clientX : event.clientY;
        const delta = coordinate - lastCoordinate.current;
        if (!delta) return;
        lastCoordinate.current = coordinate;
        onResize(delta);
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
      onKeyDown={(event) => {
        const backwardKey = axis === "x" ? "ArrowLeft" : "ArrowUp";
        const forwardKey = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (![backwardKey, forwardKey].includes(event.key)) return;
        event.preventDefault();
        onResize(event.key === backwardKey ? -10 : 10);
      }}
    />
  );
}

function EmptyState({ icon: Icon = FileText, title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon size={20} />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function MultiSelectionNotice({ count, label, icon: Icon }) {
  return (
    <div className="multi-selection-notice">
      <span className="multi-selection-notice__icon">
        <Icon size={20} />
      </span>
      <strong>
        {count} {label} selected
      </strong>
      <p>Select a single item to edit its properties.</p>
    </div>
  );
}


export { BrandMark, EmptyState, MultiSelectionNotice, ResizeHandle, Spinner };
