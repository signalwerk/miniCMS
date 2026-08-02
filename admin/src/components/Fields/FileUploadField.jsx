import { FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  DEFAULT_FILE_ACCEPT,
  acceptTokens,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept
} from "../../../../core/media.js";
import { Spinner } from "../Common/Common.jsx";
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

function FileUploadField({ id, field, value, onChange }) {
  const adapter = useAdapter();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const acceptedTypes = acceptTokens(field.accept ?? DEFAULT_FILE_ACCEPT);

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!mediaFileMatchesAccept(file, acceptedTypes)) {
      setError(mediaAcceptErrorMessage(file, acceptedTypes));
      event.target.value = "";
      return;
    }
    setUploading(true);
    setError("");
    try {
      const result = await adapter.uploadMedia(file);
      onChange(result.path);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="file-upload-field">
      {value ? (
        <a
          className="file-upload-field__file"
          href={adapter.resolveMediaUrl(value)}
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
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner small /> : <Upload size={14} />}
          {value ? "Replace" : "Upload"}
        </button>
        {value && (
          <button
            type="button"
            className="button button--secondary"
            disabled={uploading}
            onClick={() => {
              setError("");
              onChange("");
            }}
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden"
        type="file"
        accept={acceptedTypes.join(",")}
        onChange={upload}
      />
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export { FileUploadField };
