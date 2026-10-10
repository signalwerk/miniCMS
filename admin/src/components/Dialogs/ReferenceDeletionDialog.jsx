import { useState } from "react";
import { ConfirmationDialog } from "./Dialogs.jsx";
import {
  deletionItemLabel,
  replacementChoices,
} from "../../model/referenceDeletion.js";

export function ReferenceDeletionDialog({
  usagePlan: plan,
  config,
  description,
  onResolve,
  ...props
}) {
  const [resolutions, setResolutions] = useState({});
  const usedTargets = plan.targets.filter((target) =>
    plan.records.some((entry) =>
      entry.usages.some((u) => u.targetId === target.id),
    ),
  );
  return (
    <ConfirmationDialog
      {...props}
      title="Resolve links before deleting"
      description={`${plan.records.length} ${plan.records.length === 1 ? "record uses" : "records use"} the selected items. ${description}`}
      confirmLabel="Update links and delete"
      onConfirm={() => {
        if (usedTargets.some((target) => !resolutions[target.id]))
          throw new Error(
            "Choose a replacement or remove links for every used item.",
          );
        return onResolve(resolutions);
      }}
    >
      {usedTargets.map((target) => (
        <label key={target.id} className="reference-deletion-choice">
          <span>
            {deletionItemLabel(target, config, plan.targetCollection)}
          </span>
          <select
            value={resolutions[target.id] || ""}
            onChange={(event) =>
              setResolutions((current) => ({
                ...current,
                [target.id]: event.target.value,
              }))
            }
          >
            <option value="">Choose how to resolve links…</option>
            <option value="remove">Remove links</option>
            {replacementChoices(plan, config, target.id).map((item) => (
              <option key={item.id} value={item.id}>
                Replace with{" "}
                {deletionItemLabel(item, config, plan.targetCollection)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <details className="reference-deletion-usage">
        <summary>Show linked records ({plan.records.length})</summary>
        <ul>
          {plan.records.map((entry) => (
            <li key={`${entry.collection}/${entry.record.id}`}>
              {config.collections[entry.collection].label || entry.collection}:{" "}
              {deletionItemLabel(entry.record, config, entry.collection)}
              {" — "}
              {[
                ...new Set(
                  entry.usages.map((u) => u.field.label || u.fieldName),
                ),
              ].join(", ")}
            </li>
          ))}
        </ul>
      </details>
    </ConfirmationDialog>
  );
}
