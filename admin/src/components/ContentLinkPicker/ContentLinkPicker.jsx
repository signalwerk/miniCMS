import { FileSymlink, Link2, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";
import { filteredInlineLinkOptions } from "../../model/markdown.js";
import { ChoiceTabs } from "../Common/Common.jsx";
import "./ContentLinkPicker.scss";

function LinkTypeTabs({ mode, contentEnabled, onChange }) {
  const items = [
    { value: "web", label: "Web link", icon: <Link2 size={14} /> }
  ];
  if (contentEnabled) {
    items.push({
      value: "content",
      label: "Content link",
      icon: <FileSymlink size={14} />
    });
  }
  return (
    <ChoiceTabs
      items={items}
      value={mode}
      label="Link type"
      onChange={onChange}
    />
  );
}

function ContentLinkPicker({
  collections,
  selectedCollectionName,
  items,
  loading,
  listError,
  onSelectCollection,
  onCancel,
  onChoose
}) {
  const [search, setSearch] = useState("");
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const titleId = useId();
  const collectionId = useId();
  const selectedCollection = collections.find(
    (collection) => collection.name === selectedCollectionName
  );
  const results = filteredInlineLinkOptions(items, search);
  const visibleItems = results.items;
  const singularLabel = selectedCollection?.label_singular || "item";

  useEffect(() => isolateFocusSurface(dialogRef.current), []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [selectedCollectionName]);

  useEffect(() => {
    function handleKeyDown(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;
      if (!dialogRef.current?.contains(event.target)) return;
      if (event.key === "Escape") {
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
  }, [onCancel]);

  return createPortal(
    <div
      ref={backdropRef}
      className="dialog-backdrop content-link-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="content-link-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
      >
        <header className="content-link-picker__header">
          <span className="content-link-picker__icon" aria-hidden="true">
            <FileSymlink size={17} />
          </span>
          <div>
            <h2 id={titleId}>Choose content link</h2>
            <p>Choose an item. The stored link remains stable when it moves.</p>
          </div>
          <button
            type="button"
            aria-label="Close content link picker"
            onClick={onCancel}
          >
            <X size={17} />
          </button>
        </header>

        <div className="content-link-picker__controls">
          {collections.length > 1 && (
            <div className="content-link-picker__collection">
              <label htmlFor={collectionId}>Collection</label>
              <select
                id={collectionId}
                value={selectedCollectionName}
                onChange={(event) => {
                  setSearch("");
                  onSelectCollection(event.target.value);
                }}
              >
                {collections.map((collection) => (
                  <option key={collection.name} value={collection.name}>
                    {collection.label || collection.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="content-link-picker__search">
            <Search size={15} aria-hidden="true" />
            <label className="visually-hidden" htmlFor={`${titleId}-search`}>
              Search {selectedCollection?.label || "content"}
            </label>
            <input
              ref={searchRef}
              id={`${titleId}-search`}
              type="search"
              value={search}
              placeholder={`Search ${String(selectedCollection?.label || "items").toLocaleLowerCase()}…`}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="content-link-picker__results">
          {listError ? (
            <p className="content-link-picker__message" role="alert">
              {listError}
            </p>
          ) : loading ? (
            <p className="content-link-picker__message" role="status">
              Loading…
            </p>
          ) : visibleItems.length ? (
            <>
              <ul aria-label={selectedCollection?.label || "Content"}>
                {visibleItems.map((item) => (
                  <li key={`${item.recordId}-${item.value}`}>
                    <button type="button" onClick={() => onChoose(item)}>
                      <strong>{item.label}</strong>
                      {item.label !== item.recordId && (
                        <span>{item.recordId}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {results.limited && (
                <p className="content-link-picker__limit" role="status">
                  Showing the first 100 of {results.total} matches. Refine your
                  search to narrow the list.
                </p>
              )}
            </>
          ) : (
            <p className="content-link-picker__message" role="status">
              No matching {singularLabel.toLocaleLowerCase()}.
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export { ContentLinkPicker, LinkTypeTabs };
