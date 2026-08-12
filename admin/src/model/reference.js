import {
  ID_PATTERN,
  createId,
  isGeneratedIdWidget
} from "../../../core/id.js";
import {
  renderSlugTemplate,
  uniqueFilenameStem
} from "../../../core/slug.js";
import { hasImageValue, imageAssetValue } from "./image.js";
import {
  instantiateNode,
  populateInitialSlugFields
} from "./nodeFactory.js";

const REFERENCE_CREATE_WIDGETS = new Set(["string", "text", "markdown"]);

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReferenceScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function hasReferenceValue(value) {
  return isReferenceScalar(value) && value !== "";
}

function referenceScalarKey(value) {
  return hasReferenceValue(value)
    ? `${typeof value}:${String(value)}`
    : null;
}

function normalizeReferenceValues(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((reference) => {
    const key = referenceScalarKey(reference);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceValuesAfterAdd(value, nextReference) {
  const references = normalizeReferenceValues(value);
  const nextKey = referenceScalarKey(nextReference);
  if (
    nextKey === null ||
    references.some((reference) => referenceScalarKey(reference) === nextKey)
  ) {
    return references;
  }
  return [...references, nextReference];
}

function referenceValuesAfterToggle(value, nextReference) {
  const references = normalizeReferenceValues(value);
  const nextKey = referenceScalarKey(nextReference);
  if (nextKey === null) return references;
  const selected = references.some(
    (reference) => referenceScalarKey(reference) === nextKey
  );
  return selected
    ? references.filter(
        (reference) => referenceScalarKey(reference) !== nextKey
      )
    : [...references, nextReference];
}

function normalizeReferenceValue(value) {
  if (isReferenceScalar(value)) {
    return { ref: value, selections: {} };
  }
  if (!isMapping(value)) {
    return { ref: "", selections: {} };
  }

  const selections = {};
  if (isMapping(value.selections)) {
    for (const [name, selectedValue] of Object.entries(value.selections)) {
      if (typeof selectedValue === "string" && selectedValue) {
        selections[name] = selectedValue;
      }
    }
  }
  return {
    ref: isReferenceScalar(value.ref) ? value.ref : "",
    selections
  };
}

function compactReferenceValue(value) {
  const reference = normalizeReferenceValue(value);
  if (!hasReferenceValue(reference.ref)) return "";
  if (!Object.keys(reference.selections).length) return reference.ref;
  return {
    ref: reference.ref,
    selections: reference.selections
  };
}

function referenceItemValue(item, name, collection) {
  if (!name || name === "id" || name === "$id") return item?.id ?? "";
  const extension = String(collection?.extension || "yml").replace(/^\./, "");
  if (name === "$filename") return `${item?.id ?? ""}.${extension}`;
  if (name === "$storage_path") {
    return `${String(collection?.folder || "").replace(/\/$/, "")}/${item?.id ?? ""}.${extension}`;
  }
  if (name === "$created_at") return item?.created_at;
  if (name === "$updated_at") return item?.updated_at;
  return item?.properties?.[name] ?? item?.[name] ?? "";
}

function referenceText(value) {
  return ["string", "number", "boolean"].includes(typeof value)
    ? String(value)
    : "";
}

function referenceItemLabel(item, view, collection) {
  const configured = referenceText(
    referenceItemValue(
      item,
      view?.title || collection?.identifier_field || "title",
      collection
    )
  );
  return (
    configured ||
    referenceText(item?.title) ||
    referenceText(item?.id) ||
    "Untitled item"
  );
}

function referencePickerOption(item, field, collection) {
  if (
    field?.allowed_types?.length &&
    !field.allowed_types.includes(item?.type)
  ) {
    return null;
  }
  const view = collection?.views?.reference ?? {};
  const value = referenceItemValue(
    item,
    field?.value_field || view.value || "id",
    collection
  );
  if (!hasReferenceValue(value)) return null;
  return {
    item,
    label: referenceItemLabel(item, view, collection),
    value
  };
}

function normalizedReferenceLabel(value) {
  return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase();
}

function referenceCreationTarget(
  collection,
  nodeTypes,
  { allowedTypes } = {}
) {
  const primaryType = collection?.node_type;
  const rootTypes = collection?.allowed_types ?? [primaryType];
  const permittedTypes = allowedTypes?.length ? allowedTypes : rootTypes;
  const typeName =
    primaryType &&
    rootTypes.includes(primaryType) &&
    permittedTypes.includes(primaryType)
      ? primaryType
      : "";
  const type = nodeTypes?.[typeName];
  return type ? { typeName, type } : null;
}

function referenceCreationConfig(
  collection,
  nodeTypes,
  { labelField, allowedTypes } = {}
) {
  const target = referenceCreationTarget(collection, nodeTypes, {
    allowedTypes
  });
  if (!target) return null;
  const { type, typeName } = target;

  const fieldName = [
    labelField,
    collection?.views?.reference?.title,
    collection?.identifier_field,
    "title"
  ].find((name, index, names) => {
    if (!name || names.indexOf(name) !== index) return false;
    const field = type.fields?.[name];
    return (
      field?.readonly !== true &&
      REFERENCE_CREATE_WIDGETS.has(field?.widget)
    );
  });
  return fieldName ? { fieldName, type, typeName } : null;
}

function referenceRecordCreationConfig(
  collection,
  nodeTypes,
  { allowedTypes } = {}
) {
  const target = referenceCreationTarget(collection, nodeTypes, {
    allowedTypes
  });
  return target
    ? {
        ...target,
        identifierField: collection?.identifier_field || "title",
        referenceTitleField: collection?.views?.reference?.title || ""
      }
    : null;
}

function generatedIdFieldNames(type) {
  return Object.entries(type?.fields ?? {})
    .filter(([, field]) => isGeneratedIdWidget(field.widget))
    .map(([fieldName]) => fieldName);
}

function generatedIdsInItems(items, fieldNames) {
  return new Set(
    (Array.isArray(items) ? items : []).flatMap((item) =>
      fieldNames
        .map((fieldName) => item?.properties?.[fieldName])
        .filter((value) => typeof value === "string" && value)
    )
  );
}

function nextRootOrder(items) {
  return (
    Math.max(
      -1,
      ...(Array.isArray(items) ? items : []).map((item) =>
        Number.isFinite(item?.order) ? item.order : -1
      )
    ) + 1
  );
}

function createReferencedRecordDraft({
  collection,
  nodeTypes,
  allowedTypes,
  items = []
}) {
  const creation = referenceRecordCreationConfig(collection, nodeTypes, {
    allowedTypes
  });
  if (!creation) {
    throw new Error("The referenced collection is not configured for creation.");
  }

  const generatedFields = generatedIdFieldNames(creation.type);
  const usedGeneratedIds = generatedIdsInItems(items, generatedFields);
  const draft = instantiateNode(creation.typeName, nodeTypes, {
    id: "",
    order: nextRootOrder(items),
    usedIds: usedGeneratedIds
  });
  const properties = draft.properties;

  const parentField = collection?.hierarchy?.parent_field;
  if (parentField) properties[parentField] = null;

  return { ...draft, properties };
}

function requiredReferenceFieldHasValue(field, value) {
  if (field?.widget === "tags") {
    return Array.isArray(value) && value.length > 0;
  }
  if (field?.widget === "reference") {
    if (field.multiple === true) {
      return normalizeReferenceValues(value).length > 0;
    }
    return hasReferenceValue(normalizeReferenceValue(value).ref);
  }
  if (field?.widget === "image") {
    return hasImageValue(value);
  }
  if (field?.widget === "file") {
    return typeof value === "string" && Boolean(value.trim());
  }
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== "";
}

function referencedRecordFields(fields, type) {
  if (isMapping(fields)) {
    return Object.entries(fields).map(([name, field]) => ({
      ...(type?.fields?.[name] ?? {}),
      ...(isMapping(field) ? field : {}),
      name
    }));
  }
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const name =
      typeof field === "string"
        ? field
        : field?.name || (typeof field?.field === "string" ? field.field : "");
    if (!name) return [];
    return [{
      ...(type?.fields?.[name] ?? {}),
      ...(isMapping(field) ? field : {}),
      name
    }];
  });
}

function validateReferencedRecordDraft({ draft, fields, type }) {
  const errors = {};
  const seen = new Set();
  for (const field of referencedRecordFields(fields, type)) {
    if (seen.has(field.name) || field.required !== true) continue;
    seen.add(field.name);
    if (requiredReferenceFieldHasValue(field, draft?.properties?.[field.name])) {
      continue;
    }
    errors[field.name] = `${field.label || field.name} is required.`;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function referenceRecordSlugFields(draft, creation, collection) {
  const properties = structuredClone(draft?.properties ?? {});
  const needsUndeclaredTitle =
    !Object.hasOwn(creation.type.fields ?? {}, "title") &&
    /{{\s*(?:fields\.)?title\s*}}/.test(String(collection?.slug ?? ""));
  if (!needsUndeclaredTitle) return properties;

  const title = [
    collection?.identifier_field,
    collection?.views?.reference?.title
  ].find((fieldName) =>
    fieldName && referenceText(properties[fieldName]).trim()
  );
  if (title) properties.title = referenceText(properties[title]).trim();
  return properties;
}

function collisionSafeGeneratedProperties(properties, type, items) {
  const generatedFields = generatedIdFieldNames(type);
  const usedGeneratedIds = generatedIdsInItems(items, generatedFields);
  for (const fieldName of generatedFields) {
    const value = properties[fieldName];
    if (
      typeof value === "string" &&
      ID_PATTERN.test(value) &&
      !usedGeneratedIds.has(value)
    ) {
      usedGeneratedIds.add(value);
    } else {
      properties[fieldName] = createId(usedGeneratedIds);
    }
  }
  return properties;
}

function finalizeReferencedRecordDraft({
  draft,
  collection,
  creation,
  items,
  date
}) {
  const properties = collisionSafeGeneratedProperties(
    populateInitialSlugFields(
      creation.type,
      referenceRecordSlugFields(draft, creation, collection)
    ),
    creation.type,
    items
  );
  const fallbackFields = [
    collection?.identifier_field,
    collection?.views?.reference?.title,
    "title"
  ];
  const fallbackName = fallbackFields
    .map((fieldName) => referenceText(properties[fieldName]).trim())
    .find(Boolean);
  const renderedId = collection?.slug
    ? renderSlugTemplate(collection.slug, {
        fields: properties,
        identifierField: collection.identifier_field || "title",
        date
      })
    : draft?.id || fallbackName || "item";
  const id = uniqueFilenameStem(
    renderedId,
    new Set((Array.isArray(items) ? items : []).map((item) => item.id))
  );
  if (
    Object.hasOwn(properties, "slug") &&
    !properties.slug &&
    creation.type.fields?.slug?.widget !== "slug"
  ) {
    properties.slug = id;
  }
  return {
    id,
    type: creation.typeName,
    order: nextRootOrder(items),
    properties,
    slots: Object.fromEntries(
      Object.keys(creation.type.slots ?? {}).map((slotName) => [
        slotName,
        Array.isArray(draft?.slots?.[slotName])
          ? [...draft.slots[slotName]]
          : []
      ])
    )
  };
}

async function storeReferencedRecordDraft({
  adapter,
  draft,
  collection,
  nodeTypes,
  allowedTypes,
  fields = [],
  items = [],
  date = new Date(),
  optionForItem
}) {
  const creation = referenceRecordCreationConfig(collection, nodeTypes, {
    allowedTypes
  });
  if (!creation || draft?.type !== creation.typeName) {
    throw new Error("The referenced collection is not configured for creation.");
  }

  const preparedDraft = {
    ...draft,
    properties: populateInitialSlugFields(
      creation.type,
      draft?.properties ?? {}
    )
  };

  const validation = validateReferencedRecordDraft({
    draft: preparedDraft,
    fields,
    type: creation.type
  });
  if (!validation.valid) {
    const error = new Error(Object.values(validation.errors)[0]);
    error.validation = validation;
    throw error;
  }
  if (typeof optionForItem !== "function") {
    throw new Error("A reference option builder is required.");
  }

  const suppliedDate = date instanceof Date ? date : new Date(date);
  const creationDate = Number.isNaN(suppliedDate.getTime())
    ? new Date()
    : new Date(suppliedDate.getTime());

  async function create(currentItems) {
    const record = finalizeReferencedRecordDraft({
      draft: preparedDraft,
      collection,
      creation,
      items: currentItems,
      date: creationDate
    });
    if (!optionForItem(record)) {
      throw new Error("The new item would not provide a usable reference value.");
    }

    const result = await adapter.create(collection.name, record);
    const returnedItem = result?.item ?? record;
    const option = optionForItem(returnedItem) ?? optionForItem(record);
    if (!option) {
      throw new Error("The created item did not return a usable reference value.");
    }
    const item = option.item;
    return {
      created: true,
      record,
      item,
      items: [
        ...currentItems.filter((current) => current.id !== item.id),
        item
      ],
      option
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
    return create(refreshedItems);
  }
}

function matchingReferenceOption(items, optionForItem, label) {
  const normalizedLabel = normalizedReferenceLabel(label);
  if (!normalizedLabel) return null;
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const option = optionForItem(item);
    return option ? [option] : [];
  }).find(
    (option) => normalizedReferenceLabel(option.label) === normalizedLabel
  ) ?? null;
}

function createReferencedRecord({
  label,
  collection,
  nodeTypes,
  labelField,
  allowedTypes,
  items = [],
  date = new Date(),
  optionForItem
}) {
  const name = String(label ?? "").trim();
  if (!name) throw new Error("A reference name is required.");

  const creation = referenceCreationConfig(collection, nodeTypes, {
    labelField,
    allowedTypes
  });
  if (!creation) {
    throw new Error("The referenced collection is not configured for creation.");
  }

  const generatedFields = generatedIdFieldNames(creation.type);
  const usedGeneratedIds = generatedIdsInItems(items, generatedFields);
  const record = instantiateNode(creation.typeName, nodeTypes, {
    order: nextRootOrder(items),
    properties: {
      title: name,
      [creation.fieldName]: name
    },
    usedIds: usedGeneratedIds
  });
  const properties = record.properties;
  const parentField = collection?.hierarchy?.parent_field;
  if (parentField) properties[parentField] = null;

  const id = uniqueFilenameStem(
    collection?.slug
      ? renderSlugTemplate(collection.slug, {
          fields: properties,
          identifierField:
            collection.identifier_field || creation.fieldName,
          date
        })
      : name,
    new Set(items.map((item) => item.id))
  );
  record.id = id;
  if (optionForItem && !optionForItem(record)) {
    throw new Error("The new item would not provide a usable reference value.");
  }
  return record;
}

async function createOrReuseReferencedRecord({
  adapter,
  label,
  collection,
  nodeTypes,
  labelField,
  allowedTypes,
  items = [],
  date = new Date(),
  optionForItem
}) {
  const existing = matchingReferenceOption(items, optionForItem, label);
  if (existing) {
    return { created: false, item: existing.item, items, option: existing };
  }

  async function create(currentItems) {
    const record = createReferencedRecord({
      label,
      collection,
      nodeTypes,
      labelField,
      allowedTypes,
      items: currentItems,
      date,
      optionForItem
    });
    const result = await adapter.create(collection.name, record);
    const returnedItem = result?.item ?? record;
    const option = optionForItem(returnedItem) ?? optionForItem(record);
    if (!option) {
      throw new Error("The created item did not return a usable reference value.");
    }
    const item = option.item;
    return {
      created: true,
      item,
      items: [
        ...currentItems.filter((current) => current.id !== item.id),
        item
      ],
      option
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
    const concurrent = matchingReferenceOption(
      refreshedItems,
      optionForItem,
      label
    );
    if (concurrent) {
      return {
        created: false,
        item: concurrent.item,
        items: refreshedItems,
        option: concurrent
      };
    }
    return create(refreshedItems);
  }
}

function referenceValueAfterSelection(value, nextReference) {
  const current = normalizeReferenceValue(value);
  return nextReference === current.ref
    ? compactReferenceValue(current)
    : nextReference;
}

function referenceImageSource(item, view, collection) {
  const field =
    typeof view?.image === "string" ? view.image.trim() : "";
  if (!field) return null;
  const value = referenceItemValue(item, field, collection);
  return imageAssetValue(value) ??
    (typeof value === "string" && value ? value : null);
}

function referenceSelectionDefinitions(field, collection) {
  const published = collection?.views?.reference?.selections;
  if (!isMapping(published) || !Array.isArray(field?.selections)) return [];
  const enabled = new Set(field.selections);
  return Object.entries(published).flatMap(([name, definition]) =>
    enabled.has(name) && isMapping(definition)
      ? [{ ...definition, name }]
      : []
  );
}

function nestedValue(value, path) {
  if (!path) return value;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => current?.[segment], value);
}

function referenceSelectionOptions(item, definition, collection) {
  const options = definition?.options;
  if (!isMapping(options) || typeof options.field !== "string") return [];
  const source = referenceItemValue(item, options.field, collection);
  const candidates = nestedValue(source, options.path);
  if (!Array.isArray(candidates)) return [];
  const valueField = options.value || "id";
  const labelField = options.label || "label";
  const seenValues = new Set();
  return candidates.flatMap((candidate) => {
    if (!isMapping(candidate)) return [];
    const value = candidate[valueField];
    if (
      typeof value !== "string" ||
      !value ||
      seenValues.has(value)
    ) {
      return [];
    }
    seenValues.add(value);
    const label = candidate[labelField];
    return [{
      value,
      label: typeof label === "string" && label ? label : value,
      item: candidate
    }];
  });
}

export {
  compactReferenceValue,
  createOrReuseReferencedRecord,
  createReferencedRecord,
  createReferencedRecordDraft,
  hasReferenceValue,
  matchingReferenceOption,
  normalizeReferenceValue,
  normalizeReferenceValues,
  normalizedReferenceLabel,
  referenceCreationConfig,
  referenceRecordCreationConfig,
  referenceImageSource,
  referenceItemLabel,
  referenceItemValue,
  referencePickerOption,
  referenceSelectionDefinitions,
  referenceSelectionOptions,
  referenceValueAfterSelection,
  referenceValuesAfterAdd,
  referenceValuesAfterToggle,
  storeReferencedRecordDraft,
  validateReferencedRecordDraft
};
