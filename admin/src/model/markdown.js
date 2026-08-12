import { isInlineLinkUrl } from "../../../core/inline-link.js";
import { isInlineReferenceUrl } from "../../../core/inline-reference.js";
import {
  createOrReuseReferencedRecord,
  createReferencedRecord,
  matchingReferenceOption,
  normalizedReferenceLabel,
  referenceCreationConfig,
  referenceItemValue
} from "./reference.js";

function scalarText(value) {
  return ["string", "number", "boolean"].includes(typeof value)
    ? String(value)
    : "";
}

function inlineCollectionOption(item, collection, previewField) {
  const referenceView = collection?.views?.reference ?? {};
  const referenceValue = referenceItemValue(
    item,
    referenceView.value || "id",
    collection
  );
  if (typeof referenceValue !== "string" || !referenceValue) return null;

  const configuredLabel = previewField
    ? scalarText(referenceItemValue(item, previewField, collection))
    : "";
  const collectionLabel = referenceView.title
    ? scalarText(referenceItemValue(item, referenceView.title, collection))
    : "";
  const label =
    configuredLabel ||
    collectionLabel ||
    scalarText(item?.title) ||
    scalarText(item?.id) ||
    referenceValue;
  const propertyText = Object.values(item?.properties ?? {})
    .map(scalarText)
    .filter(Boolean)
    .join(" ");
  const topLevelText = Object.entries(item ?? {})
    .filter(([name]) => !["properties", "slots"].includes(name))
    .map(([, value]) => scalarText(value))
    .filter(Boolean)
    .join(" ");

  return {
    item,
    label,
    recordId: scalarText(item?.id) || referenceValue,
    searchText: `${label} ${topLevelText} ${propertyText}`
      .toLocaleLowerCase(),
    value: referenceValue
  };
}

function inlineReferenceOption(item, collection, previewField) {
  return inlineCollectionOption(item, collection, previewField);
}

function inlineReferenceOptions(items, collection, previewField) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const option = inlineReferenceOption(item, collection, previewField);
    return option ? [option] : [];
  });
}

function configuredInlineLinkCollections(blocknote, collections) {
  const configured = blocknote?.internal_links?.collections;
  if (!Array.isArray(configured)) return [];

  const collectionsByName = new Map(
    (Array.isArray(collections) ? collections : [])
      .filter((collection) => typeof collection?.name === "string")
      .map((collection) => [collection.name, collection])
  );
  const seen = new Set();
  return configured.flatMap((collectionName) => {
    if (typeof collectionName !== "string" || seen.has(collectionName)) {
      return [];
    }
    seen.add(collectionName);
    const collection = collectionsByName.get(collectionName);
    return collection ? [collection] : [];
  });
}

function configuredInlineLinkCollectionNames(blocknote) {
  const configured = blocknote?.internal_links?.collections;
  if (!Array.isArray(configured)) return [];
  return [...new Set(
    configured.filter(
      (collectionName) =>
        typeof collectionName === "string" && collectionName.length > 0
    )
  )];
}

function inlineLinkOption(item, collection) {
  return inlineCollectionOption(item, collection);
}

function inlineLinkOptions(items, collection) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const option = inlineLinkOption(item, collection);
    return option ? [option] : [];
  });
}

function filteredInlineLinkOptions(options, search, limit = 100) {
  const normalizedSearch = String(search ?? "").trim().toLocaleLowerCase();
  const matches = (Array.isArray(options) ? options : []).filter(
    (option) =>
      !normalizedSearch || option.searchText.includes(normalizedSearch)
  );
  const normalizedLimit = Number.isSafeInteger(limit) && limit > 0
    ? limit
    : 100;
  return {
    items: matches.slice(0, normalizedLimit),
    limited: matches.length > normalizedLimit,
    total: matches.length
  };
}

function normalizedInlineReferenceLabel(value) {
  return normalizedReferenceLabel(value);
}

function inlineReferenceCreationConfig(collection, nodeTypes, previewField) {
  return referenceCreationConfig(collection, nodeTypes, {
    labelField: previewField
  });
}

function matchingInlineReference(items, collection, previewField, label) {
  return matchingReferenceOption(
    items,
    (item) => inlineReferenceOption(item, collection, previewField),
    label
  );
}

function createInlineReferenceRecord({
  label,
  collection,
  nodeTypes,
  previewField,
  items = [],
  date = new Date()
}) {
  return createReferencedRecord({
    label,
    collection,
    nodeTypes,
    labelField: previewField,
    items,
    date,
    optionForItem: (item) =>
      inlineReferenceOption(item, collection, previewField)
  });
}

async function createOrReuseInlineReference({
  adapter,
  label,
  collection,
  nodeTypes,
  previewField,
  items = [],
  date = new Date()
}) {
  return createOrReuseReferencedRecord({
    adapter,
    label,
    collection,
    nodeTypes,
    labelField: previewField,
    items,
    date,
    optionForItem: (item) =>
      inlineReferenceOption(item, collection, previewField)
  });
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeInlineReferenceLabelText(text) {
  return text.replace(/[\\[\]]/g, "\\$&");
}

function markdownSafeInlineReferences(value, insideReference = false) {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      markdownSafeInlineReferences(entry, insideReference)
    );
  }
  if (!isMapping(value)) return value;

  const nextInsideReference =
    insideReference ||
    (value.type === "link" &&
      (isInlineReferenceUrl(value.href) || isInlineLinkUrl(value.href)));
  const result = Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [
      name,
      markdownSafeInlineReferences(entry, nextInsideReference)
    ])
  );
  if (
    insideReference &&
    value.type === "text" &&
    typeof value.text === "string" &&
    value.styles?.code !== true
  ) {
    result.text = escapeInlineReferenceLabelText(value.text);
  }
  return result;
}

function blocksToMarkdownWithSafeReferences(editor, blocks) {
  return editor.blocksToMarkdownLossy(markdownSafeInlineReferences(blocks));
}

export {
  blocksToMarkdownWithSafeReferences,
  configuredInlineLinkCollectionNames,
  configuredInlineLinkCollections,
  createInlineReferenceRecord,
  createOrReuseInlineReference,
  escapeInlineReferenceLabelText,
  filteredInlineLinkOptions,
  inlineReferenceCreationConfig,
  inlineLinkOption,
  inlineLinkOptions,
  inlineReferenceOption,
  inlineReferenceOptions,
  markdownSafeInlineReferences,
  matchingInlineReference,
  normalizedInlineReferenceLabel
};
