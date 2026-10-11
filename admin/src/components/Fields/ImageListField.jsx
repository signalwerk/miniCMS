import { primaryImageAsset } from "../../../../core/media.js";
import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, Star } from "lucide-react";
import { createId } from "../../../../core/id.js";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { imageRenderingOptions } from "../../model/image.js";
import { AnnotatedImageField } from "./AnnotatedImageField.jsx";
import "./ImageListField.scss";

export function ImageListField({ id, field, value, collectionName, onChange }) {
  const adapter = useAdapter();
  const images = Array.isArray(value) ? value : [];
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const primary = primaryImageAsset(images);
  const selected = images.find(image => image.id === selectedId) ?? primary;
  function selectPrimary(entries, primaryId) {
    return entries.map(entry => { const { primary: _primary, ...asset } = entry; return entry.id === primaryId ? { ...asset, primary: true } : asset; });
  }
  const readonly = field.readonly === true;
  function move(from, to) {
    if (readonly || from === to || to < 0 || to >= images.length) return;
    const next = selectPrimary(images, primary?.id);
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  }
  function remove(image) {
    const remaining = images.filter(entry => entry.id !== image.id);
    onChange(selectPrimary(remaining, image.id === primary?.id ? remaining[0]?.id : primary?.id));
    if (selectedId === image.id) setSelectedId(null);
  }
  return <div className="image-list-field">
    <ol className="image-list-field__items">
      {images.map((image, index) => <li key={image.id} draggable={!readonly}
        onDragStart={event => { event.dataTransfer.setData("application/x-minicms-image", image.id); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={event => { if (!readonly && Array.from(event.dataTransfer.types).includes("application/x-minicms-image")) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); const from = images.findIndex(entry => entry.id === event.dataTransfer.getData("application/x-minicms-image")); if (from >= 0) move(from, index); }}>
        <button type="button" className="image-list-field__select" aria-pressed={!adding && selected?.id === image.id}
          onClick={() => { setAdding(false); setSelectedId(image.id); }}>
          <img alt="" draggable={false} src={adapter.resolveImageUrl(image, { collection: collectionName, mediaFolder: field.media_folder, width: 120, height: 120, fit: "inside", ...imageRenderingOptions(field) })} />
          <span><strong>{image.name || image.filename}</strong><small>{image.id === primary?.id ? "Primary image" : `Image ${index + 1}`}</small></span>
        </button>
        {!readonly && <div className="image-list-field__actions">
          <button type="button" className="button button--secondary button--icon" aria-pressed={image.id === primary?.id} aria-label={`Use image ${index + 1} as primary`} onClick={() => { onChange(selectPrimary(images, image.id)); setSelectedId(image.id); setAdding(false); }}><Star size={16} fill={image.id === primary?.id ? "currentColor" : "none"}/></button>
          <button type="button" className="button button--secondary button--icon" disabled={index === 0} aria-label={`Move image ${index + 1} up`} onClick={() => move(index, index - 1)}><ArrowUp size={16}/></button>
          <button type="button" className="button button--secondary button--icon" disabled={index === images.length - 1} aria-label={`Move image ${index + 1} down`} onClick={() => move(index, index + 1)}><ArrowDown size={16}/></button>
          <button type="button" className="button button--secondary button--icon" aria-label={`Remove image ${index + 1}`} onClick={() => remove(image)}><Trash2 size={16}/></button>
        </div>}
      </li>)}
    </ol>
    {!readonly && <button type="button" className="button button--secondary" onClick={() => setAdding(true)}><Plus size={16}/>Add image</button>}
    {(adding || selected) && <div className="image-list-field__editor">
      {!adding && <label htmlFor={`${id}-name`}>Image name<input id={`${id}-name`} value={selected.name ?? ""} onChange={event => onChange(images.map(image => image.id === selected.id ? { ...image, name: event.target.value } : image))}/></label>}
      <AnnotatedImageField key={adding ? "new" : selected.id} id={`${id}-${adding ? "new" : selected.id}`} field={{ ...field, multiple: undefined }} value={adding ? "" : selected} collectionName={collectionName}
        onChange={image => {
          if (!image?.hash) { if (!adding && selected) remove(selected); return; }
          if (adding) {
            const entry = { ...image, id: createId(new Set(images.map(item => item.id))) };
            onChange(selectPrimary([...images, entry], primary?.id ?? entry.id)); setSelectedId(entry.id); setAdding(false);
          } else onChange(images.map(entry => entry.id === selected.id ? { ...image, id: selected.id } : entry));
        }}/>
      {adding && <button type="button" className="button button--secondary" onClick={() => setAdding(false)}>Cancel</button>}
    </div>}
  </div>;
}
