import { ExternalLink, FileText, LoaderCircle } from "lucide-react";
import { useRef } from "react";
import "./Common.scss";
import { cx } from "../../model/editor.js";
import { externalHttpUrl } from "../../model/views.js";

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

function ChoiceTabs({ items, value, onChange, label, className }) {
  const buttonRefs = useRef([]);

  function moveSelection(event, currentIndex) {
    const enabledIndexes = items
      .map((item, index) => (item.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (!enabledIndexes.length) return;

    let nextIndex = -1;
    if (event.key === "Home") nextIndex = enabledIndexes[0];
    if (event.key === "End") nextIndex = enabledIndexes.at(-1);
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      const currentPosition = enabledIndexes.indexOf(currentIndex);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      nextIndex = enabledIndexes[
        (currentPosition + direction + enabledIndexes.length) %
          enabledIndexes.length
      ];
    }
    if (nextIndex < 0) return;

    event.preventDefault();
    onChange(items[nextIndex].value);
    requestAnimationFrame(() => buttonRefs.current[nextIndex]?.focus());
  }

  return (
    <div
      className={cx("choice-tabs", className)}
      role="tablist"
      aria-label={label}
      style={{ "--choice-tabs-count": items.length }}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx(selected && "is-active")}
            disabled={item.disabled}
            title={item.title}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.meta !== undefined && item.meta !== null && (
              <small className="choice-tabs__meta">{item.meta}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ExternalUrlLink({ value, label = "URL", className }) {
  const href = externalHttpUrl(value);
  if (!href) return null;
  const accessibleLabel = `Open ${label} in a new tab`;

  return (
    <a
      className={cx("external-url-link", className)}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
        }
      }}
    >
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
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


export {
  BrandMark,
  ChoiceTabs,
  EmptyState,
  ExternalUrlLink,
  MultiSelectionNotice,
  ResizeHandle,
  Spinner
};
