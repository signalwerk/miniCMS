import { CircleAlert, Crosshair, Scan, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { cx } from "../../model/editor.js";
import { imageSource } from "../../model/image.js";
import {
  boundedImageRegion,
  imageCropViewport,
  imagePointInRegionCoordinates,
  imagePointOutsideRegion,
  normalizeImageRotation
} from "../../model/imageGeometry.js";
import {
  normalizeReferenceValue,
  referenceItemValue,
  referenceSelectionOptions
} from "../../model/reference.js";
import "./ReferenceSelectionsDialog.scss";

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedRegion(region, imageSize) {
  if (!region || !imageSize) return null;
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return boundedImageRegion(
    { ...region, x, y, width, height },
    imageSize
  );
}

function percentage(value) {
  return `${Number(value.toFixed(5))}%`;
}

function selectionIcon(kind) {
  return kind === "image_point" ? Crosshair : Scan;
}

function cropImageStyle(imageSize, crop) {
  const viewport = imageCropViewport(imageSize, crop);
  if (!viewport) return undefined;
  return {
    width: percentage(viewport.sourceWidth),
    left: percentage(viewport.sourceLeft),
    top: percentage(viewport.sourceTop),
    transformOrigin: `${percentage(viewport.sourceOriginX)} ${percentage(viewport.sourceOriginY)}`,
    transform: `rotate(${viewport.sourceRotation}deg)`
  };
}

function firstSelectedAnnotation(definitions, optionsByName, draft, kind) {
  for (const definition of definitions) {
    if (definition.kind !== kind) continue;
    const selectedValue = draft[definition.name];
    if (!selectedValue) continue;
    const selected = optionsByName[definition.name]?.find(
      (option) => option.value === selectedValue
    );
    if (selected) return selected.item;
  }
  return null;
}

function ReferenceSelectionsDialog({
  collection,
  definitions,
  item,
  value,
  onCancel,
  onApply
}) {
  const adapter = useAdapter();
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const normalized = useMemo(() => normalizeReferenceValue(value), [value]);
  const [draft, setDraft] = useState(() => ({ ...normalized.selections }));
  const [naturalSize, setNaturalSize] = useState(null);
  const referenceView = collection.views?.reference ?? {};
  const sourceField =
    definitions.find((definition) => definition.options?.field)?.options.field ||
    referenceView.image;
  const sourceValue = referenceItemValue(item, sourceField, collection);
  const source = adapter.resolveMediaUrl(imageSource(sourceValue));
  const storedWidth = positiveNumber(sourceValue?.width);
  const storedHeight = positiveNumber(sourceValue?.height);
  const imageSize =
    storedWidth && storedHeight
      ? { width: storedWidth, height: storedHeight }
      : naturalSize;
  const optionsByName = Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      referenceSelectionOptions(item, definition, collection)
    ])
  );
  const selectedCrop = firstSelectedAnnotation(
    definitions,
    optionsByName,
    draft,
    "image_region"
  );
  const selectedFocus = firstSelectedAnnotation(
    definitions,
    optionsByName,
    draft,
    "image_point"
  );
  const selectedCropBounds = boundedRegion(selectedCrop, imageSize);
  const selectedFocusCoordinates =
    selectedCropBounds && selectedFocus
      ? imagePointInRegionCoordinates(selectedFocus, selectedCropBounds)
      : null;
  const selectedFocusPosition = selectedFocusCoordinates
    ? {
        x:
          (clamp(selectedFocusCoordinates.x, 0, selectedCropBounds.width) /
            selectedCropBounds.width) *
          100,
        y:
          (clamp(selectedFocusCoordinates.y, 0, selectedCropBounds.height) /
            selectedCropBounds.height) *
          100
      }
    : null;
  const focusOutsideCrop = imagePointOutsideRegion(
    selectedFocus,
    selectedCropBounds
  );

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(
          "button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])"
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
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onCancel]);

  function setSelection(name, selectedValue) {
    setDraft((current) => {
      const next = { ...current };
      if (selectedValue) next[name] = selectedValue;
      else delete next[name];
      return next;
    });
  }

  function apply() {
    const selections = {};
    for (const definition of definitions) {
      const selectedValue = draft[definition.name];
      if (
        selectedValue &&
        (
          optionsByName[definition.name].some(
            (option) => option.value === selectedValue
          ) ||
          normalized.selections[definition.name] === selectedValue
        )
      ) {
        selections[definition.name] = selectedValue;
      }
    }
    onApply(selections);
  }

  const content = (
    <div
      className="dialog-backdrop reference-selections-dialog-backdrop"
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="dialog reference-selections-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__top">
          <span className="dialog__icon">
            <Scan size={18} />
          </span>
          <div>
            <h2 id={titleId}>Image selections</h2>
            <p>Choose annotations defined on the referenced image.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close image selections"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog__body reference-selections-dialog__body">
          <div className="reference-selections-dialog__preview">
            {source ? (
              <div className="reference-selections-dialog__preview-stack">
                <section className="reference-selections-dialog__preview-section">
                  <strong>Source image</strong>
                  <div
                    className="reference-selections-canvas"
                    style={
                      imageSize
                        ? {
                            aspectRatio: `${imageSize.width} / ${imageSize.height}`,
                            width: `min(100%, calc(42vh * ${imageSize.width / imageSize.height}))`
                          }
                        : undefined
                    }
                  >
                    <img
                      src={source}
                      alt=""
                      onLoad={(event) => {
                        if (storedWidth && storedHeight) return;
                        setNaturalSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight
                        });
                      }}
                    />
                    {imageSize && definitions.flatMap((definition) =>
                      optionsByName[definition.name].map((option) => {
                        const annotation = option.item;
                        const selected = draft[definition.name] === option.value;
                        const Icon = selectionIcon(definition.kind);
                        if (definition.kind === "image_region") {
                          const region = boundedRegion(annotation, imageSize);
                          if (!region) return [];
                          return (
                            <button
                              type="button"
                              key={`${definition.name}-${option.value}`}
                              className={cx(
                                "reference-selection-region",
                                selected && "is-selected"
                              )}
                              style={{
                                left: percentage((region.x / imageSize.width) * 100),
                                top: percentage((region.y / imageSize.height) * 100),
                                width: percentage((region.width / imageSize.width) * 100),
                                height: percentage((region.height / imageSize.height) * 100),
                                "--rotation": `${normalizeImageRotation(region.rotation)}deg`
                              }}
                              aria-label={`Use ${option.label} as ${definition.label || definition.name}`}
                              aria-pressed={selected}
                              onClick={() =>
                                setSelection(
                                  definition.name,
                                  selected ? "" : option.value
                                )
                              }
                            >
                              <span>{option.label}</span>
                            </button>
                          );
                        }
                        const x = clamp(
                          Number(annotation.x) || 0,
                          0,
                          imageSize.width
                        );
                        const y = clamp(
                          Number(annotation.y) || 0,
                          0,
                          imageSize.height
                        );
                        return (
                          <button
                            type="button"
                            key={`${definition.name}-${option.value}`}
                            className={cx(
                              "reference-selection-point",
                              selected && "is-selected"
                            )}
                            style={{
                              left: percentage((x / imageSize.width) * 100),
                              top: percentage((y / imageSize.height) * 100)
                            }}
                            aria-label={`Use ${option.label} as ${definition.label || definition.name}`}
                            aria-pressed={selected}
                            onClick={() =>
                              setSelection(
                                definition.name,
                                selected ? "" : option.value
                              )
                            }
                          >
                            <Icon size={12} />
                            <span>{option.label}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
                {selectedCropBounds && (
                  <section className="reference-selections-dialog__preview-section">
                    <strong>Selected crop</strong>
                    <div
                      className="reference-selection-crop-preview"
                      style={{
                        aspectRatio: `${selectedCropBounds.width} / ${selectedCropBounds.height}`,
                        width: `min(100%, calc(24vh * ${selectedCropBounds.width / selectedCropBounds.height}))`
                      }}
                    >
                      <img
                        src={source}
                        alt=""
                        style={cropImageStyle(imageSize, selectedCropBounds)}
                      />
                      {selectedFocusPosition && (
                        <span
                          className="reference-selection-crop-preview__focus"
                          style={{
                            left: percentage(selectedFocusPosition.x),
                            top: percentage(selectedFocusPosition.y)
                          }}
                          aria-hidden="true"
                        >
                          <Crosshair size={12} />
                        </span>
                      )}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className="reference-selections-dialog__empty">
                No preview is available for this reference.
              </div>
            )}
          </div>
          <div className="reference-selections-dialog__controls">
            {focusOutsideCrop && (
              <p className="reference-selections-dialog__pair-warning">
                <CircleAlert size={14} /> The focus point is outside the crop
                region. Renderers will clamp it to the crop edge.
              </p>
            )}
            {definitions.map((definition) => {
              const options = optionsByName[definition.name];
              const selectedValue = draft[definition.name] || "";
              const missing =
                selectedValue &&
                !options.some((option) => option.value === selectedValue);
              const Icon = selectionIcon(definition.kind);
              return (
                <label key={definition.name}>
                  <span>
                    <Icon size={14} />
                    <strong>{definition.label || definition.name}</strong>
                  </span>
                  <span className="select-wrap">
                    <select
                      value={selectedValue}
                      onChange={(event) =>
                        setSelection(definition.name, event.target.value)
                      }
                    >
                      <option value="">None</option>
                      {missing && (
                        <option value={selectedValue} disabled>
                          Missing annotation ({selectedValue})
                        </option>
                      )}
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </span>
                  {!options.length && (
                    <small>No matching annotations are defined on this image.</small>
                  )}
                  {missing && (
                    <small className="reference-selections-dialog__warning">
                      <CircleAlert size={13} /> The previously selected annotation no longer exists.
                    </small>
                  )}
                </label>
              );
            })}
          </div>
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
            className="button button--primary"
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export { ReferenceSelectionsDialog };
