import {
  Crosshair,
  Image,
  Maximize2,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  compactImageValue,
  createImageAnnotationId,
  ensureImageAnnotationIds,
  imageCoordinateSize,
  imageInfoCoordinateSize,
  normalizeImageValue
} from "../../model/image.js";
import {
  boundedImageRegion,
  imageRegionRotationFromPoint,
  imageRotationStep,
  normalizeImageRotation,
  resizedImageRegion,
  steppedImageRotation
} from "../../model/imageGeometry.js";
import {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept
} from "../../../../core/media.js";
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

function boundedPoint(point, imageSize) {
  if (!imageSize) return point;
  return {
    ...point,
    x: clamp(Math.round(point.x), 0, Math.max(0, imageSize.width - 1)),
    y: clamp(Math.round(point.y), 0, Math.max(0, imageSize.height - 1))
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

function AnnotatedImageField({ id, field, value, collectionName, onChange }) {
  const api = useAdapter();
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const editorTriggerRef = useRef(null);
  const interactionRef = useRef(null);
  const [image, setImage] = useState(() => normalizeImageValue(value));
  const imageRef = useRef(image);
  const [naturalImageSize, setNaturalImageSize] = useState(null);
  const [sourceInfo, setSourceInfo] = useState({
    source: "",
    status: "idle",
    value: null
  });
  const [selection, setSelection] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const serializedValue = JSON.stringify(value ?? "");
  const rotationInstructionsId = `${id}-rotation-instructions`;
  const storedImageSize = imageCoordinateSize(image);
  const needsServiceInfo = Boolean(
    image.src && !storedImageSize && typeof api.getImageInfo === "function"
  );
  const activeSourceInfo =
    sourceInfo.source === image.src ? sourceInfo : null;
  const mayUseNaturalSize =
    !needsServiceInfo || activeSourceInfo?.status === "bypass";
  const imageSize = imageCoordinateSize(
    image,
    mayUseNaturalSize ? naturalImageSize?.width : null,
    mayUseNaturalSize ? naturalImageSize?.height : null,
    activeSourceInfo?.status === "ready" ? activeSourceInfo.value : null
  );
  const sourceInfoError =
    activeSourceInfo?.status === "error"
      ? "The original image dimensions could not be read."
      : "";
  const displayedError = error || sourceInfoError;

  useEffect(() => {
    const nextImage = normalizeImageValue(value);
    imageRef.current = nextImage;
    setImage(nextImage);
  }, [serializedValue]);

  useEffect(() => {
    setNaturalImageSize(null);
    setSelection(null);
    interactionRef.current = null;
  }, [image.src, image.width, image.height]);

  useEffect(() => {
    let active = true;
    if (!needsServiceInfo) {
      setSourceInfo({ source: image.src, status: "idle", value: null });
      return () => {
        active = false;
      };
    }

    setSourceInfo({ source: image.src, status: "loading", value: null });
    api
      .getImageInfo(image.src)
      .then((information) => {
        if (!active) return;
        if (information === null) {
          setSourceInfo({
            source: image.src,
            status: "bypass",
            value: null
          });
          return;
        }
        if (!imageInfoCoordinateSize(information)) {
          throw new Error("The image information contains no dimensions.");
        }
        setSourceInfo({
          source: image.src,
          status: "ready",
          value: information
        });
      })
      .catch(() => {
        if (active) {
          setSourceInfo({
            source: image.src,
            status: "error",
            value: null
          });
        }
      });
    return () => {
      active = false;
    };
  }, [api, image.src, needsServiceInfo]);

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
    const current = ensureImageAnnotationIds(imageRef.current);
    const next = {
      ...current,
      extra: { ...current.extra },
      regions: current.regions.map((region) => ({ ...region })),
      points: current.points.map((point) => ({ ...point }))
    };
    if (imageSize) {
      next.width = imageSize.width;
      next.height = imageSize.height;
    }
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
      setError(mediaAcceptErrorMessage(file, acceptedTypes));
      event.target.value = "";
      return;
    }
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadMedia(file, collectionName);
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
      next.regions[index] = boundedImageRegion(change(current), imageSize);
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
        id: createImageAnnotationId(),
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
        id: createImageAnnotationId(),
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

  function pointerPosition(event, clampToImage = true) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || !imageSize || !bounds.width || !bounds.height) return null;
    const x = ((event.clientX - bounds.left) / bounds.width) * imageSize.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * imageSize.height;
    return clampToImage
      ? {
          x: clamp(Math.round(x), 0, imageSize.width),
          y: clamp(Math.round(y), 0, imageSize.height)
        }
      : { x, y };
  }

  function beginInteraction(event, interaction) {
    const start = pointerPosition(event, !interaction.rotate);
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
    const position = pointerPosition(event, !interaction?.rotate);
    if (!interaction || !position || !imageSize) return;
    const deltaX = position.x - interaction.start.x;
    const deltaY = position.y - interaction.start.y;

    if (interaction.kind === "region" && interaction.rotate) {
      updateRegion(interaction.index, (current) => ({
        ...interaction.original,
        id: current.id,
        rotation: imageRegionRotationFromPoint(
          interaction.original,
          position,
          imageRotationStep(event),
          interaction.start
        )
      }));
    } else if (interaction.kind === "region" && interaction.handle) {
      updateRegion(interaction.index, (current) => ({
        ...resizedImageRegion(
          interaction.original,
          interaction.handle,
          deltaX,
          deltaY,
          imageSize,
          MIN_REGION_SIZE
        ),
        id: current.id
      }));
    } else if (interaction.kind === "region") {
      updateRegion(interaction.index, (current) => {
        const original = boundedImageRegion(interaction.original, imageSize);
        return {
          ...original,
          x: Math.round(original.x + deltaX),
          y: Math.round(original.y + deltaY),
          id: current.id
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
    event.preventDefault();
    updateRegion(index, (region) =>
      resizedImageRegion(
        region,
        handle,
        delta.x,
        delta.y,
        imageSize,
        MIN_REGION_SIZE
      )
    );
  }

  function rotateRegionByKeyboard(event, index) {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (!direction) return;
    event.preventDefault();
    updateRegion(index, (region) => ({
      ...region,
      rotation: steppedImageRotation(
        region.rotation,
        direction,
        imageRotationStep(event)
      )
    }));
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
        src={api.resolveImageUrl(image.src, {
          width: 2048,
          height: 2048,
          fit: "inside"
        })}
        alt=""
        draggable={false}
        onLoad={(event) => {
          setError("");
          setNaturalImageSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          });
        }}
        onError={() => {
          setNaturalImageSize(null);
          setError("The image could not be loaded.");
        }}
      />
      {imageSize && image.regions.map((region, index) => {
        const bounded = boundedImageRegion(region, imageSize);
        const rotation = normalizeImageRotation(bounded.rotation);
        const selected =
          selection?.kind === "region" && selection.index === index;
        return (
          <div
            className={cx("image-region", selected && "is-selected")}
            key={region.id || `region-${index}`}
            style={{
              "--x": `${(bounded.x / imageSize.width) * 100}%`,
              "--y": `${(bounded.y / imageSize.height) * 100}%`,
              "--width": `${(bounded.width / imageSize.width) * 100}%`,
              "--height": `${(bounded.height / imageSize.height) * 100}%`,
              "--rotation": `${rotation}deg`
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
            {selected && (
              <button
                type="button"
                className="image-region__rotate"
                aria-label={`Rotate ${region.label}, ${rotation} degrees`}
                aria-describedby={rotationInstructionsId}
                title={`Rotate ${region.label} (${rotation}°; Option/Alt: 0.1°, Shift: 45° snap)`}
                onPointerDown={(event) =>
                  beginInteraction(event, {
                    kind: "region",
                    index,
                    rotate: true,
                    original: bounded
                  })
                }
                onKeyDown={(event) => rotateRegionByKeyboard(event, index)}
              >
                <RotateCw size={12} aria-hidden="true" />
              </button>
            )}
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
            key={point.id || `point-${index}`}
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
              key={region.id || `region-row-${index}`}
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
                {region.x}, {region.y} · {region.width} × {region.height} ·{" "}
                {normalizeImageRotation(region.rotation)}°
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
              key={point.id || `point-row-${index}`}
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
              src={api.resolveImageUrl(image.src, {
                width: 640,
                height: 480,
                fit: "inside"
              })}
              alt=""
              onLoad={(event) => {
                setError("");
                setNaturalImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight
                });
              }}
              onError={() => {
                setNaturalImageSize(null);
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
      {displayedError && (
        <small className="field-error">{displayedError}</small>
      )}

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
            <p id={rotationInstructionsId} className="visually-hidden">
              Region rotation uses one-degree steps. Hold Option or Alt for
              0.1-degree precision, or Shift to snap to 45-degree steps.
            </p>
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
