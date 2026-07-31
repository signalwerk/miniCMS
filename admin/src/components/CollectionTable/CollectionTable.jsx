import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Image,
  Plus,
  Search,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./CollectionTable.scss";
import { useAdapter } from "../../adapters/AdapterContext.jsx";
import { cx, typeField, typeFields } from "../../model/editor.js";
import { imageSource } from "../../model/image.js";
import {
  SYSTEM_FIELD_DEFINITIONS,
  displayValue
} from "../../model/views.js";
import { EmptyState, Spinner } from "../Common/Common.jsx";

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

function formatTableValue(item, column, nodeTypes, collection) {
  return displayValue(
    getTableValue(item, column.field, collection),
    configuredTableField(item, column, nodeTypes)
  );
}

function TableCell({
  item,
  column,
  nodeTypes,
  collection,
  editing,
  onEdit
}) {
  const adapter = useAdapter();
  const field = configuredTableField(item, column, nodeTypes);
  const value = getTableValue(item, column.field, collection);
  const formatted = displayValue(value, field);
  const editable =
    column.mode === "edit" &&
    !column.field.startsWith("$") &&
    field.widget !== "image" &&
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
  } else if (editable) {
    content = (
      <input
        className="table-cell__input"
        type={
          field.widget === "datetime"
            ? "date"
            : field.widget === "number"
              ? "number"
              : "text"
        }
        value={draftValue}
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
    const source = adapter.resolveMediaUrl(imageSource(value));
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
  items,
  nodeTypes,
  selectedId,
  loading,
  search,
  editing,
  onSearch,
  onSelect,
  onCreate,
  onEdit
}) {
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
  const [sort, setSort] = useState(() => {
    const configured = listView.sort;
    return {
      field: configured?.field || columns[0]?.field || "title",
      direction: configured?.direction === "desc" ? "desc" : "asc"
    };
  });
  const searchFields = listView.search?.fields?.length
    ? listView.search.fields
    : columns.map((column) => column.field);
  const tableColumns = columns
    .map((column) => column.width || "minmax(8rem, 1fr)")
    .join(" ");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => {
    const filtered = normalizedSearch
      ? items.filter((item) => {
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
                collection
              );
            })
          ];
          return values.some((value) =>
            String(value).toLocaleLowerCase().includes(normalizedSearch)
          );
        })
      : [...items];

    return filtered.sort((left, right) => {
      const leftValue = getTableValue(left, sort.field, collection);
      const rightValue = getTableValue(right, sort.field, collection);
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
    items,
    nodeTypes,
    normalizedSearch,
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
        <button type="button" className="button table-toolbar__new" onClick={onCreate}>
          <Plus size={15} />
          New {collection.label_singular}
        </button>
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
            title={search ? "No matching records" : `No ${collection.label.toLowerCase()}`}
          >
            {search
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
