async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}.`);
  }
  return body;
}

export const api = {
  config: () => request("/api/config"),
  configurationEditor: () => request("/api/configuration-editor"),
  saveConfig: (config) =>
    request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    }),
  list: (collection) => request(`/api/collections/${encodeURIComponent(collection)}`),
  record: (collection, id) =>
    request(
      `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`
    ),
  save: (collection, record) =>
    request(
      `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record)
      }
    ),
  create: (collection, record) =>
    request(`/api/collections/${encodeURIComponent(collection)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record)
    }),
  rename: (collection, id, nextId) =>
    request(
      `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/rename`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: nextId })
      }
    ),
  uploadMedia: (file) =>
    request(`/api/media?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file
    }),
  remove: async (collection, id) => {
    const response = await fetch(
      `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || `Request failed with status ${response.status}.`);
    }
  }
};
