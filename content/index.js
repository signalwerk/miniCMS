import { parseInlineReferenceUrl } from "../core/inline-reference.js";

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { prependImageServiceOperations } from "../core/image-service.js";
export {
  INLINE_REFERENCE_PREFIX,
  buildInlineReferenceUrl,
  isAllowedMarkdownLink,
  isInlineReferenceUrl,
  parseInlineReferenceUrl
} from "../core/inline-reference.js";

function skipCodeSpan(markdown, start) {
  let size = 1;
  while (markdown[start + size] === "`") size += 1;
  const delimiter = "`".repeat(size);
  const end = markdown.indexOf(delimiter, start + size);
  return end === -1 ? markdown.length : end + size;
}

function closingLabelBracket(markdown, start) {
  let depth = 1;
  for (let cursor = start; cursor < markdown.length; cursor += 1) {
    if (markdown[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (markdown[cursor] === "`") {
      cursor = skipCodeSpan(markdown, cursor) - 1;
      continue;
    }
    if (markdown[cursor] === "[") depth += 1;
    if (markdown[cursor] !== "]") continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function inlineReferencesInMarkdown(markdown, collectionName) {
  const references = new Map();
  let cursor = 0;

  while (cursor < markdown.length) {
    if (markdown[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (markdown[cursor] === "`") {
      cursor = skipCodeSpan(markdown, cursor);
      continue;
    }
    if (markdown[cursor] !== "[" || markdown[cursor - 1] === "!") {
      cursor += 1;
      continue;
    }

    const labelEnd = closingLabelBracket(markdown, cursor + 1);
    if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") {
      cursor += 1;
      continue;
    }
    let destinationStart = labelEnd + 2;
    while (/[ \t\n\r]/.test(markdown[destinationStart] ?? "")) {
      destinationStart += 1;
    }
    const angled = markdown[destinationStart] === "<";
    if (angled) destinationStart += 1;
    let destinationEnd = destinationStart;
    while (
      destinationEnd < markdown.length &&
      (angled
        ? markdown[destinationEnd] !== ">"
        : !/[\s)]/.test(markdown[destinationEnd]))
    ) {
      destinationEnd += 1;
    }
    const afterDestination = angled ? destinationEnd + 1 : destinationEnd;
    if (
      destinationEnd === destinationStart ||
      (angled && markdown[destinationEnd] !== ">") ||
      markdown[afterDestination] !== ")"
    ) {
      cursor = labelEnd + 1;
      continue;
    }

    const href = markdown.slice(destinationStart, destinationEnd);
    const reference = parseInlineReferenceUrl(href);
    if (reference?.collection === collectionName && !references.has(href)) {
      references.set(href, reference);
    }
    cursor = afterDestination + 1;
  }

  return references;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isMapping(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, cloneValue(entry)])
  );
}

function freezeValue(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) freezeValue(entry);
  return Object.freeze(value);
}

function isReferenceScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function hasReferenceValue(value) {
  return isReferenceScalar(value) && value !== "";
}

function normalizedReference(value) {
  if (isReferenceScalar(value)) {
    return { ref: value, selections: {} };
  }
  if (!isMapping(value)) {
    return { ref: "", selections: {} };
  }
  return {
    ref: isReferenceScalar(value.ref) ? value.ref : "",
    selections: isMapping(value.selections)
      ? cloneValue(value.selections)
      : {}
  };
}

function recordResult(value) {
  if (isCompleteRecord(value)) return value;
  if (isMapping(value) && Object.hasOwn(value, "item")) {
    return isMapping(value.item) ? value.item : null;
  }
  if (isMapping(value) && Object.hasOwn(value, "record")) {
    return isMapping(value.record) ? value.record : null;
  }
  return isMapping(value) ? value : null;
}

function listedItems(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function isCompleteRecord(value) {
  return (
    isMapping(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    isMapping(value.properties) &&
    isMapping(value.slots)
  );
}

function referenceItemValue(item, name, collection) {
  if (!name || name === "id" || name === "$id") return item?.id ?? "";
  const extension = String(collection?.extension || "yml").replace(/^\./, "");
  if (name === "$filename") return `${item?.id ?? ""}.${extension}`;
  if (name === "$storage_path") {
    return `${String(collection?.folder || "").replace(/\/$/, "")}/${item?.id ?? ""}.${extension}`;
  }
  if (name === "$created_at") {
    return item?.created_at ?? item?.$created_at ?? null;
  }
  if (name === "$updated_at") {
    return item?.updated_at ?? item?.$updated_at ?? null;
  }
  return item?.properties?.[name] ?? item?.[name] ?? "";
}

function scalarKey(value) {
  return isReferenceScalar(value) ? `${typeof value}:${String(value)}` : null;
}

function sameScalar(left, right) {
  const leftKey = scalarKey(left);
  return leftKey !== null && leftKey === scalarKey(right);
}

function nestedValue(value, path) {
  if (!path) return value;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => current?.[segment], value);
}

function sourceFunctions(options) {
  const source = isMapping(options.source) ? options.source : null;
  const listRaw = options.listRaw ?? source?.list;
  const getRaw = options.getRaw ?? source?.get ?? source?.record;
  const resolveMediaUrl =
    options.resolveMediaUrl ?? source?.resolveMediaUrl ?? ((value) => value);
  const resolveImageUrl =
    options.resolveImageUrl ?? source?.resolveImageUrl ?? resolveMediaUrl;

  return {
    listRaw:
      typeof listRaw === "function" ? listRaw.bind(source ?? options) : null,
    getRaw:
      typeof getRaw === "function" ? getRaw.bind(source ?? options) : null,
    resolveMediaUrl:
      typeof resolveMediaUrl === "function"
        ? resolveMediaUrl.bind(source ?? options)
        : null,
    resolveImageUrl:
      typeof resolveImageUrl === "function"
        ? resolveImageUrl.bind(source ?? options)
        : null
  };
}

/**
 * Wrap a raw, read-only content source with configuration-aware reference and
 * media resolution.
 */
function createContentAdapter({
  config,
  source,
  listRaw,
  getRaw,
  resolveMediaUrl,
  resolveImageUrl
} = {}) {
  if (!isMapping(config)) {
    throw new TypeError("createContentAdapter requires a configuration mapping.");
  }
  const sourceApi = sourceFunctions({
    source,
    listRaw,
    getRaw,
    resolveMediaUrl,
    resolveImageUrl
  });
  if (!sourceApi.listRaw || !sourceApi.getRaw) {
    throw new TypeError(
      "createContentAdapter requires a source, or listRaw and getRaw functions."
    );
  }
  if (!sourceApi.resolveMediaUrl) {
    throw new TypeError("resolveMediaUrl must be a function.");
  }
  if (!sourceApi.resolveImageUrl) {
    throw new TypeError("resolveImageUrl must be a function.");
  }

  const contentConfig = freezeValue(cloneValue(config));
  const collectionCache = new Map();
  const rawListCache = new Map();
  const rawRecordCache = new Map();
  const referenceIndexCache = new Map();
  const resolvedRecordCache = new Map();
  const resolvedListCache = new Map();
  const refreshedReferenceMisses = new Set();
  const activeReferenceRefreshes = new Map();

  function clearListCaches(collectionName) {
    rawListCache.delete(collectionName);
    resolvedListCache.delete(collectionName);
    for (const key of referenceIndexCache.keys()) {
      if (key.startsWith(`${collectionName}:`)) {
        referenceIndexCache.delete(key);
      }
    }
  }

  function collectionFor(name) {
    if (collectionCache.has(name)) return collectionCache.get(name);
    const definition = contentConfig.collections?.[name];
    if (!isMapping(definition)) {
      throw new Error(`Collection "${name}" does not exist.`);
    }
    const collection = freezeValue({ name, ...cloneValue(definition) });
    collectionCache.set(name, collection);
    return collection;
  }

  async function rawRecord(collectionName, id) {
    const key = `${collectionName}:${id}`;
    if (!rawRecordCache.has(key)) {
      const pending = Promise.resolve()
        .then(() => sourceApi.getRaw(collectionName, id))
        .then(recordResult)
        .catch((error) => {
          rawRecordCache.delete(key);
          if (error?.status === 404 || error?.code === "ENOENT") return null;
          throw error;
        });
      rawRecordCache.set(key, pending);
    }
    return rawRecordCache.get(key);
  }

  async function rawList(collectionName) {
    collectionFor(collectionName);
    if (!rawListCache.has(collectionName)) {
      const pending = Promise.resolve()
        .then(() => sourceApi.listRaw(collectionName))
        .then((result) => {
          const items = [...listedItems(result)];
          for (const item of items) {
            if (isCompleteRecord(item)) {
              rawRecordCache.set(
                `${collectionName}:${item.id}`,
                Promise.resolve(item)
              );
            }
          }

          return items;
        })
        .catch((error) => {
          rawListCache.delete(collectionName);
          throw error;
        });
      rawListCache.set(collectionName, pending);
    }
    return rawListCache.get(collectionName);
  }

  async function referenceIndex(collectionName, valueField, refresh = false) {
    const key = `${collectionName}:${valueField}`;
    if (refresh) clearListCaches(collectionName);
    if (!referenceIndexCache.has(key)) {
      const pending = rawList(collectionName)
        .then((items) => {
          const collection = collectionFor(collectionName);
          const byValue = new Map();
          for (const item of items) {
            if (typeof item?.id !== "string") continue;
            const valueKey = scalarKey(
              referenceItemValue(item, valueField, collection)
            );
            if (valueKey !== null && !byValue.has(valueKey)) {
              byValue.set(valueKey, item.id);
            }
          }
          return byValue;
        })
        .catch((error) => {
          referenceIndexCache.delete(key);
          throw error;
        });
      referenceIndexCache.set(key, pending);
    }
    return referenceIndexCache.get(key);
  }

  function refreshedReferenceIndex(collectionName, valueField) {
    const key = `${collectionName}:${valueField}`;
    if (!activeReferenceRefreshes.has(key)) {
      const pending = referenceIndex(collectionName, valueField, true).finally(
        () => {
          if (activeReferenceRefreshes.get(key) === pending) {
            activeReferenceRefreshes.delete(key);
          }
        }
      );
      activeReferenceRefreshes.set(key, pending);
    }
    return activeReferenceRefreshes.get(key);
  }

  async function referenceTarget(
    collectionName,
    ref,
    valueField,
    refreshOnMiss = false
  ) {
    if (!hasReferenceValue(ref)) return { id: null, record: null };
    const valueKey = scalarKey(ref);
    let index = await referenceIndex(collectionName, valueField);
    let id = index.get(valueKey) ?? null;
    const missKey = `${collectionName}:${valueField}:${valueKey}`;
    if (
      refreshOnMiss &&
      !id &&
      !refreshedReferenceMisses.has(missKey)
    ) {
      refreshedReferenceMisses.add(missKey);
      index = await refreshedReferenceIndex(collectionName, valueField);
      id = index.get(valueKey) ?? null;
    }
    if (!id) return { id: null, record: null };
    return { id, record: await rawRecord(collectionName, id) };
  }

  function selectedValues(rawTarget, targetCollection, rawSelections) {
    const published = targetCollection.views?.reference?.selections;
    const definitions = isMapping(published) ? published : {};
    const selectionNames = [
      ...Object.keys(definitions).filter((name) =>
        Object.prototype.hasOwnProperty.call(rawSelections, name)
      ),
      ...Object.keys(rawSelections).filter(
        (name) => !Object.prototype.hasOwnProperty.call(definitions, name)
      )
    ];

    return Object.fromEntries(
      selectionNames.map((name) => {
        const ref = cloneValue(rawSelections[name]);
        const options = definitions[name]?.options;
        let value = null;
        if (
          rawTarget &&
          isMapping(options) &&
          typeof options.field === "string"
        ) {
          const source = referenceItemValue(
            rawTarget,
            options.field,
            targetCollection
          );
          const candidates = nestedValue(source, options.path);
          const valueField = options.value || "id";
          if (Array.isArray(candidates)) {
            value =
              candidates.find(
                (candidate) =>
                  isMapping(candidate) &&
                  sameScalar(candidate[valueField], rawSelections[name])
              ) ?? null;
          }
        }
        return [name, { ref, value: cloneValue(value) }];
      })
    );
  }

  async function resolvedReference(field, value, ancestors) {
    const reference = normalizedReference(value);
    const targetCollection = collectionFor(field.collection);
    const valueField =
      field.value_field || targetCollection.views?.reference?.value || "id";
    const target = await referenceTarget(
      targetCollection.name,
      reference.ref,
      valueField,
      ["reference", "tags"].includes(field.widget)
    );
    const targetKey = target.id
      ? `${targetCollection.name}:${target.id}`
      : null;
    const record =
      target.record && targetKey && !ancestors.has(targetKey)
        ? await resolveRecord(targetCollection.name, target.record, ancestors)
        : null;

    return {
      ref: cloneValue(reference.ref),
      record,
      selections: selectedValues(
        target.record,
        targetCollection,
        reference.selections
      )
    };
  }

  async function resolvedTags(field, value, ancestors) {
    if (!Array.isArray(value)) return [];
    return Promise.all(
      value.map((tagId) => resolvedReference(field, tagId, ancestors))
    );
  }

  async function resolvedMarkdown(field, value, ancestors) {
    const markdown = typeof value === "string" ? value : String(value ?? "");
    const collectionName = field.blocknote.inline_reference.collection;
    const references = inlineReferencesInMarkdown(markdown, collectionName);
    const resolvedEntries = await Promise.all(
      [...references].map(async ([href, reference]) => {
        const resolved = await resolvedReference(
          { widget: "reference", collection: collectionName },
          reference.ref,
          ancestors
        );
        return [
          href,
          {
            collection: collectionName,
            ref: reference.ref,
            record: resolved.record
          }
        ];
      })
    );

    return {
      markdown,
      references: Object.fromEntries(resolvedEntries)
    };
  }

  async function resolvedMedia(value, widget, collectionName) {
    const resolveUrl =
      widget === "image"
        ? sourceApi.resolveImageUrl
        : sourceApi.resolveMediaUrl;
    const context = { collection: collectionName };
    if (typeof value === "string") {
      return value ? await resolveUrl(value, context) : value;
    }
    if (widget === "image" && isMapping(value)) {
      const image = cloneValue(value);
      if (typeof image.src === "string" && image.src) {
        image.src = await resolveUrl(image.src, context);
      }
      return image;
    }
    return cloneValue(value);
  }

  async function resolveNode(node, collectionName, ancestors) {
    if (!isMapping(node)) return cloneValue(node);
    const type = contentConfig.node_types?.[node.type];
    const fields = isMapping(type?.fields) ? type.fields : {};
    const properties = isMapping(node.properties) ? node.properties : {};
    const resolvedProperties = {};

    for (const [name, value] of Object.entries(properties)) {
      const field = fields[name];
      if (field?.widget === "reference") {
        resolvedProperties[name] = await resolvedReference(
          field,
          value,
          ancestors
        );
      } else if (field?.widget === "tags") {
        resolvedProperties[name] = await resolvedTags(field, value, ancestors);
      } else if (
        field?.widget === "markdown" &&
        isMapping(field.blocknote?.inline_reference)
      ) {
        resolvedProperties[name] = await resolvedMarkdown(
          field,
          value,
          ancestors
        );
      } else if (field?.widget === "file" || field?.widget === "image") {
        resolvedProperties[name] = await resolvedMedia(
          value,
          field.widget,
          collectionName
        );
      } else {
        resolvedProperties[name] = cloneValue(value);
      }
    }

    const slots = {};
    for (const [slotName, children] of Object.entries(node.slots ?? {})) {
      slots[slotName] = Array.isArray(children)
        ? await Promise.all(
            children.map((child) =>
              resolveNode(child, collectionName, ancestors)
            )
          )
        : cloneValue(children);
    }

    return {
      ...cloneValue(node),
      properties: resolvedProperties,
      slots
    };
  }

  async function resolveRecord(collectionName, raw, ancestors = new Set()) {
    const key = `${collectionName}:${raw.id}`;
    if (ancestors.has(key)) return null;
    const nextAncestors = new Set(ancestors).add(key);
    return resolveNode(raw, collectionName, nextAncestors);
  }

  async function resolvedRecord(collectionName, id) {
    const key = `${collectionName}:${id}`;
    if (!resolvedRecordCache.has(key)) {
      const pending = rawRecord(collectionName, id)
        .then((raw) =>
          raw ? resolveRecord(collectionName, raw) : null
        )
        .then((record) => (record ? freezeValue(record) : null))
        .catch((error) => {
          resolvedRecordCache.delete(key);
          throw error;
        });
      resolvedRecordCache.set(key, pending);
    }
    return resolvedRecordCache.get(key);
  }

  async function get(collectionName, idOrRecord) {
    const collection = collectionFor(collectionName);
    const item = isCompleteRecord(idOrRecord)
      ? freezeValue(await resolveRecord(collectionName, idOrRecord))
      : await resolvedRecord(collectionName, idOrRecord);
    return item
      ? freezeValue({ config: contentConfig, collection, item })
      : null;
  }

  async function list(collectionName) {
    const collection = collectionFor(collectionName);
    if (!resolvedListCache.has(collectionName)) {
      const pending = rawList(collectionName)
        .then((entries) =>
          Promise.all(
            entries.flatMap((entry) =>
              typeof entry?.id === "string"
                ? [resolvedRecord(collectionName, entry.id)]
                : []
            )
          )
        )
        .then((items) =>
          freezeValue({
            config: contentConfig,
            collection,
            items: items.filter(Boolean)
          })
        )
        .catch((error) => {
          resolvedListCache.delete(collectionName);
          throw error;
        });
      resolvedListCache.set(collectionName, pending);
    }
    return resolvedListCache.get(collectionName);
  }

  return Object.freeze({
    config: () => contentConfig,
    get,
    list
  });
}

export { createContentAdapter };
