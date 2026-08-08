const REFERENCE_SET_DEFAULTS = Object.freeze({
  scope: "document",
  order: "first_occurrence",
  deduplicate: true,
  number_style: "decimal",
  backlinks: "all"
});

function eachInlineReference(config, visit) {
  for (const type of Object.values(config.node_types ?? {})) {
    for (const field of Object.values(type.fields ?? {})) {
      const inlineReference = field.blocknote?.inline_reference;
      if (field.widget === "markdown" && inlineReference) {
        visit(inlineReference);
      }
    }
  }
}

function compatibleReferenceSetEntries(referenceSets, collection) {
  return Object.entries(referenceSets ?? {}).filter(([, referenceSet]) =>
    referenceSet.collections?.includes(collection)
  );
}

function reconcileInlineReferenceSet(inlineReference, referenceSets) {
  if (
    inlineReference?.reference_set &&
    !referenceSets?.[inlineReference.reference_set]?.collections?.includes(
      inlineReference.collection
    )
  ) {
    delete inlineReference.reference_set;
  }
}

function removeReferenceSet(config, setKey) {
  if (!config.site?.reference_sets?.[setKey]) return false;
  delete config.site.reference_sets[setKey];
  if (!Object.keys(config.site.reference_sets).length) {
    delete config.site.reference_sets;
  }
  eachInlineReference(config, (inlineReference) => {
    if (inlineReference.reference_set === setKey) {
      delete inlineReference.reference_set;
    }
  });
  return true;
}

function setReferenceSetCollections(config, setKey, collections) {
  const referenceSet = config.site?.reference_sets?.[setKey];
  if (!referenceSet || !collections.length) return false;
  referenceSet.collections = [...new Set(collections)];
  eachInlineReference(config, (inlineReference) => {
    if (
      inlineReference.reference_set === setKey &&
      !referenceSet.collections.includes(inlineReference.collection)
    ) {
      delete inlineReference.reference_set;
    }
  });
  return true;
}

export {
  REFERENCE_SET_DEFAULTS,
  compatibleReferenceSetEntries,
  reconcileInlineReferenceSet,
  removeReferenceSet,
  setReferenceSetCollections
};
