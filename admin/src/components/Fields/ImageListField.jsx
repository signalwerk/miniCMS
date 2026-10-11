import { primaryImageAsset } from "../../../../core/media.js";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Star,
  Pencil,
  X,
} from "lucide-react";
import { createId } from "../../../../core/id.js";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { imageRenderingOptions } from "../../model/image.js";
import { AnnotatedImageField } from "./AnnotatedImageField.jsx";
import { focusableElements, isolateFocusSurface } from "../../model/focus.js";
import "./ImageListField.scss";

function ImageEntryDialog({
  id,
  field,
  image,
  collectionName,
  onCancel,
  onApply,
}) {
  const [draft, setDraft] = useState(() => structuredClone(image ?? ""));
  const titleId = useId();
  const dialogRef = useRef(null),
    backdropRef = useRef(null);
  const closeRef = useRef(null),
    cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const restoreIsolation = isolateFocusSurface(dialogRef.current);
    closeRef.current?.focus();
    function handleKeyboard(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (
        event.defaultPrevented ||
        backdrops[backdrops.length - 1] !== backdropRef.current
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
      } else if (event.key === "Tab") {
        const controls = focusableElements(dialogRef.current);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyboard);
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
      restoreIsolation();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  return createPortal(
    <div ref={backdropRef} className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="dialog image-list-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__top">
          <span className="dialog__icon">
            <Pencil size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId}>{image ? "Edit image" : "Add image"}</h2>
            <p>{draft?.filename || "Choose an image to add to the list."}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close image editor"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="image-list-editor__body">
          <label htmlFor={`${id}-name`}>
            Image name
            <input
              id={`${id}-name`}
              value={draft?.name ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <AnnotatedImageField
            id={`${id}-asset`}
            field={{ ...field, multiple: undefined }}
            value={draft?.hash ? draft : ""}
            collectionName={collectionName}
            onChange={(asset) =>
              setDraft((current) =>
                asset?.hash
                  ? {
                      ...asset,
                      ...(current?.name !== undefined
                        ? { name: current.name }
                        : {}),
                      ...(image
                        ? {
                            id: image.id,
                            ...(image.primary ? { primary: true } : {}),
                          }
                        : {}),
                    }
                  : "",
              )
            }
          />
        </div>
        <div className="dialog__footer">
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!image && !draft?.hash}
            onClick={() => onApply(draft)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ImageListField({ id, field, value, collectionName, onChange }) {
  const adapter = useAdapter();
  const images = Array.isArray(value) ? value : [];
  const [editing, setEditing] = useState(null);
  const primary = primaryImageAsset(images);
  function selectPrimary(entries, primaryId) {
    return entries.map((entry) => {
      const { primary: _primary, ...asset } = entry;
      return entry.id === primaryId ? { ...asset, primary: true } : asset;
    });
  }
  const readonly = field.readonly === true;
  function move(from, to) {
    if (readonly || from === to || to < 0 || to >= images.length) return;
    const next = selectPrimary(images, primary?.id);
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  }
  function remove(image) {
    const remaining = images.filter((entry) => entry.id !== image.id);
    onChange(
      selectPrimary(
        remaining,
        image.id === primary?.id ? remaining[0]?.id : primary?.id,
      ),
    );
  }
  return (
    <div className="image-list-field">
      <ol className="image-list-field__items">
        {images.map((image, index) => (
          <li
            key={image.id}
            draggable={!readonly}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/x-minicms-image",
                image.id,
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (
                !readonly &&
                Array.from(event.dataTransfer.types).includes(
                  "application/x-minicms-image",
                )
              )
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = images.findIndex(
                (entry) =>
                  entry.id ===
                  event.dataTransfer.getData("application/x-minicms-image"),
              );
              if (from >= 0) move(from, index);
            }}
          >
            <div
              className="image-list-field__select"
              data-primary={image.id === primary?.id}
            >
              <img
                alt=""
                draggable={false}
                src={adapter.resolveImageUrl(image, {
                  collection: collectionName,
                  mediaFolder: field.media_folder,
                  width: 120,
                  height: 120,
                  fit: "inside",
                  ...imageRenderingOptions(field),
                })}
              />
              <span>
                <strong>{image.name || image.filename}</strong>
                <small>
                  {image.id === primary?.id
                    ? "Primary image"
                    : `Image ${index + 1}`}
                </small>
              </span>
            </div>
            {!readonly && (
              <div className="image-list-field__actions">
                <button
                  type="button"
                  className="button button--secondary button--icon"
                  aria-label={`Edit image ${index + 1}`}
                  onClick={() => setEditing({ image })}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className="button button--secondary button--icon"
                  aria-pressed={image.id === primary?.id}
                  aria-label={`Use image ${index + 1} as primary`}
                  onClick={() => onChange(selectPrimary(images, image.id))}
                >
                  <Star
                    size={16}
                    fill={image.id === primary?.id ? "currentColor" : "none"}
                  />
                </button>
                <button
                  type="button"
                  className="button button--secondary button--icon"
                  disabled={index === 0}
                  aria-label={`Move image ${index + 1} up`}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  className="button button--secondary button--icon"
                  disabled={index === images.length - 1}
                  aria-label={`Move image ${index + 1} down`}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  className="button button--secondary button--icon"
                  aria-label={`Remove image ${index + 1}`}
                  onClick={() => remove(image)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!readonly && (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setEditing({ image: null })}
        >
          <Plus size={16} />
          Add image
        </button>
      )}
      {editing && !readonly && (
        <ImageEntryDialog
          id={`${id}-entry`}
          field={field}
          image={editing.image}
          collectionName={collectionName}
          onCancel={() => setEditing(null)}
          onApply={(image) => {
            if (!image?.hash) {
              if (editing.image) remove(editing.image);
            } else if (editing.image)
              onChange(
                images.map((entry) =>
                  entry.id === editing.image.id
                    ? { ...image, id: entry.id }
                    : entry,
                ),
              );
            else {
              const entry = {
                ...image,
                id: createId(new Set(images.map((item) => item.id))),
              };
              onChange(
                selectPrimary([...images, entry], primary?.id ?? entry.id),
              );
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
