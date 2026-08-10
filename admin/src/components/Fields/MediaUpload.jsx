import { Copy, FileCheck2, Files, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  acceptTokens,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept
} from "../../../../core/media.js";
import "./MediaUpload.scss";

function DuplicateMediaDialog({ duplicate, onCancel, onChoose }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const cancelRef = useRef(onCancel);

  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll("button:not(:disabled)") ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
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
  }, []);

  const existing = duplicate.result.existing;
  const copy = duplicate.result.copy ?? duplicate.result.proposed;
  return createPortal(
    <div
      className="dialog-backdrop media-duplicate-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog media-duplicate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__top">
          <span className="dialog__icon">
            <Files size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId}>This file is already uploaded</h2>
            <p>
              The content matches “{existing.filename}”. Choose the existing
              file or store another named copy.
            </p>
          </div>
          <button ref={closeRef} type="button" aria-label="Cancel" onClick={onCancel}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="media-duplicate-dialog__files">
          <span><FileCheck2 size={15} />Use existing: <strong>{existing.filename}</strong></span>
          <span><Copy size={15} />New copy: <strong>{copy?.filename || duplicate.file.name}</strong></span>
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onChoose("copy")}
          >
            Upload another copy
          </button>
          <button type="button" className="button" onClick={() => onChoose("reuse")}>
            Use existing
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function useMediaUpload({
  accept,
  defaultAccept,
  collectionName,
  widget,
  onUploaded
}) {
  const adapter = useAdapter();
  const inputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const acceptedTypes = acceptTokens(accept ?? defaultAccept);

  async function uploadFile(file, duplicateMode) {
    if (!file || uploading) return;
    if (!mediaFileMatchesAccept(file, acceptedTypes)) {
      setError(mediaAcceptErrorMessage(file, acceptedTypes));
      return;
    }
    setUploading(true);
    setError("");
    try {
      const result = await adapter.uploadMedia(file, collectionName, {
        widget,
        ...(duplicateMode ? { duplicate: duplicateMode } : {})
      });
      if (result?.duplicate) {
        setDuplicate({ file, result });
        return;
      }
      setDuplicate(null);
      onUploaded(result);
    } catch (uploadError) {
      setError(uploadError.message || "The file could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  function filesFromInput(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length) uploadFile(files[0]);
  }

  function acceptsDrag(event) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  const dropProps = {
    onDragEnter(event) {
      if (!acceptsDrag(event) || uploading) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragging(true);
    },
    onDragOver(event) {
      if (!acceptsDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = uploading ? "none" : "copy";
    },
    onDragLeave(event) {
      if (!acceptsDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (!dragDepthRef.current) setDragging(false);
    },
    onDrop(event) {
      if (!acceptsDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragging(false);
      if (uploading) return;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length !== 1) {
        setError("Drop exactly one file into this field.");
        return;
      }
      uploadFile(files[0]);
    }
  };

  const duplicateDialog = duplicate ? (
    <DuplicateMediaDialog
      duplicate={duplicate}
      onCancel={() => setDuplicate(null)}
      onChoose={(mode) => {
        const file = duplicate.file;
        setDuplicate(null);
        uploadFile(file, mode);
      }}
    />
  ) : null;

  return {
    acceptedTypes,
    dragging,
    duplicateDialog,
    error,
    inputRef,
    inputProps: {
      accept: acceptedTypes.join(","),
      onChange: filesFromInput
    },
    dropProps,
    setError,
    uploading
  };
}

export { DuplicateMediaDialog, useMediaUpload };
