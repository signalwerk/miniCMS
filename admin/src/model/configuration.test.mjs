import assert from "node:assert/strict";
import test from "node:test";
import {
  createContentTypeDefinition,
  createSchemaOperations,
  deleteSchemaEntryOperation,
  duplicateSchemaEntry,
  markSchemaEntryFresh,
  renameSchemaEntry,
  schemaRenameError,
  siblingFolder
} from "./configuration.js";

function fixture() {
  return {
    site: {
      media_folder: "content/media",
      reference_sets: {
        notes: {
          collections: ["sources", "people"],
          item_template: "{{record.properties.title}}"
        }
      }
    },
    node_types: {
      page: {
        label: "Pages",
        fields: {
          source: {
            widget: "reference",
            collection: "sources",
            allowed_types: ["source", "quote"]
          },
          tags: { widget: "tags", collection: "sources" },
          body: {
            widget: "markdown",
            blocknote: {
              inline_reference: { collection: "sources" }
            }
          }
        },
        slots: {
          content: { allowed_types: ["quote", "source"] }
        }
      },
      source: {
        label: "Source",
        fields: { title: { label: "Title", widget: "string" } }
      },
      quote: {
        label: "Quote",
        fields: { text: { label: "Text", widget: "text" } }
      },
      media_image: {
        connector: "central",
        remote_type: "image",
        label: "Image",
        fields: { file: { label: "File", widget: "image" } }
      }
    },
    collections: {
      pages: {
        label: "Pages",
        label_singular: "Page",
        folder: "content/pages",
        node_type: "page",
        allowed_types: ["page", "quote"],
        hierarchy: { allowed_child_types: ["page", "quote"] }
      },
      sources: {
        label: "Sources",
        label_singular: "Source",
        folder: "content/research/sources",
        node_type: "source",
        allowed_types: ["source", "quote"]
      },
      people: {
        label: "People",
        label_singular: "Person",
        folder: "content/people",
        node_type: "source"
      },
      images: {
        connector: "central",
        remote_collection: "library",
        label: "Images",
        label_singular: "Image",
        folder: "content/images",
        node_type: "media_image",
        allowed_types: ["media_image"]
      }
    }
  };
}

test("creates local content types with ID and Title fields", () => {
  const definition = createContentTypeDefinition({
    key: "article",
    label: "Article"
  });
  assert.deepEqual(Object.keys(definition.fields), ["content_id", "title"]);
  assert.deepEqual(
    definition,
    {
      label: "Article",
      kind: "content",
      icon: "file-text",
      fields: {
        content_id: {
          label: "ID",
          widget: "id",
          readonly: true,
          required: true
        },
        title: {
          label: "Title",
          widget: "string",
          required: true
        }
      }
    }
  );
});

test("creates connector-owned content types with the same default fields", () => {
  assert.deepEqual(
    createContentTypeDefinition({
      key: "article",
      label: "Article",
      connector: "central"
    }),
    {
      connector: "central",
      remote_type: "article",
      label: "Article",
      kind: "content",
      icon: "file-text",
      fields: {
        content_id: {
          label: "ID",
          widget: "id",
          readonly: true,
          required: true
        },
        title: {
          label: "Title",
          widget: "string",
          required: true
        }
      }
    }
  );
});

test("duplicates content types deeply and inserts numbered copies after the source", () => {
  const source = fixture();
  let operations = createSchemaOperations();
  const first = duplicateSchemaEntry(
    source,
    operations,
    "node_types",
    "source"
  );
  operations = first.operations;
  assert.equal(first.key, "source-copy");
  assert.deepEqual(Object.keys(first.config.node_types), [
    "page",
    "source",
    "source-copy",
    "quote",
    "media_image"
  ]);
  assert.equal(first.config.node_types[first.key].label, "Source copy");
  assert.deepEqual(
    first.config.node_types[first.key].fields,
    source.node_types.source.fields
  );
  first.config.node_types[first.key].fields.title.label = "Changed";
  assert.equal(source.node_types.source.fields.title.label, "Title");

  const second = duplicateSchemaEntry(
    first.config,
    operations,
    "node_types",
    "source"
  );
  assert.equal(second.key, "source-copy2");
  assert.equal(second.config.node_types[second.key].label, "Source copy 2");
  assert.equal(second.operations.freshEntries.node_types[second.key], true);
  assert.deepEqual(second.operations.schemaRenames.node_types, {});
});

test("duplicates collections without records into a distinct sibling folder", () => {
  const source = fixture();
  const first = duplicateSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "sources"
  );
  assert.equal(first.key, "sources-copy");
  assert.deepEqual(Object.keys(first.config.collections), [
    "pages",
    "sources",
    "sources-copy",
    "people",
    "images"
  ]);
  assert.equal(first.config.collections[first.key].label, "Sources copy");
  assert.equal(
    first.config.collections[first.key].label_singular,
    "Source copy"
  );
  assert.equal(
    first.config.collections[first.key].folder,
    "content/research/sources-copy"
  );
  assert.deepEqual(
    first.config.collections[first.key].allowed_types,
    ["source", "quote"]
  );
  assert.equal(source.collections["sources-copy"], undefined);
});

test("duplicate keys skip local, folder, and remote-identity conflicts", () => {
  const source = fixture();
  source.collections.occupied = {
    label: "Occupied",
    folder: "content/research/sources-copy",
    node_type: "source"
  };
  source.node_types.existing_remote = {
    connector: "central",
    remote_type: "media_image-copy",
    label: "Existing",
    fields: {}
  };
  source.collections.existing_remote = {
    connector: "central",
    remote_collection: "images-copy",
    label: "Existing remote",
    label_singular: "Existing remote",
    folder: "content/other",
    node_type: "media_image"
  };

  const collectionCopy = duplicateSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "sources"
  );
  assert.equal(collectionCopy.key, "sources-copy2");
  assert.equal(
    collectionCopy.config.collections[collectionCopy.key].folder,
    "content/research/sources-copy2"
  );

  const typeCopy = duplicateSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "media_image"
  );
  assert.equal(typeCopy.key, "media_image-copy2");
  assert.equal(
    typeCopy.config.node_types[typeCopy.key].remote_type,
    "media_image-copy2"
  );

  const remoteCollectionCopy = duplicateSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "images"
  );
  assert.equal(remoteCollectionCopy.key, "images-copy2");
  assert.equal(
    remoteCollectionCopy.config.collections[remoteCollectionCopy.key]
      .remote_collection,
    "images-copy2"
  );
});

test("renames content types in place and rewrites every schema dependency", () => {
  const source = fixture();
  const result = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "quote",
    "quotation"
  );
  assert.deepEqual(Object.keys(result.config.node_types), [
    "page",
    "source",
    "quotation",
    "media_image"
  ]);
  assert.equal(result.config.collections.pages.allowed_types[1], "quotation");
  assert.equal(
    result.config.collections.pages.hierarchy.allowed_child_types[1],
    "quotation"
  );
  assert.equal(result.config.collections.sources.allowed_types[1], "quotation");
  assert.equal(
    result.config.node_types.page.slots.content.allowed_types[0],
    "quotation"
  );
  assert.equal(
    result.config.node_types.page.fields.source.allowed_types[1],
    "quotation"
  );
  assert.deepEqual(result.operations.schemaRenames.node_types, {
    quote: "quotation"
  });
  assert.equal(source.node_types.quote.label, "Quote");
});

test("composes repeated renames, cancels a rename back, and cancels on delete", () => {
  const source = fixture();
  const first = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "quote",
    "quotation"
  );
  const second = renameSchemaEntry(
    first.config,
    first.operations,
    "node_types",
    "quotation",
    "excerpt"
  );
  assert.deepEqual(second.operations.schemaRenames.node_types, {
    quote: "excerpt"
  });
  const back = renameSchemaEntry(
    second.config,
    second.operations,
    "node_types",
    "excerpt",
    "quote"
  );
  assert.deepEqual(back.operations.schemaRenames.node_types, {});
  assert.deepEqual(Object.keys(back.config.node_types), Object.keys(source.node_types));

  const renamedCollection = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "sources",
    "library"
  );
  const deletedRename = deleteSchemaEntryOperation(
    renamedCollection.operations,
    "collections",
    "library"
  );
  assert.deepEqual(deletedRename.schemaRenames.collections, {});
  assert.deepEqual(deletedRename.retiredEntries.collections, {
    sources: true
  });
});

test("reserves deleted persisted origins until their deletion is saved", () => {
  const source = fixture();
  const renamed = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "quote",
    "quotation"
  );
  const afterDelete = structuredClone(renamed.config);
  delete afterDelete.node_types.quotation;
  const operations = deleteSchemaEntryOperation(
    renamed.operations,
    "node_types",
    "quotation"
  );

  assert.match(
    schemaRenameError(
      afterDelete,
      operations,
      "node_types",
      "source",
      "quote"
    ),
    /reserved until the pending deletion is saved/
  );
  assert.equal(
    schemaRenameError(
      afterDelete,
      createSchemaOperations(),
      "node_types",
      "source",
      "quote"
    ),
    ""
  );
});

test("duplicate keys skip retired persisted keys while fresh deletions release theirs", () => {
  const source = fixture();
  source.node_types["source-copy"] = structuredClone(source.node_types.source);
  const afterDelete = structuredClone(source);
  delete afterDelete.node_types["source-copy"];
  const operations = deleteSchemaEntryOperation(
    createSchemaOperations(),
    "node_types",
    "source-copy"
  );
  const duplicate = duplicateSchemaEntry(
    afterDelete,
    operations,
    "node_types",
    "source"
  );
  assert.equal(duplicate.key, "source-copy2");

  const freshOperations = markSchemaEntryFresh(
    createSchemaOperations(),
    "node_types",
    "source-copy"
  );
  const deletedFresh = deleteSchemaEntryOperation(
    freshOperations,
    "node_types",
    "source-copy"
  );
  assert.deepEqual(deletedFresh.retiredEntries.node_types, {});
});

test("renames concrete collections, their folders, and collection dependencies", () => {
  const source = fixture();
  const result = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "sources",
    "library"
  );
  assert.deepEqual(Object.keys(result.config.collections), [
    "pages",
    "library",
    "people",
    "images"
  ]);
  assert.equal(
    result.config.collections.library.folder,
    "content/research/library"
  );
  assert.equal(result.config.node_types.page.fields.source.collection, "library");
  assert.equal(result.config.node_types.page.fields.tags.collection, "library");
  assert.equal(
    result.config.node_types.page.fields.body.blocknote.inline_reference.collection,
    "library"
  );
  assert.deepEqual(result.config.site.reference_sets.notes.collections, [
    "library",
    "people"
  ]);
  assert.deepEqual(result.operations.schemaRenames.collections, {
    sources: "library"
  });
});

test("persisted remote alias renames preserve remote identity and folder", () => {
  const source = fixture();
  const typeResult = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "media_image",
    "picture"
  );
  assert.equal(typeResult.config.node_types.picture.remote_type, "image");
  assert.deepEqual(typeResult.operations.schemaRenames.node_types, {
    media_image: "picture"
  });

  const collectionResult = renameSchemaEntry(
    typeResult.config,
    typeResult.operations,
    "collections",
    "images",
    "pictures"
  );
  assert.equal(
    collectionResult.config.collections.pictures.remote_collection,
    "library"
  );
  assert.equal(collectionResult.config.collections.pictures.folder, "content/images");
  assert.equal(collectionResult.config.collections.pictures.node_type, "picture");
});

test("renaming an unsaved remote duplicate updates its new owner identity and folder", () => {
  const source = fixture();
  const duplicate = duplicateSchemaEntry(
    source,
    createSchemaOperations(),
    "collections",
    "images"
  );
  const renamed = renameSchemaEntry(
    duplicate.config,
    duplicate.operations,
    "collections",
    duplicate.key,
    "illustrations"
  );
  assert.equal(
    renamed.config.collections.illustrations.remote_collection,
    "illustrations"
  );
  assert.equal(
    renamed.config.collections.illustrations.folder,
    "content/illustrations"
  );
  assert.equal(renamed.operations.freshEntries.collections.illustrations, true);
  assert.deepEqual(renamed.operations.schemaRenames.collections, {});

  const typeDuplicate = duplicateSchemaEntry(
    renamed.config,
    renamed.operations,
    "node_types",
    "media_image"
  );
  const typeRenamed = renameSchemaEntry(
    typeDuplicate.config,
    typeDuplicate.operations,
    "node_types",
    typeDuplicate.key,
    "illustration"
  );
  assert.equal(typeRenamed.config.node_types.illustration.remote_type, "illustration");
  assert.deepEqual(typeRenamed.operations.schemaRenames.node_types, {});
});

test("newly created schema entries can rename before save without a storage plan", () => {
  const source = fixture();
  source.collections.new_collection = {
    label: "New collection",
    label_singular: "New collection",
    folder: "content/new_collection",
    node_type: "source"
  };
  const operations = markSchemaEntryFresh(
    createSchemaOperations(),
    "collections",
    "new_collection"
  );
  const result = renameSchemaEntry(
    source,
    operations,
    "collections",
    "new_collection",
    "new-library"
  );
  assert.equal(
    result.config.collections["new-library"].folder,
    "content/new-library"
  );
  assert.deepEqual(result.operations.schemaRenames.collections, {});
  assert.equal(result.operations.freshEntries.collections["new-library"], true);
});

test("rename validation rejects unsafe keys and key, folder, media, and plan conflicts", () => {
  const source = fixture();
  assert.match(
    schemaRenameError(
      source,
      createSchemaOperations(),
      "collections",
      "sources",
      ".unsafe"
    ),
    /letters, numbers/
  );
  assert.match(
    schemaRenameError(
      source,
      createSchemaOperations(),
      "collections",
      "sources",
      "pages"
    ),
    /already exists/
  );
  assert.match(
    schemaRenameError(
      source,
      createSchemaOperations(),
      "collections",
      "pages",
      "media"
    ),
    /media folder/
  );

  const withFolderConflict = fixture();
  withFolderConflict.collections.other = {
    folder: "content/research/library/children",
    node_type: "source"
  };
  assert.match(
    schemaRenameError(
      withFolderConflict,
      createSchemaOperations(),
      "collections",
      "sources",
      "library"
    ),
    /conflicts with collection/
  );

  const first = renameSchemaEntry(
    source,
    createSchemaOperations(),
    "node_types",
    "quote",
    "quotation"
  );
  const second = renameSchemaEntry(
    first.config,
    first.operations,
    "node_types",
    "source",
    "origin"
  );
  assert.match(
    schemaRenameError(
      second.config,
      second.operations,
      "node_types",
      "quotation",
      "source"
    ),
    /reserved by another pending rename/
  );
});

test("derives a replacement folder from the source folder's parent", () => {
  assert.equal(siblingFolder("content/articles", "news"), "content/news");
  assert.equal(
    siblingFolder("content/research/articles/", "news"),
    "content/research/news"
  );
});
