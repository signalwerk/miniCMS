import test from "node:test";
import assert from "node:assert/strict";
import {
  compatibleReferenceSetEntries,
  reconcileInlineReferenceSet,
  removeReferenceSet,
  setReferenceSetCollections
} from "./referenceSets.js";

function fixture() {
  return {
    site: {
      reference_sets: {
        footnotes: {
          collections: ["sources"],
          item_template: "{{record.properties.title}}"
        },
        mentions: {
          collections: ["sources", "people"],
          item_template: "{{record.properties.name}}"
        }
      }
    },
    node_types: {
      text: {
        fields: {
          body: {
            widget: "markdown",
            blocknote: {
              inline_reference: {
                collection: "sources",
                reference_set: "footnotes"
              }
            }
          },
          author: {
            widget: "markdown",
            blocknote: {
              inline_reference: {
                collection: "people",
                reference_set: "mentions"
              }
            }
          }
        }
      }
    }
  };
}

test("reference-set dependency helpers preserve and reset inline bindings", () => {
  const config = fixture();
  assert.deepEqual(
    compatibleReferenceSetEntries(config.site.reference_sets, "sources").map(
      ([key]) => key
    ),
    ["footnotes", "mentions"]
  );

  assert.equal(
    setReferenceSetCollections(config, "mentions", ["sources"]),
    true
  );
  assert.equal(
    config.node_types.text.fields.author.blocknote.inline_reference.reference_set,
    undefined
  );

  assert.equal(removeReferenceSet(config, "footnotes"), true);
  assert.equal(
    config.node_types.text.fields.body.blocknote.inline_reference.reference_set,
    undefined
  );
});

test("an inline binding is retained only while its set accepts the collection", () => {
  const referenceSets = fixture().site.reference_sets;
  const inlineReference = {
    collection: "sources",
    reference_set: "footnotes"
  };
  reconcileInlineReferenceSet(inlineReference, referenceSets);
  assert.equal(inlineReference.reference_set, "footnotes");

  inlineReference.collection = "people";
  reconcileInlineReferenceSet(inlineReference, referenceSets);
  assert.equal(inlineReference.reference_set, undefined);
});
