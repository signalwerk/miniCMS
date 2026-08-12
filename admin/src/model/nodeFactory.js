import {
  ID_PATTERN,
  createId,
  isGeneratedIdWidget
} from "../../../core/id.js";
import { slugFromSources } from "../../../core/slug.js";

function optionValue(option) {
  return option && typeof option === "object" ? option.value : option;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function defaultFieldValue(field, generateId = false, usedIds) {
  if (
    field.widget === "tags" ||
    (field.widget === "reference" && field.multiple === true)
  ) {
    return [];
  }
  let value = generateId && isGeneratedIdWidget(field.widget)
    ? createId(usedIds)
    : cloneValue(field.default);
  if (value === undefined && isGeneratedIdWidget(field.widget)) value = "";
  if (value === undefined && field.widget === "boolean") value = false;
  if (value === undefined && field.widget === "select") {
    value = field.required === true
      ? cloneValue(optionValue(field.options?.[0])) ?? ""
      : "";
  }
  return value === undefined ? "" : value;
}

function defaultProperties(type, usedIds) {
  return Object.fromEntries(
    Object.entries(type?.fields ?? {}).map(([name, field]) => [
      name,
      defaultFieldValue(field, true, usedIds)
    ])
  );
}

function populateInitialSlugFields(type, properties) {
  const nextProperties = structuredClone(properties ?? {});
  for (const [name, field] of Object.entries(type?.fields ?? {})) {
    if (field.widget !== "slug" || nextProperties[name]) continue;
    nextProperties[name] = slugFromSources(field.sources, nextProperties);
  }
  return nextProperties;
}

function updateCreationProperties(type, properties, fieldName, value) {
  const previous = structuredClone(properties ?? {});
  const next = { ...previous, [fieldName]: value };
  for (const [name, field] of Object.entries(type?.fields ?? {})) {
    if (field.widget !== "slug" || name === fieldName) continue;
    const currentSlug = previous[name] ?? "";
    const previousGenerated = slugFromSources(field.sources, previous);
    if (currentSlug === "" || currentSlug === previousGenerated) {
      next[name] = slugFromSources(field.sources, next);
    }
  }
  return next;
}

function instantiateNode(
  typeName,
  nodeTypes,
  {
    id,
    order,
    properties,
    usedIds = new Set()
  } = {}
) {
  const type = nodeTypes?.[typeName];
  if (!type) throw new Error(`Unknown content type "${typeName}".`);

  const propertyOverrides = properties === undefined
    ? {}
    : structuredClone(properties);
  if (id !== undefined && id) {
    if (usedIds.has(id)) {
      throw new Error(`Content ID "${id}" is already in use.`);
    }
    usedIds.add(id);
  }
  for (const [fieldName, field] of Object.entries(type.fields ?? {})) {
    if (
      isGeneratedIdWidget(field.widget) &&
      typeof propertyOverrides[fieldName] === "string"
    ) {
      if (!ID_PATTERN.test(propertyOverrides[fieldName])) {
        throw new Error(
          `Generated ID field "${typeName}.${fieldName}" is invalid.`
        );
      }
      if (
        usedIds.has(propertyOverrides[fieldName]) &&
        propertyOverrides[fieldName] !== id
      ) {
        throw new Error(
          `Generated ID "${propertyOverrides[fieldName]}" is already in use.`
        );
      }
      usedIds.add(propertyOverrides[fieldName]);
    }
  }

  const nodeProperties = populateInitialSlugFields(type, {
    ...defaultProperties(type, usedIds),
    ...propertyOverrides
  });
  const node = {
    id: id === undefined ? createId(usedIds) : id,
    type: typeName,
    properties: nodeProperties
  };
  if (order !== undefined) node.order = order;

  node.slots = Object.fromEntries(
    Object.entries(type.slots ?? {}).map(([slotName, slot]) => [
      slotName,
      (slot.default ?? []).map((template) =>
        instantiateNode(template.type, nodeTypes, {
          properties: template.properties,
          usedIds
        })
      )
    ])
  );
  return node;
}

function firstSeededDescendant(node) {
  for (const children of Object.values(node?.slots ?? {})) {
    for (const child of children) {
      return child;
    }
  }
  return null;
}

export {
  defaultFieldValue,
  defaultProperties,
  firstSeededDescendant,
  instantiateNode,
  populateInitialSlugFields,
  updateCreationProperties
};
