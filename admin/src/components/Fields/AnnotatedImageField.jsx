import {
  Crosshair,
  Image,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  compactImageValue,
  normalizeImageValue
} from "../../model/image.js";
import {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  mediaFileMatchesAccept
} from "../../../shared/media.js";
import { cx } from "../../model/editor.js";
import { Spinner } from "../Common/Common.jsx";
import "./AnnotatedImageField.scss";

const REGION_HANDLES = [
  ["nw", "top left"],
  ["n", "top"],
  ["ne", "top right"],
  ["e", "right"],
  ["se", "bottom right"],
  ["s", "bottom"],
  ["sw", "bottom left"],
  ["w", "left"]
];
const MIN_REGION_SIZE = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function nextLabel(items, prefix) {
  const labels = new Set(items.map((item) => item.label));
  let index = items.length + 1;
  while (labels.has(`${prefix} ${index}`)) index += 1;
  return `${prefix} ${index}`;
}

function boundedRegion(region, imageSize) {
  if (!imageSize) return region;
  const width = clamp(region.width, 1, imageSize.width);
  const height = clamp(region.height, 1, imageSize.height);
  return {
    ...region,
    width,
    height,
    x: clamp(region.x, 0, imageSize.width - width),
    y: clamp(region.y, 0, imageSize.height - height)
  };
}

function boundedPoint(point, imageSize) {
  if (!imageSize) return point;
  return {
    ...point,
    x: clamp(Math.round(point.x), 0, Math.max(0, imageSize.width - 1)),
    y: clamp(Math.round(point.y), 0, Math.max(0, imageSize.height - 1))
  };
}

function resizedRegion(region, handle, deltaX, deltaY, imageSize) {
  const bounded = boundedRegion(region, imageSize);
  let left = bounded.x;
  let top = bounded.y;
  let right = bounded.x + bounded.width;
  let bottom = bounded.y + bounded.height;
  const minimumWidth = Math.min(MIN_REGION_SIZE, imageSize.width);
  const minimumHeight = Math.min(MIN_REGION_SIZE, imageSize.height);

  if (handle.includes("w")) {
    left = clamp(left + deltaX, 0, right - minimumWidth);
  }
  if (handle.includes("e")) {
    right = clamp(right + deltaX, left + minimumWidth, imageSize.width);
  }
  if (handle.includes("n")) {
    top = clamp(top + deltaY, 0, bottom - minimumHeight);
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + deltaY, top + minimumHeight, imageSize.height);
  }

  return {
    ...bounded,
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  };
}

function arrowDelta(event) {
  const step = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") return { x: -step, y: 0 };
  if (event.key === "ArrowRight") return { x: step, y: 0 };
  if (event.key === "ArrowUp") return { x: 0, y: -step };
  if (event.key === "ArrowDown") return { x: 0, y: step };
  return null;
}

function AnnotatedImageField({ id, field, value, onChange }) {
  const api = useAdapter();
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const editorTriggerRef = useRef(null);
  const interactionRef = useRef(null);
  const [image, setImage] = useState(() => normalizeImageValue(value));
  const imageRef = useRef(image);
  const [imageSize, setImageSize] = useState(null);
  const [selection, setSelection] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const serializedValue = JSON.stringify(value ?? "");

  useEffect(() => {
    const nextImage = normalizeImageValue(value);
    imageRef.current = nextImage;
    setImage(nextImage);
  }, [serializedValue]);

  useEffect(() => {
    setImageSize(null);
    setSelection(null);
    interactionRef.current = null;
  }, [image.src]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    closeButtonRef.current?.focus();
    function handleEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditorOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(
          "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      editorTriggerRef.current?.focus();
    };
  }, [editorOpen]);

  function commit(change) {
    const current = imageRef.current;
    const next = {
      ...current,
      extra: { ...current.extra },
      regions: current.regions.map((region) => ({ ...region })),
      points: current.points.map((point) => ({ ...point }))
    };
    change(next);
    imageRef.current = next;
    setImage(next);
    onChange(compactImageValue(next));
  }

  function replaceValue(nextValue) {
    const nextImage = normalizeImageValue(nextValue);
    imageRef.current = nextImage;
    setImage(nextImage);
    setSelection(null);
    interactionRef.current = null;
    onChange(nextValue);
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const acceptedTypes = acceptTokens(field.accept);
    if (!mediaFileMatchesAccept(file, acceptedTypes)) {
      setError(`Choose a file matching ${acceptedTypes.join(", ")}.`);
      event.target.value = "";
      return;
    }
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadMedia(file);
      replaceValue(result.path);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function updateRegion(index, change) {
    commit((next) => {
      const current = next.regions[index];
      if (!current) return;
      next.regions[index] = boundedRegion(change(current), imageSize);
    });
  }

  function updatePoint(index, change) {
    commit((next) => {
      const current = next.points[index];
      if (!current) return;
      const changed = change(current);
      next.points[index] = imageSize
        ? {
            ...changed,
            x: clamp(Math.round(changed.x), 0, Math.max(0, imageSize.width - 1)),
            y: clamp(Math.round(changed.y), 0, Math.max(0, imageSize.height - 1))
          }
        : changed;
    });
  }

  function addRegion() {
    if (!imageSize) return;
    const width = Math.min(
      imageSize.width,
      Math.max(MIN_REGION_SIZE, Math.round(imageSize.width * 0.5))
    );
    const height = Math.min(
      imageSize.height,
      Math.max(MIN_REGION_SIZE, Math.round(imageSize.height * 0.5))
    );
    const index = image.regions.length;
    commit((next) => {
      next.regions.push({
        label: nextLabel(next.regions, "Region"),
        x: Math.round((imageSize.width - width) / 2),
        y: Math.round((imageSize.height - height) / 2),
        width,
        height
      });
    });
    setSelection({ kind: "region", index });
  }

  function addPoint() {
    if (!imageSize) return;
    const index = image.points.length;
    commit((next) => {
      next.points.push({
        label: nextLabel(next.points, "Point"),
        x: Math.floor((imageSize.width - 1) / 2),
        y: Math.floor((imageSize.height - 1) / 2)
      });
    });
    setSelection({ kind: "point", index });
  }

  function removeAnnotation(kind, index) {
    commit((next) => {
      next[kind === "region" ? "regions" : "points"].splice(index, 1);
    });
    setSelection(null);
  }

  function pointerPosition(event) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || !imageSize || !bounds.width || !bounds.height) return null;
    return {
      x: clamp(
        Math.round(
          ((event.clientX - bounds.left) / bounds.width) * imageSize.width
        ),
        0,
        imageSize.width
      ),
      y: clamp(
        Math.round(
          ((event.clientY - bounds.top) / bounds.height) * imageSize.height
        ),
        0,
        imageSize.height
      )
    };
  }

  function beginInteraction(event, interaction) {
    const start = pointerPosition(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      ...interaction,
      pointerId: event.pointerId,
      start,
      captureTarget: event.currentTarget
    };
    setSelection({ kind: interaction.kind, index: interaction.index });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event) {
    const interaction = interactionRef.current;
    const position = pointerPosition(event);
    if (!interaction || !position || !imageSize) return;
    const deltaX = position.x - interaction.start.x;
    const deltaY = position.y - interaction.start.y;

    if (interaction.kind === "region" && interaction.handle) {
      updateRegion(interaction.index, () =>
        resizedRegion(
          interaction.original,
          interaction.handle,
          deltaX,
          deltaY,
          imageSize
        )
      );
    } else if (interaction.kind === "region") {
      updateRegion(interaction.index, () => {
        const original = boundedRegion(interaction.original, imageSize);
        return {
          ...original,
          x: clamp(
            Math.round(original.x + deltaX),
            0,
            imageSize.width - original.width
          ),
          y: clamp(
            Math.round(original.y + deltaY),
            0,
            imageSize.height - original.height
          )
        };
      });
    } else {
      updatePoint(interaction.index, (original) => ({
        ...original,
        x: position.x,
        y: position.y
      }));
    }
  }

  function endPointer(event) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    if (interaction.captureTarget?.hasPointerCapture(event.pointerId)) {
      interaction.captureTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveRegionByKeyboard(event, index) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeAnnotation("region", index);
      return;
    }
    const delta = arrowDelta(event);
    if (!delta || !imageSize) return;
    event.preventDefault();
    updateRegion(index, (region) => ({
      ...region,
      x: region.x + delta.x,
      y: region.y + delta.y
    }));
  }

  function resizeRegionByKeyboard(event, index, handle) {
    const delta = arrowDelta(event);
    if (!delta || !imageSize) return;
    const horizontal = handle.includes("w") || handle.includes("e");
    const vertical = handle.includes("n") || handle.includes("s");
    if ((!horizontal && delta.x) || (!vertical && delta.y)) return;
    event.preventDefault();
    updateRegion(index, (region) =>
      resizedRegion(region, handle, delta.x, delta.y, imageSize)
    );
  }

  function movePointByKeyboard(event, index) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeAnnotation("point", index);
      return;
    }
    const delta = arrowDelta(event);
    if (!delta || !imageSize) return;
    event.preventDefault();
    updatePoint(index, (point) => ({
      ...point,
      x: point.x + delta.x,
      y: point.y + delta.y
    }));
  }

  const annotationCanvas = (
    <div
      ref={canvasRef}
      className="image-field__canvas"
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <img
        src={api.resolveMediaUrl(image.src)}
        alt=""
        draggable={false}
        onLoad={(event) => {
          setError("");
          setImageSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          });
        }}
        onError={() => {
          setImageSize(null);
          setError("The image could not be loaded.");
        }}
      />
      {imageSize && image.regions.map((region, index) => {
        const bounded = boundedRegion(region, imageSize);
        const selected =
          selection?.kind === "region" && selection.index === index;
        return (
          <div
            className={cx("image-region", selected && "is-selected")}
            key={`region-${index}`}
            style={{
              "--x": `${(bounded.x / imageSize.width) * 100}%`,
              "--y": `${(bounded.y / imageSize.height) * 100}%`,
              "--width": `${(bounded.width / imageSize.width) * 100}%`,
              "--height": `${(bounded.height / imageSize.height) * 100}%`
            }}
          >
            <button
              type="button"
              className="image-region__move"
              aria-label={`Move ${region.label}`}
              title={region.label}
              onFocus={() => setSelection({ kind: "region", index })}
              onPointerDown={(event) =>
                beginInteraction(event, {
                  kind: "region",
                  index,
                  original: bounded
                })
              }
              onKeyDown={(event) => moveRegionByKeyboard(event, index)}
            />
            <span className="image-region__label">{region.label}</span>
            {selected && REGION_HANDLES.map(([handle, handleLabel]) => (
              <button
                type="button"
                className={`image-region__handle image-region__handle--${handle}`}
                aria-label={`Resize ${region.label} from ${handleLabel}`}
                key={handle}
                onPointerDown={(event) =>
                  beginInteraction(event, {
                    kind: "region",
                    index,
                    handle,
                    original: bounded
                  })
                }
                onKeyDown={(event) =>
                  resizeRegionByKeyboard(event, index, handle)
                }
              />
            ))}
          </div>
        );
      })}
      {imageSize && image.points.map((point, index) => {
        const bounded = boundedPoint(point, imageSize);
        const selected =
          selection?.kind === "point" && selection.index === index;
        return (
          <button
            type="button"
            className={cx("image-point", selected && "is-selected")}
            key={`point-${index}`}
            style={{
              "--x": `${(bounded.x / imageSize.width) * 100}%`,
              "--y": `${(bounded.y / imageSize.height) * 100}%`
            }}
            aria-label={`Move ${point.label}`}
            title={`${point.label}: ${bounded.x}, ${bounded.y}`}
            onFocus={() => setSelection({ kind: "point", index })}
            onPointerDown={(event) =>
              beginInteraction(event, {
                kind: "point",
                index,
                original: bounded
              })
            }
            onKeyDown={(event) => movePointByKeyboard(event, index)}
          >
            <Crosshair size={14} aria-hidden="true" />
            <span>{index + 1}</span>
          </button>
        );
      })}
    </div>
  );

  const annotationLists = (
    <div className="image-annotations">
      {image.regions.length > 0 && (
        <section>
          <div className="image-annotations__heading">
            <Maximize2 size={13} aria-hidden="true" />
            <strong>Regions</strong>
            <span>{image.regions.length}</span>
          </div>
          {image.regions.map((region, index) => (
            <div
              className={cx(
                "image-annotation-row",
                selection?.kind === "region" &&
                  selection.index === index &&
                  "is-selected"
              )}
              key={`region-row-${index}`}
              onPointerDown={() => setSelection({ kind: "region", index })}
            >
              <input
                value={region.label}
                aria-label={`Region ${index + 1} label`}
                onChange={(event) =>
                  updateRegion(index, (current) => ({
                    ...current,
                    label: event.target.value
                  }))
                }
              />
              <code>
                {region.x}, {region.y} · {region.width} × {region.height}
              </code>
              <button
                type="button"
                aria-label={`Delete ${region.label}`}
                onClick={() => removeAnnotation("region", index)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      )}
      {image.points.length > 0 && (
        <section>
          <div className="image-annotations__heading">
            <Crosshair size={13} aria-hidden="true" />
            <strong>Points</strong>
            <span>{image.points.length}</span>
          </div>
          {image.points.map((point, index) => (
            <div
              className={cx(
                "image-annotation-row",
                selection?.kind === "point" &&
                  selection.index === index &&
                  "is-selected"
              )}
              key={`point-row-${index}`}
              onPointerDown={() => setSelection({ kind: "point", index })}
            >
              <input
                value={point.label}
                aria-label={`Point ${index + 1} label`}
                onChange={(event) =>
                  updatePoint(index, (current) => ({
                    ...current,
                    label: event.target.value
                  }))
                }
              />
              <code>{point.x}, {point.y}</code>
              <button
                type="button"
                aria-label={`Delete ${point.label}`}
                onClick={() => removeAnnotation("point", index)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      )}
      {!image.regions.length && !image.points.length && (
        <div className="image-annotations__empty">
          <Crosshair size={18} aria-hidden="true" />
          <span>No regions or points</span>
        </div>
      )}
    </div>
  );

  const annotationCount = image.regions.length + image.points.length;
  const dialogTitleId = `${id}-annotation-dialog-title`;

  return (
    <div className="image-field">
      <div className="image-field__stage">
        {image.src ? (
          <button
            type="button"
            className="image-field__preview-button"
            aria-label="Edit image regions and points"
            onClick={() => setEditorOpen(true)}
          >
            <img
              className="image-field__preview"
              src={api.resolveMediaUrl(image.src)}
              alt=""
              onLoad={(event) => {
                setError("");
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight
                });
              }}
              onError={() => {
                setImageSize(null);
                setError("The image could not be loaded.");
              }}
            />
            {annotationCount > 0 && (
              <span className="image-field__annotation-count">
                {annotationCount}
              </span>
            )}
          </button>
        ) : (
          <div className="image-field__empty">
            <Image size={20} aria-hidden="true" />
            <span>No image uploaded</span>
          </div>
        )}
      </div>

      <div className="image-field__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner small /> : <Upload size={14} />}
          {image.src ? "Replace" : "Upload image"}
        </button>
        {image.src && (
          <button
            ref={editorTriggerRef}
            type="button"
            className="button button--secondary image-field__edit"
            onClick={() => setEditorOpen(true)}
          >
            <Maximize2 size={14} />
            Regions &amp; points
            {annotationCount > 0 && <span>{annotationCount}</span>}
          </button>
        )}
        {image.src && (
          <button
            type="button"
            className="button button--secondary"
            disabled={uploading}
            onClick={() => replaceValue("")}
          >
            Clear
          </button>
        )}
      </div>

      {image.src && <code className="image-field__path">{image.src}</code>}
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden"
        type="file"
        accept={acceptTokens(field.accept || DEFAULT_IMAGE_ACCEPT).join(",")}
        onChange={upload}
      />
      {error && <small className="field-error">{error}</small>}

      {editorOpen && createPortal(
        <div
          className="dialog-backdrop image-editor-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setEditorOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="dialog image-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <div className="dialog__top">
              <span className="dialog__icon">
                <Maximize2 size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 id={dialogTitleId}>Regions &amp; points</h2>
                <p>{imageSize ? `${imageSize.width} × ${imageSize.height} px` : image.src}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close image annotations"
                onClick={() => setEditorOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="image-editor-dialog__toolbar">
              <button
                type="button"
                className="button button--secondary"
                disabled={!imageSize}
                onClick={addRegion}
              >
                <Maximize2 size={14} />
                Add region
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={!imageSize}
                onClick={addPoint}
              >
                <Plus size={14} />
                Add point
              </button>
            </div>

            <div className="image-editor-dialog__body">
              <div className="image-editor-dialog__stage">
                {annotationCanvas}
              </div>
              <aside className="image-editor-dialog__annotations">
                {annotationLists}
              </aside>
            </div>

            <div className="dialog__footer">
              <button
                type="button"
                className="button"
                onClick={() => setEditorOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export { AnnotatedImageField };
