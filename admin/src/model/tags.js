import {
  renderSlugTemplate,
  uniqueFilenameStem
} from "../../../core/slug.js";
import {
  ID_PATTERN,
  createId,
  isGeneratedIdWidget
} from "../../../core/id.js";
import { instantiateNode } from "./nodeFactory.js";
import { referenceItemValue } from "./reference.js";

function normalizeTagIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    if (
      typeof entry !== "string" ||
      !ID_PATTERN.test(entry) ||
      seen.has(entry)
    ) {
      return [];
    }
    seen.add(entry);
    return [entry];
  });
}

function normalizedTagLabel(value) {
  return String(value ?? "").trim().normalize("NFKC").toLowerCase();
}

function publishedTagValue(item, name, collection) {
  if (
    typeof name === "string" &&
    Object.hasOwn(item?.properties ?? {}, name)
  ) {
    return item.properties[name];
  }
  return referenceItemValue(item, name, collection);
}

function tagOption(item, collection) {
  const referenceView = collection?.views?.reference ?? {};
  const value = publishedTagValue(item, referenceView.value, collection);
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return null;
  const title = publishedTagValue(item, referenceView.title, collection);
  return {
    value,
    label: typeof title === "string" && title ? title : value,
    item
  };
}

function tagOptions(items, collection) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const option = tagOption(item, collection);
    if (!option || seen.has(option.value)) return [];
    seen.add(option.value);
    return [option];
  });
}

function matchingTag(items, collection, label) {
  const normalized = normalizedTagLabel(label);
  if (!normalized) return null;
  return tagOptions(items, collection).find(
    (option) => normalizedTagLabel(option.label) === normalized
  ) ?? null;
}

function createTagRecord({
  label,
  collection,
  nodeTypes,
  items = [],
  date = new Date()
}) {
  const name = String(label ?? "").trim();
  if (!name) throw new Error("A tag name is required.");

  const typeName = collection?.node_type;
  const type = nodeTypes?.[typeName];
  const valueField = collection?.views?.reference?.value;
  const titleField = collection?.views?.reference?.title;
  if (
    !type ||
    !valueField ||
    !isGeneratedIdWidget(type.fields?.[valueField]?.widget) ||
    !titleField ||
    type.fields?.[titleField]?.widget !== "string"
  ) {
    throw new Error("The tag collection is not configured for creation.");
  }

  const generatedIdFields = Object.entries(type.fields ?? {})
    .filter(([, field]) => isGeneratedIdWidget(field.widget))
    .map(([fieldName]) => fieldName);
  const usedGeneratedIds = new Set(
    items.flatMap((item) =>
      generatedIdFields
        .map((fieldName) => item.properties?.[fieldName])
        .filter((value) => typeof value === "string")
    )
  );
  const record = instantiateNode(typeName, nodeTypes, {
    properties: { [titleField]: name },
    usedIds: usedGeneratedIds
  });
  const properties = record.properties;

  const usedIds = new Set(items.map((item) => item.id));
  const id = uniqueFilenameStem(
    renderSlugTemplate(collection.slug, {
      fields: properties,
      identifierField: collection.identifier_field || titleField,
      date
    }),
    usedIds
  );
  const order =
    Math.max(
      -1,
      ...items.map((item) =>
        Number.isFinite(item.order) ? item.order : -1
      )
    ) + 1;

  record.id = id;
  record.order = order;
  return record;
}

async function createOrReuseTag({
  adapter,
  label,
  collection,
  nodeTypes,
  items = [],
  date = new Date()
}) {
  const existing = matchingTag(items, collection, label);
  if (existing) return { item: existing.item, items, created: false };

  async function create(currentItems) {
    const record = createTagRecord({
      label,
      collection,
      nodeTypes,
      items: currentItems,
      date
    });
    const result = await adapter.create(collection.name, record);
    return {
      item: result?.item ?? record,
      items: currentItems,
      created: true
    };
  }

  try {
    return await create(items);
  } catch (error) {
    if (error?.status !== 409) throw error;

    let refreshedItems;
    try {
      const result = await adapter.list(collection.name);
      refreshedItems = result?.items ?? [];
    } catch {
      throw error;
    }

    const concurrent = matchingTag(refreshedItems, collection, label);
    if (concurrent) {
      return {
        item: concurrent.item,
        items: refreshedItems,
        created: false
      };
    }
    return create(refreshedItems);
  }
}

export {
  createOrReuseTag,
  createTagRecord,
  normalizeTagIds,
  normalizedTagLabel,
  tagOption,
  tagOptions
};
