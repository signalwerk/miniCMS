import { validateRecord } from "../../../core/content.js";
import {
  buildInlineLinkUrl,
  parseInlineLinkUrl,
  markdownLinkOccurrencesInMarkdown,
  rewriteMarkdownLinks,
} from "../../../core/inline-link.js";
import {
  buildInlineReferenceUrl,
  parseInlineReferenceUrl,
} from "../../../core/inline-reference.js";
import {
  normalizeReferenceValue,
  referenceItemValue,
  referenceItemLabel,
} from "./reference.js";

function visit(record, callback) {
  callback(record);
  for (const children of Object.values(record.slots ?? {}))
    for (const child of children) visit(child, callback);
}
function relatedCollections(field) {
  return [
    ...(["reference", "tags"].includes(field.widget) ? [field.collection] : []),
    ...(field.widget === "url"
      ? (field.internal_links?.collections ?? [])
      : []),
    ...(field.widget === "markdown"
      ? [
          field.blocknote?.inline_reference?.collection,
          ...(field.blocknote?.internal_links?.collections ?? []),
        ]
      : []),
  ].filter(Boolean);
}
function collectionCanReference(config, collection, target) {
  const seen = new Set();
  function check(typeName) {
    if (seen.has(typeName)) return false;
    seen.add(typeName);
    const type = config.node_types[typeName];
    return (
      Object.values(type?.fields ?? {}).some((field) =>
        relatedCollections(field).includes(target),
      ) ||
      Object.values(type?.slots ?? {}).some((slot) =>
        (slot.allowed_types ?? []).some(check),
      )
    );
  }
  return (collection.allowed_types ?? [collection.node_type]).some(check);
}
function targetValue(record, field, config, targetCollection) {
  const collection = config.collections[targetCollection];
  return referenceItemValue(
    record,
    field.widget === "tags"
      ? collection.views?.reference?.value || "id"
      : field.value_field || collection.views?.reference?.value || "id",
    collection,
  );
}
function matchesReference(value, target) {
  return (
    value !== "" && value !== undefined && value !== null && value === target
  );
}
function matchingUsages(record, config, targetCollection, targets) {
  const usages = [];
  visit(record, (node) => {
    for (const [name, field] of Object.entries(
      config.node_types[node.type]?.fields ?? {},
    )) {
      if (!relatedCollections(field).includes(targetCollection)) continue;
      const value = node.properties?.[name];
      for (const target of targets) {
        const ref = targetValue(target, field, config, targetCollection);
        let count = 0;
        if (
          ["reference", "tags"].includes(field.widget) &&
          field.collection === targetCollection
        ) {
          count =
            field.multiple || field.widget === "tags"
              ? Array.isArray(value)
                ? value.filter((v) => matchesReference(v, ref)).length
                : 0
              : Number(
                  matchesReference(normalizeReferenceValue(value).ref, ref),
                );
        } else if (field.widget === "url") {
          const link = parseInlineLinkUrl(value);
          count = Number(
            link?.collection === targetCollection &&
              matchesReference(link.ref, String(ref)),
          );
        } else if (field.widget === "markdown") {
          count = markdownLinkOccurrencesInMarkdown(value).filter((o) => {
            const parsed =
              parseInlineReferenceUrl(o.href) || parseInlineLinkUrl(o.href);
            return (
              parsed?.collection === targetCollection &&
              matchesReference(parsed.ref, String(ref)) &&
              (parseInlineReferenceUrl(o.href)
                ? field.blocknote?.inline_reference?.collection ===
                  targetCollection
                : field.blocknote?.internal_links?.collections?.includes(
                    targetCollection,
                  ))
            );
          }).length;
        }
        if (count)
          usages.push({
            nodeId: node.id,
            fieldName: name,
            field,
            targetId: target.id,
            count,
          });
      }
    }
  });
  return usages;
}

async function mapLimited(items, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await callback(items[index]);
      }
    }),
  );
  return results;
}

export async function inspectDeletionUsage(api, config, targetCollection, ids) {
  const targets = [];
  for (const id of ids) targets.push(await api.record(targetCollection, id));
  const records = [];
  for (const [name, collection] of Object.entries(config.collections)) {
    if (!collectionCanReference(config, collection, targetCollection)) continue;
    const listing = await api.list(name);
    const scanned = await mapLimited(
      listing.items.filter(
        (summary) => !(name === targetCollection && ids.has(summary.id)),
      ),
      async (summary) => {
        // Summaries omit nested content; always load the complete record.
        const record = await api.record(name, summary.id);
        const usages = matchingUsages(
          record,
          config,
          targetCollection,
          targets,
        );
        return usages.length ? { collection: name, record, usages } : null;
      },
    );
    records.push(...scanned.filter(Boolean));
  }
  const listing = await api.list(targetCollection);
  const candidates = listing.items.filter((item) => !ids.has(item.id));
  return { targetCollection, ids: [...ids], targets, records, candidates };
}

export function replacementChoices(plan, config, targetId) {
  return plan.candidates.filter((candidate) =>
    plan.records.every((entry) =>
      entry.usages
        .filter((u) => u.targetId === targetId)
        .every((u) => {
          const value = targetValue(
            candidate,
            u.field,
            config,
            plan.targetCollection,
          );
          return (
            value !== "" &&
            value !== undefined &&
            value !== null &&
            (!u.field.allowed_types ||
              u.field.allowed_types.includes(candidate.type))
          );
        }),
    ),
  );
}

export function planReferenceRepairs(plan, config, resolutions, replacements) {
  const targetById = new Map(plan.targets.map((r) => [r.id, r]));
  return plan.records.map((entry) => {
    const next = structuredClone(entry.record);
    visit(next, (node) => {
      for (const [name, field] of Object.entries(
        config.node_types[node.type]?.fields ?? {},
      )) {
        const usages = entry.usages.filter(
          (u) => u.nodeId === node.id && u.fieldName === name,
        );
        if (!usages.length) continue;
        const replace = (old) => {
          const u = usages.find((u) =>
            matchesReference(
              old,
              targetValue(
                targetById.get(u.targetId),
                field,
                config,
                plan.targetCollection,
              ),
            ),
          );
          if (!u) return old;
          const choice = resolutions[u.targetId];
          if (choice === "remove") return "";
          const replacement = replacements[u.targetId];
          if (
            !replacement ||
            plan.ids.includes(replacement.id) ||
            !replacementChoices(plan, config, u.targetId).some(
              (r) => r.id === replacement.id,
            )
          )
            throw new Error(
              "Choose a valid replacement for every linked item.",
            );
          const value = targetValue(
            replacement,
            field,
            config,
            plan.targetCollection,
          );
          if (
            value === "" ||
            value === undefined ||
            value === null ||
            (field.allowed_types &&
              !field.allowed_types.includes(replacement.type))
          )
            throw new Error(
              "The replacement is no longer valid. Check usage again.",
            );
          return value;
        };
        const value = node.properties[name];
        if (field.widget === "reference" || field.widget === "tags") {
          if (field.multiple || field.widget === "tags")
            node.properties[name] = [
              ...new Set(value.map(replace).filter((v) => v !== "")),
            ];
          else
            node.properties[name] = replace(normalizeReferenceValue(value).ref); // Target changes invalidate crop/focus selections.
        } else if (field.widget === "url") {
          const link = parseInlineLinkUrl(value),
            updated = replace(link.ref);
          node.properties[name] =
            updated === ""
              ? ""
              : buildInlineLinkUrl(link.collection, String(updated));
        } else if (field.widget === "markdown") {
          node.properties[name] = rewriteMarkdownLinks(value, (occurrence) => {
            const parsed =
              parseInlineReferenceUrl(occurrence.href) ||
              parseInlineLinkUrl(occurrence.href);
            if (
              parsed?.collection !== plan.targetCollection ||
              !(parseInlineReferenceUrl(occurrence.href)
                ? field.blocknote?.inline_reference?.collection ===
                  plan.targetCollection
                : field.blocknote?.internal_links?.collections?.includes(
                    plan.targetCollection,
                  ))
            )
              return undefined;
            const updated = replace(parsed.ref);
            if (updated === parsed.ref) return undefined;
            if (updated === "") return null;
            return parseInlineReferenceUrl(occurrence.href)
              ? buildInlineReferenceUrl(parsed.collection, String(updated))
              : buildInlineLinkUrl(parsed.collection, String(updated));
          });
        }
        const repaired = node.properties[name];
        if (
          field.required &&
          (repaired === "" || (Array.isArray(repaired) && !repaired.length))
        )
          throw new Error(
            `“${field.label || name}” is required. Choose a replacement instead of removing its link.`,
          );
      }
    });
    validateRecord(
      next,
      { ...config.collections[entry.collection], name: entry.collection },
      config,
    );
    return { collection: entry.collection, before: entry.record, after: next };
  });
}

function sameRecord(left, right) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, canonical(value[k])]),
      );
    return value;
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function usageKey(entry, usage) {
  return JSON.stringify([
    entry.collection,
    entry.record.id,
    usage.nodeId,
    usage.fieldName,
    usage.targetId,
  ]);
}
export async function repairDeletionUsage(api, config, reviewed, resolutions) {
  const fresh = await inspectDeletionUsage(
    api,
    config,
    reviewed.targetCollection,
    new Set(reviewed.ids),
  );
  const approved = new Set(
    reviewed.records.flatMap((e) => e.usages.map((u) => usageKey(e, u))),
  );
  if (
    fresh.records.some((e) =>
      e.usages.some((u) => !approved.has(usageKey(e, u))),
    )
  )
    throw new Error(
      "New links were found. Cancel and check usage again before deleting.",
    );
  const replacements = {};
  for (const target of fresh.targets) {
    const id = resolutions[target.id];
    if (id && id !== "remove")
      replacements[target.id] = await api.record(fresh.targetCollection, id);
  }
  const repairs = planReferenceRepairs(
    fresh,
    config,
    resolutions,
    replacements,
  );
  for (const repair of repairs) {
    const latest = await api.record(repair.collection, repair.before.id);
    if (!sameRecord(latest, repair.before))
      throw new Error("A linked record changed. Cancel and check usage again.");
    await api.save(repair.collection, repair.after);
    const saved = await api.record(repair.collection, repair.before.id);
    if (!sameRecord(saved, repair.after))
      throw new Error(
        "A link update could not be verified. The target was not deleted.",
      );
  }
  const remaining = await inspectDeletionUsage(
    api,
    config,
    reviewed.targetCollection,
    new Set(reviewed.ids),
  );
  if (remaining.records.length)
    throw new Error(
      "Links still exist. The target was not deleted; check usage again.",
    );
  return repairs;
}

export function deletionItemLabel(item, config, name) {
  return referenceItemLabel(
    item,
    config.collections[name].views?.reference,
    config.collections[name],
  );
}
