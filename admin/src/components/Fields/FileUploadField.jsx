import { FileText, Upload } from "lucide-react";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { DEFAULT_FILE_ACCEPT } from "../../../../core/media.js";
import { cx } from "../../model/editor.js";
import { Spinner } from "../Common/Common.jsx";
import { useMediaUpload } from "./MediaUpload.jsx";
import "./FileUploadField.scss";

function filenameFromPath(value) {
  const filename = String(value || "").split(/[/?#]/).filter(Boolean).pop();
  if (!filename) return "Uploaded file";
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function FileUploadField({ id, field, value, collectionName, onChange }) {
  const adapter = useAdapter();
  const upload = useMediaUpload({
    accept: field.accept,
    defaultAccept: DEFAULT_FILE_ACCEPT,
    collectionName,
    widget: "file",
    onUploaded: (result) => onChange(result.path)
  });

  return (
    <div
      className={cx(
        "file-upload-field",
        "media-upload-drop-target",
        upload.dragging && "is-dragging"
      )}
      aria-busy={upload.uploading}
      {...upload.dropProps}
    >
      {upload.dragging && <span className="media-upload-drop-hint">Drop file to upload</span>}
      {value ? (
        <a
          className="file-upload-field__file"
          href={adapter.resolveMediaUrl(value, { collection: collectionName })}
          target="_blank"
          rel="noreferrer"
        >
          <FileText size={18} aria-hidden="true" />
          <span>
            <strong>{filenameFromPath(value)}</strong>
            <code>{value}</code>
          </span>
        </a>
      ) : (
        <div className="file-upload-field__empty">
          <FileText size={18} aria-hidden="true" />
          <span>No file selected</span>
        </div>
      )}
      <div className="file-upload-field__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={upload.uploading}
          onClick={() => upload.inputRef.current?.click()}
        >
          {upload.uploading ? <Spinner small /> : <Upload size={14} />}
          {value ? "Replace" : "Upload"}
        </button>
        {value && (
          <button
            type="button"
            className="button button--secondary"
            disabled={upload.uploading}
            onClick={() => {
              upload.setError("");
              onChange("");
            }}
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={upload.inputRef}
        id={id}
        className="visually-hidden"
        type="file"
        {...upload.inputProps}
      />
      {upload.error && (
        <small className="field-error" role="alert">
          {upload.error}
        </small>
      )}
      {upload.duplicateDialog}
    </div>
  );
}

export { FileUploadField };
