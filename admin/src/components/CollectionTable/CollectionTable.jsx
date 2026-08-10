import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  Image,
  Plus,
  Search,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./CollectionTable.scss";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import {
  compileFilterExpression,
  countFilterRules,
  createEmptyFilter,
  filterFieldKind
} from "../../model/advancedFilter.js";
import { cx, typeField, typeFields } from "../../model/editor.js";
import { resolveImagePresentation } from "../../model/image.js";
import {
  hasReferenceValue,
  normalizeReferenceValue
} from "../../model/reference.js";
import {
  SYSTEM_FIELD_DEFINITIONS,
  displayValue,
  relationValueKey,
  tableRelationOptions
} from "../../model/views.js";
import {
  EmptyState,
  ExternalUrlLink,
  Spinner
} from "../Common/Common.jsx";
import { AdvancedFilter } from "../AdvancedFilter/AdvancedFilter.jsx";

function getTableValue(item, fieldName, collection) {
  if (!fieldName) return "";
  if (fieldName === "$id") return item.id;
  if (fieldName === "$filename") {
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    return `${item.id}.${extension}`;
  }
  if (fieldName === "$storage_path") {
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    return `${String(collection.folder).replace(/\/$/, "")}/${item.id}.${extension}`;
  }
  if (fieldName === "$updated_at") return item.updated_at;
  if (fieldName === "$created_at") return item.created_at;
  if (fieldName.startsWith("properties.")) {
    return fieldName
      .slice("properties.".length)
      .split(".")
      .reduce((value, key) => value?.[key], item.properties);
  }
  return item.properties?.[fieldName] ?? item[fieldName] ?? "";
}

function configuredTableField(item, column, nodeTypes) {
  const base = column.field.startsWith("$")
    ? SYSTEM_FIELD_DEFINITIONS[column.field] ?? {}
    : typeField(
        nodeTypes[item.type],
        column.field.replace(/^properties\./, "")
      ) ?? {};
  return { ...base, ...column };
}

function relationFieldKey(field) {
  return JSON.stringify([
    field.widget,
    field.collection || "",
    field.value_field || "",
    field.allowed_types ?? []
  ]);
}

function relationPresentationForField(field, presentations) {
  if (!["reference", "tags"].includes(field.widget)) return undefined;
  return presentations?.get(relationFieldKey(field)) ?? {
    options: new Map(),
    loading: true
  };
}

function formatTableValue(
  item,
  column,
  nodeTypes,
  collection,
  relationPresentations
) {
  const field = configuredTableField(item, column, nodeTypes);
  return displayValue(
    getTableValue(item, column.field, collection),
    field,
    relationPresentationForField(field, relationPresentations)
  );
}

function sortableTableValue(
  item,
  fieldName,
  nodeTypes,
  collection,
  relationPresentations
) {
  const value = getTableValue(item, fieldName, collection);
  const field = configuredTableField(
    item,
    { field: fieldName },
    nodeTypes
  );
  if (!["reference", "tags"].includes(field.widget)) return value;
  const formatted = displayValue(
    value,
    field,
    relationPresentationForField(field, relationPresentations)
  );
  return ["—", "…"].includes(formatted) ? "" : formatted;
}

function TableCell({
  item,
  column,
  nodeTypes,
  collection,
  relationPresentations,
  editing,
  onEdit
}) {
  const adapter = useAdapter();
  const field = configuredTableField(item, column, nodeTypes);
  const value = getTableValue(item, column.field, collection);
  const relationPresentation = relationPresentationForField(
    field,
    relationPresentations
  );
  const formatted = displayValue(value, field, relationPresentation);
  const structuredReference =
    field.widget === "reference" &&
    (field.multiple === true ||
      (Array.isArray(field.selections) && field.selections.length > 0) ||
      (value && typeof value === "object"));
  const editable =
    column.mode === "edit" &&
    !column.field.startsWith("$") &&
    field.widget !== "image" &&
    field.widget !== "tags" &&
    !structuredReference &&
    field.readonly !== true;
  const [draftValue, setDraftValue] = useState(value ?? "");

  useEffect(() => {
    setDraftValue(value ?? "");
  }, [value]);

  function commitDraft() {
    const nextValue =
      field.widget === "number" && draftValue !== ""
        ? Number(draftValue)
        : draftValue;
    if (nextValue !== value) onEdit(item, column, nextValue);
  }

  let content;

  if (editable && (field.display === "toggle" || field.widget === "boolean")) {
    content = (
      <button
        type="button"
        className={cx("switch table-cell__toggle", value && "switch--on")}
        role="switch"
        aria-label={`${field.label || field.name}: ${value ? "Yes" : "No"}`}
        aria-checked={Boolean(value)}
        disabled={editing}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(item, column, !value);
        }}
      >
        <span />
      </button>
    );
  } else if (editable && field.widget === "select") {
    content = (
      <div className="select-wrap table-cell__select">
        <select
          value={value ?? ""}
          aria-label={field.label || field.name}
          disabled={editing}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            onEdit(item, column, event.target.value);
          }}
        >
          {(field.options ?? []).map((option) => {
            const configuredOption =
              typeof option === "object"
                ? option
                : { label: option, value: option };
            return (
              <option key={configuredOption.value} value={configuredOption.value}>
                {configuredOption.label}
              </option>
            );
          })}
        </select>
        <ChevronDown size={13} />
      </div>
    );
  } else if (editable && field.widget === "reference") {
    const reference = normalizeReferenceValue(value).ref;
    const selectedKey = relationValueKey(reference) || "";
    const options = relationPresentation.options;
    const selectedOption = options.get(selectedKey);
    const missingSelection = hasReferenceValue(reference) && !selectedOption;
    content = (
      <div className="select-wrap table-cell__select">
        <select
          value={selectedKey}
          aria-label={field.label || field.name}
          disabled={
            editing || (relationPresentation.loading && options.size === 0)
          }
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            if (!event.target.value) {
              onEdit(item, column, "");
              return;
            }
            const option = options.get(event.target.value);
            if (option) onEdit(item, column, option.value);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {(!hasReferenceValue(reference) || field.required !== true) && (
            <option value="" disabled={field.required === true}>
              {field.required === true ? "Select…" : "None"}
            </option>
          )}
          {missingSelection && (
            <option value={selectedKey} disabled>
              {relationPresentation.loading ? "Loading…" : "Missing reference"}
            </option>
          )}
          {[...options.entries()].map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </div>
    );
  } else if (editable) {
    content = (
      <input
        className="table-cell__input"
        type={
          field.widget === "datetime"
            ? "date"
            : field.widget === "number"
              ? "number"
              : field.widget === "url"
                ? "url"
                : "text"
        }
        value={draftValue}
        inputMode={field.widget === "url" ? "url" : undefined}
        autoCapitalize={field.widget === "url" ? "none" : undefined}
        autoCorrect={field.widget === "url" ? "off" : undefined}
        spellCheck={field.widget === "url" ? false : undefined}
        aria-label={field.label || field.name}
        disabled={editing}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            setDraftValue(value ?? "");
          }
        }}
      />
    );
  } else if (field.display === "image") {
    const source = resolveImagePresentation(adapter, value, field, {
      width: 320,
      height: 320,
      fit: "inside",
      collection: collection.name
    });
    content = source ? (
      <img className="table-cell__image" src={source} alt="" />
    ) : (
      <span className="table-cell__image-placeholder">
        <Image size={16} />
      </span>
    );
  } else if (field.display === "badge") {
    content = <span className="table-cell__badge">{formatted}</span>;
  } else if (field.display === "code") {
    content = <code>{formatted}</code>;
  } else {
    content = formatted;
  }

  if (field.widget === "url") {
    content = (
      <span className="table-cell__url">
        <span className="table-cell__url-value">{content}</span>
        <ExternalUrlLink
          value={editable ? draftValue : value}
          label={field.label || field.name || "URL"}
          className="table-cell__url-action"
        />
      </span>
    );
  }

  return (
    <td
      className={cx(
        column.align && `table-cell--${column.align}`,
        column.appearance && `table-cell--${column.appearance}`
      )}
      title={formatted}
    >
      {content}
    </td>
  );
}

function CollectionTable({
  collection,
  collections = [],
  items,
  nodeTypes,
  selectedId,
  loading,
  search,
  editing,
  onSearch,
  onSelect,
  onCreate,
  onOpenPreview,
  onSaveQuickFilters,
  onEdit
}) {
  const adapter = useAdapter();
  const listView = collection.views?.list ?? {};
  const columns = useMemo(() => {
    const configured = listView.columns ?? [];
    if (configured.length) {
      return configured.map((column) =>
        typeof column === "string"
          ? {
              field: column,
              label:
                typeField(nodeTypes[collection.node_type], column)?.label ||
                SYSTEM_FIELD_DEFINITIONS[column]?.label ||
                column,
              sortable: true,
              mode: "read"
            }
          : {
              mode: "read",
              ...column,
              label:
                column.label ||
                typeField(
                  nodeTypes[collection.node_type],
                  column.field
                )?.label ||
                SYSTEM_FIELD_DEFINITIONS[column.field]?.label ||
                column.field,
              sortable: column.sortable !== false
            }
      );
    }
    const fields = typeFields(nodeTypes[collection.node_type]);
    const inferred = fields.slice(0, 4).map((field) => ({
      field: field.name,
      label: field.label || field.name,
      sortable: true,
      mode: "read"
    }));
    return inferred.length
      ? inferred
      : [{ field: "id", label: "Record ID", sortable: true }];
  }, [collection.node_type, listView.columns, nodeTypes]);
  const searchFields = useMemo(
    () =>
      listView.search?.fields?.length
        ? listView.search.fields
        : columns.map((column) => column.field),
    [columns, listView.search?.fields]
  );
  const filterFields = useMemo(() => {
    const typeNames = new Set([
      collection.node_type,
      ...(collection.allowed_types ?? []),
      ...items.map((item) => item.type)
    ]);
    const candidates = new Map();
    for (const typeName of typeNames) {
      for (const field of typeFields(nodeTypes[typeName])) {
        const entries = candidates.get(field.name) ?? [];
        entries.push(field);
        candidates.set(field.name, entries);
      }
    }

    const compatible = [];
    for (const [name, definitions] of candidates) {
      const signatures = new Set(
        definitions.map((field) =>
          JSON.stringify([
            filterFieldKind(field),
            field.collection || "",
            field.multiple === true,
            field.value_field || "",
            [...(field.allowed_types ?? [])].sort(),
            field.widget === "select" ? field.options ?? [] : []
          ])
        )
      );
      if (signatures.size === 1) {
        compatible.push({ ...definitions[0], name });
      }
    }
    compatible.push(
      ...Object.entries(SYSTEM_FIELD_DEFINITIONS).map(([name, field]) => ({
        ...field,
        name,
        system: true
      }))
    );
    return compatible;
  }, [collection.allowed_types, collection.node_type, items, nodeTypes]);
  const relationColumns = useMemo(() => {
    const fields = new Map(columns.map((column) => [column.field, column]));
    for (const fieldName of [
      ...searchFields,
      ...filterFields.map((field) => field.name),
      listView.sort?.field
    ].filter(Boolean)) {
      if (!fields.has(fieldName)) fields.set(fieldName, { field: fieldName });
    }
    return [...fields.values()];
  }, [columns, filterFields, listView.sort?.field, searchFields]);
  const relationFields = useMemo(() => {
    const typeNames = new Set([
      collection.node_type,
      ...(collection.allowed_types ?? []),
      ...items.map((item) => item.type)
    ]);
    const fields = new Map();
    for (const typeName of typeNames) {
      for (const column of relationColumns) {
        const field = configuredTableField({ type: typeName }, column, nodeTypes);
        if (
          ["reference", "tags"].includes(field.widget) &&
          typeof field.collection === "string" &&
          field.collection
        ) {
          fields.set(relationFieldKey(field), field);
        }
      }
    }
    return [...fields.values()];
  }, [
    collection.allowed_types,
    collection.node_type,
    items,
    nodeTypes,
    relationColumns
  ]);
  const relationTargetNames = useMemo(
    () => [
      ...new Set(
        relationFields
          .map((field) => field.collection)
          .filter((name) => name !== collection.name)
      )
    ].sort(),
    [collection.name, relationFields]
  );
  const relationTargetKey = JSON.stringify(relationTargetNames);
  const relationValuesKey = useMemo(
    () =>
      JSON.stringify(
        items.flatMap((item) =>
          relationColumns.flatMap((column) => {
            const field = configuredTableField(item, column, nodeTypes);
            return ["reference", "tags"].includes(field.widget) &&
              field.collection !== collection.name
              ? [[
                  relationFieldKey(field),
                  getTableValue(item, column.field, collection)
                ]]
              : [];
          })
        )
      ),
    [collection, items, nodeTypes, relationColumns]
  );
  const [relationTargets, setRelationTargets] = useState({});

  useEffect(() => {
    const targetNames = JSON.parse(relationTargetKey);
    if (!targetNames.length) {
      setRelationTargets({});
      return undefined;
    }

    let cancelled = false;
    setRelationTargets((current) =>
      Object.fromEntries(
        targetNames.map((name) => [
          name,
          {
            items: current[name]?.items ?? [],
            loading: true
          }
        ])
      )
    );

    async function loadRelationTargets() {
      const results = await Promise.all(
        targetNames.map(async (name) => {
          try {
            const result = await adapter.list(name);
            return { name, items: result.items ?? [], failed: false };
          } catch {
            return { name, items: [], failed: true };
          }
        })
      );
      if (cancelled) return;
      setRelationTargets((current) =>
        Object.fromEntries(
          results.map((result) => [
            result.name,
            {
              items: result.failed
                ? current[result.name]?.items ?? []
                : result.items,
              loading: false
            }
          ])
        )
      );
    }

    void loadRelationTargets();
    return () => {
      cancelled = true;
    };
  }, [adapter, relationTargetKey, relationValuesKey]);

  const relationPresentations = useMemo(() => {
    const targetCollections = new Map(
      collections.map((entry) => [entry.name, entry])
    );
    const presentations = new Map();
    for (const field of relationFields) {
      const targetState = field.collection === collection.name
        ? { items, loading: false }
        : relationTargets[field.collection] ?? { items: [], loading: true };
      presentations.set(relationFieldKey(field), {
        options: tableRelationOptions(
          field,
          targetCollections.get(field.collection),
          targetState.items
        ),
        loading: targetState.loading
      });
    }
    return presentations;
  }, [collection.name, collections, items, relationFields, relationTargets]);
  const [sort, setSort] = useState(() => {
    const configured = listView.sort;
    return {
      field: configured?.field || columns[0]?.field || "title",
      direction: configured?.direction === "desc" ? "desc" : "asc"
    };
  });
  const [appliedFilter, setAppliedFilter] = useState(createEmptyFilter);
  const tableColumns = columns
    .map((column) => column.width || "minmax(8rem, 1fr)")
    .join(" ");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => {
    const compiledFilter = compileFilterExpression(appliedFilter, {
      fields: filterFields,
      getValue: (item, fieldName) =>
        getTableValue(item, fieldName, collection),
      now: new Date()
    });
    const scopedItems = items.filter(compiledFilter.test);
    const filtered = normalizedSearch
      ? scopedItems.filter((item) => {
          const values = [
            item.id,
            ...searchFields.map((fieldName) => {
              const column =
                columns.find((candidate) => candidate.field === fieldName) ??
                { field: fieldName };
              return formatTableValue(
                item,
                column,
                nodeTypes,
                collection,
                relationPresentations
              );
            })
          ];
          return values.some((value) =>
            String(value).toLocaleLowerCase().includes(normalizedSearch)
          );
        })
      : [...scopedItems];

    return filtered.sort((left, right) => {
      const leftValue = sortableTableValue(
        left,
        sort.field,
        nodeTypes,
        collection,
        relationPresentations
      );
      const rightValue = sortableTableValue(
        right,
        sort.field,
        nodeTypes,
        collection,
        relationPresentations
      );
      if (leftValue === rightValue) return left.id.localeCompare(right.id);
      if (leftValue === "" || leftValue === null || leftValue === undefined) return 1;
      if (rightValue === "" || rightValue === null || rightValue === undefined) return -1;
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base"
            });
      return sort.direction === "desc" ? -comparison : comparison;
    });
  }, [
    collection,
    columns,
    appliedFilter,
    filterFields,
    items,
    nodeTypes,
    normalizedSearch,
    relationPresentations,
    searchFields,
    sort
  ]);

  function changeSort(column) {
    if (!column.sortable) return;
    setSort((current) => ({
      field: column.field,
      direction:
        current.field === column.field && current.direction === "asc"
          ? "desc"
          : "asc"
    }));
  }

  return (
    <section className="table-pane">
      <div className="table-controls">
        <div className="table-toolbar">
          <div className="table-toolbar__identity">
            <strong>{collection.label}</strong>
            <span>
              {visibleItems.length === items.length
                ? `${items.length} records`
                : `${visibleItems.length} of ${items.length} records`}
            </span>
          </div>
          <div className="search table-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={`Filter ${collection.label.toLowerCase()}…`}
            />
            {search && (
              <button type="button" onClick={() => onSearch("")} title="Clear filter">
                <X size={13} />
              </button>
            )}
          </div>
          {onOpenPreview && (
            <button
              type="button"
              className="button table-toolbar__preview"
              disabled={!selectedId}
              onClick={onOpenPreview}
            >
              <Eye size={15} />
              Preview selected
            </button>
          )}
          <button type="button" className="button table-toolbar__new" onClick={onCreate}>
            <Plus size={15} />
            New {collection.label_singular}
          </button>
        </div>
        <AdvancedFilter
          fields={filterFields}
          quickFilters={listView.quick_filters}
          applied={appliedFilter}
          disabled={editing}
          relationOptionsForField={(field) =>
            relationPresentationForField(field, relationPresentations).options
          }
          onApply={setAppliedFilter}
          onSaveUserQuickFilters={onSaveQuickFilters}
        />
      </div>

      <div className="table-scroll">
        <table
          className="collection-table"
          style={{ "--table-columns": tableColumns }}
        >
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sort.field === column.field;
                return (
                  <th
                    key={column.field}
                    className={column.align ? `table-cell--${column.align}` : undefined}
                    aria-sort={
                      isSorted
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      disabled={!column.sortable}
                      onClick={() => changeSort(column)}
                    >
                      <span>{column.label}</span>
                      {isSorted &&
                        (sort.direction === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr
                key={item.id}
                className={cx(
                  item.id === selectedId && "is-selected",
                  item.hidden && "is-hidden"
                )}
                tabIndex={0}
                aria-selected={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(item.id);
                }}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.field}
                    item={item}
                    column={column}
                    nodeTypes={nodeTypes}
                    collection={collection}
                    relationPresentations={relationPresentations}
                    editing={editing}
                    onEdit={onEdit}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visibleItems.length && (
          <EmptyState
            icon={Search}
            title={
              search || countFilterRules(appliedFilter)
                ? "No matching records"
                : `No ${collection.label.toLowerCase()}`
            }
          >
            {search || countFilterRules(appliedFilter)
              ? "Try a different filter."
              : `Create the first ${collection.label_singular.toLowerCase()}.`}
          </EmptyState>
        )}
        {loading && !items.length && (
          <div className="panel-loader">
            <Spinner />
          </div>
        )}
      </div>
    </section>
  );
}

export { CollectionTable };
