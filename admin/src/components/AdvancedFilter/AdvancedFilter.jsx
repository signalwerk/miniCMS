import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createId } from "../../../../core/id.js";
import {
  FILTER_KEYWORD_DEFINITIONS,
  FILTER_OPERATOR_DEFINITIONS,
  FILTER_WEEKDAY_ZERO,
  canonicalFilterExpression,
  countFilterRules,
  createEmptyFilter,
  filterExpressionsEqual,
  filterKeywordSuggestions,
  filterOperatorsForField,
  filterValueControl,
  isFilterExpressionEmpty,
  validateFilterExpression
} from "../../model/advancedFilter.js";
import { cx } from "../../model/editor.js";
import {
  focusableElements,
  isolateFocusSurface
} from "../../model/focus.js";
import { ConfirmationDialog } from "../Dialogs/Dialogs.jsx";
import { Spinner } from "../Common/Common.jsx";
import "./AdvancedFilter.scss";

function cloneExpression(expression) {
  return structuredClone(expression ?? createEmptyFilter());
}

function pathKey(path) {
  return path.length ? path.join("-") : "root";
}

function samePath(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function errorFor(errors, path, properties = []) {
  return errors.find(
    (error) =>
      samePath(error.path, path) &&
      (!properties.length || properties.includes(error.property))
  );
}

function updateAtPath(expression, path, update) {
  if (!path.length) return update(expression);
  const [index, ...rest] = path;
  return {
    ...expression,
    children: expression.children.map((child, childIndex) =>
      childIndex === index ? updateAtPath(child, rest, update) : child
    )
  };
}

function removeAtPath(expression, path) {
  const parentPath = path.slice(0, -1);
  const removeIndex = path.at(-1);
  return updateAtPath(expression, parentPath, (group) => ({
    ...group,
    children: group.children.filter((_, index) => index !== removeIndex)
  }));
}

function fieldMap(fields) {
  return new Map((fields ?? []).map((field) => [field.name, field]));
}

function newRule(fields) {
  const field = fields[0];
  const operator = field ? filterOperatorsForField(field)[0]?.id : "equals";
  return {
    field: field?.name || "",
    operator: operator || "equals",
    ...(FILTER_OPERATOR_DEFINITIONS[operator]?.unary ? {} : { value: "" })
  };
}

function typedValueKey(value) {
  if (value === null) return "null:null";
  return `${typeof value}:${JSON.stringify(value)}`;
}

function choiceOptions(field, operator, relationOptionsForField) {
  let options = [];
  if (field.widget === "boolean") {
    options = [
      { label: "True", value: true },
      { label: "False", value: false },
      { label: "Current true (@true)", value: "@true" },
      { label: "Current false (@false)", value: "@false" }
    ];
  } else if (field.widget === "select") {
    options = (field.options ?? []).map((option) =>
      option && typeof option === "object"
        ? { label: option.label, value: option.value }
        : { label: String(option), value: option }
    );
  } else if (["reference", "tags"].includes(field.widget)) {
    options = [...(relationOptionsForField?.(field)?.values?.() ?? [])].map(
      (option) => ({ label: option.label, value: option.value })
    );
  }
  if (["equals", "not_equals"].includes(operator)) {
    options.push({ label: "Null (@null)", value: "@null" });
  }
  const unique = new Map();
  for (const option of options) {
    const key = typedValueKey(option.value);
    if (!unique.has(key)) unique.set(key, option);
  }
  return unique;
}

function RuleValueControl({
  field,
  operator,
  value,
  error,
  id,
  errorId,
  relationOptionsForField,
  onChange
}) {
  const control = filterValueControl(field, operator);
  if (!control) return null;
  const options = choiceOptions(field, operator, relationOptionsForField);
  if (["select", "reference", "boolean"].includes(control)) {
    const selectedKey = typedValueKey(value);
    const selected = options.get(selectedKey);
    const missing = !selected && value !== "" && value !== undefined;
    return (
      <select
        id={id}
        value={selected ? selectedKey : missing ? "__missing__" : ""}
        aria-label={`${field.label || field.name} value`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          const option = options.get(event.target.value);
          if (option) onChange(option.value);
        }}
      >
        <option value="">Choose value…</option>
        {missing && (
          <option value="__missing__" disabled>
            Missing saved value
          </option>
        )}
        {[...options.entries()].map(([key, option]) => (
          <option key={key} value={key}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const suggestions = filterKeywordSuggestions(field, operator);
  const listId = suggestions.length ? `${id}-suggestions` : undefined;
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode={control === "number" ? "decimal" : undefined}
        value={value ?? ""}
        list={listId}
        placeholder={
          control === "datetime"
            ? "YYYY-MM-DD or @keyword"
            : control === "number"
              ? "Number or @keyword"
              : "Value"
        }
        aria-label={`${field.label || field.name} value`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option
              key={suggestion.token}
              value={suggestion.suggestion}
              label={suggestion.label}
            />
          ))}
        </datalist>
      )}
    </>
  );
}

function FilterRule({
  rule,
  path,
  fields,
  fieldsByName,
  errors,
  idPrefix,
  relationOptionsForField,
  onChange,
  onRemove
}) {
  const field = fieldsByName.get(rule.field);
  const operators = field ? filterOperatorsForField(field) : [];
  const fieldError = errorFor(errors, path, ["field"]);
  const operatorError = errorFor(errors, path, ["operator"]);
  const valueError = errorFor(errors, path, ["value"]);
  const generalError = errorFor(errors, path, [null]);
  const key = pathKey(path);
  const error = fieldError || operatorError || valueError || generalError;
  const errorId = `${idPrefix}-error-${key}`;

  return (
    <div className="advanced-filter-rule" data-filter-path={key}>
      <select
        id={`${idPrefix}-field-${key}`}
        value={field ? rule.field : ""}
        aria-label="Filter field"
        aria-invalid={Boolean(fieldError)}
        aria-describedby={fieldError ? errorId : undefined}
        onChange={(event) => {
          const nextField = fieldsByName.get(event.target.value);
          const nextOperator = filterOperatorsForField(nextField)[0]?.id;
          onChange({
            field: nextField.name,
            operator: nextOperator,
            ...(FILTER_OPERATOR_DEFINITIONS[nextOperator]?.unary
              ? {}
              : { value: "" })
          });
        }}
      >
        {!field && (
          <option value="" disabled>
            Missing field: {rule.field || "not selected"}
          </option>
        )}
        {fields.map((option) => (
          <option key={option.name} value={option.name}>
            {option.label || option.name}
          </option>
        ))}
      </select>

      <select
        value={operators.some((operator) => operator.id === rule.operator)
          ? rule.operator
          : ""}
        aria-label="Filter operator"
        aria-invalid={Boolean(operatorError)}
        aria-describedby={operatorError ? errorId : undefined}
        disabled={!field}
        onChange={(event) => {
          const nextOperator = event.target.value;
          onChange({
            ...rule,
            operator: nextOperator,
            ...(FILTER_OPERATOR_DEFINITIONS[nextOperator]?.unary
              ? { value: undefined }
              : Object.hasOwn(rule, "value")
                ? {}
                : { value: "" })
          });
        }}
      >
        {!operators.some((operator) => operator.id === rule.operator) && (
          <option value="" disabled>
            {rule.operator ? "Missing operator" : "Choose operator…"}
          </option>
        )}
        {operators.map((operator) => (
          <option key={operator.id} value={operator.id}>
            {operator.label}
          </option>
        ))}
      </select>

      <span className="advanced-filter-rule__value">
        {field && (
          <RuleValueControl
            field={field}
            operator={rule.operator}
            value={rule.value}
            error={valueError}
            id={`${idPrefix}-value-${key}`}
            errorId={errorId}
            relationOptionsForField={relationOptionsForField}
            onChange={(value) => onChange({ ...rule, value })}
          />
        )}
      </span>

      <button
        type="button"
        className="advanced-filter-icon-button"
        title={`Remove ${field?.label || rule.field || "filter"} rule`}
        aria-label={`Remove ${field?.label || rule.field || "filter"} rule`}
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </button>

      {error && (
        <small id={errorId} className="advanced-filter-error" role="alert">
          {error.message}
        </small>
      )}
    </div>
  );
}

function FilterGroup({
  group,
  path,
  level,
  root,
  fields,
  fieldsByName,
  errors,
  idPrefix,
  relationOptionsForField,
  onExpressionChange,
  requestFocus
}) {
  const key = pathKey(path);
  const groupError = errorFor(errors, path, ["mode", "children", null]);
  const groupErrorId = `${idPrefix}-group-error-${key}`;

  function updateGroup(update) {
    onExpressionChange((expression) => updateAtPath(expression, path, update));
  }

  function addRule() {
    const childIndex = group.children.length;
    updateGroup((current) => ({
      ...current,
      children: [...current.children, newRule(fields)]
    }));
    requestFocus(`${idPrefix}-field-${pathKey([...path, childIndex])}`);
  }

  function addGroup() {
    const childIndex = group.children.length;
    updateGroup((current) => ({
      ...current,
      children: [
        ...current.children,
        { mode: "all", children: [newRule(fields)] }
      ]
    }));
    requestFocus(
      `${idPrefix}-field-${pathKey([...path, childIndex, 0])}`
    );
  }

  function removeChild(childPath) {
    onExpressionChange((expression) => removeAtPath(expression, childPath));
    requestFocus(
      `${idPrefix}-add-rule-${pathKey(childPath.slice(0, -1))}`
    );
  }

  return (
    <section
      className={cx(
        "advanced-filter-group",
        root && "advanced-filter-group--root"
      )}
      role="group"
      aria-label={root ? "Root filters" : `Filter group, level ${level}`}
      aria-describedby={groupError ? groupErrorId : undefined}
    >
      <header className="advanced-filter-group__header">
        <label htmlFor={`${idPrefix}-mode-${key}`}>
          {root ? "Match" : `Group ${level}`}
        </label>
        <select
          id={`${idPrefix}-mode-${key}`}
          value={group.mode}
          aria-label={`${root ? "Root filters" : `Filter group level ${level}`} mode`}
          aria-invalid={Boolean(errorFor(errors, path, ["mode"]))}
          onChange={(event) =>
            updateGroup((current) => ({
              ...current,
              mode: event.target.value
            }))
          }
        >
          <option value="all">Match all</option>
          <option value="any">Match any</option>
        </select>
        {!root && (
          <button
            type="button"
            className="advanced-filter-icon-button"
            title={`Remove filter group at level ${level}`}
            aria-label={`Remove filter group at level ${level}`}
            onClick={() => removeChild(path)}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="advanced-filter-group__children">
        {group.children.map((child, index) => {
          const childPath = [...path, index];
          return Array.isArray(child?.children) ? (
            <FilterGroup
              key={`group-${pathKey(childPath)}`}
              group={child}
              path={childPath}
              level={level + 1}
              root={false}
              fields={fields}
              fieldsByName={fieldsByName}
              errors={errors}
              idPrefix={idPrefix}
              relationOptionsForField={relationOptionsForField}
              onExpressionChange={onExpressionChange}
              requestFocus={requestFocus}
            />
          ) : (
            <FilterRule
              key={`rule-${pathKey(childPath)}`}
              rule={child}
              path={childPath}
              fields={fields}
              fieldsByName={fieldsByName}
              errors={errors}
              idPrefix={idPrefix}
              relationOptionsForField={relationOptionsForField}
              onChange={(nextRule) =>
                onExpressionChange((expression) =>
                  updateAtPath(expression, childPath, () => {
                    const cleaned = { ...nextRule };
                    if (cleaned.value === undefined) delete cleaned.value;
                    return cleaned;
                  })
                )
              }
              onRemove={() => removeChild(childPath)}
            />
          );
        })}
      </div>

      {!group.children.length && (
        <p className="advanced-filter-group__empty">No rules in this group.</p>
      )}
      {groupError && (
        <small id={groupErrorId} className="advanced-filter-error" role="alert">
          {groupError.message}
        </small>
      )}

      <footer className="advanced-filter-group__actions">
        <button
          id={`${idPrefix}-add-rule-${key}`}
          type="button"
          onClick={addRule}
          disabled={!fields.length}
        >
          <Plus size={13} aria-hidden="true" /> Add rule
        </button>
        <button type="button" onClick={addGroup} disabled={!fields.length}>
          <Plus size={13} aria-hidden="true" /> Add group
        </button>
      </footer>
    </section>
  );
}

function FilterExpressionEditor({
  expression,
  fields,
  relationOptionsForField,
  showErrors = false,
  idPrefix: suppliedIdPrefix,
  rootRef,
  onChange
}) {
  const generatedId = useId();
  const idPrefix = suppliedIdPrefix || `advanced-filter-${generatedId}`;
  const fieldsByName = useMemo(() => fieldMap(fields), [fields]);
  const validation = validateFilterExpression(expression, { fields });
  const errors = showErrors ? validation.errors : [];

  function requestFocus(id) {
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function updateExpression(change) {
    onChange(change(expression));
  }

  return (
    <div ref={rootRef} className="advanced-filter-expression">
      <FilterGroup
        group={expression}
        path={[]}
        level={0}
        root
        fields={fields}
        fieldsByName={fieldsByName}
        errors={errors}
        idPrefix={idPrefix}
        relationOptionsForField={relationOptionsForField}
        onExpressionChange={updateExpression}
        requestFocus={requestFocus}
      />
    </div>
  );
}

function QuickFilterNameDialog({
  title,
  description,
  actionLabel,
  initialValue = "",
  onCancel,
  onSubmit
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const restoreIsolation = isolateFocusSurface(dialogRef.current);
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      restoreIsolation();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      const backdrops = document.querySelectorAll(".dialog-backdrop");
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current?.contains(event.target)) {
        return;
      }
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onCancel]);

  async function submit(event) {
    event.preventDefault();
    const name = value.trim();
    if (!name) {
      setError("Enter a quick-filter name.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(name);
      onCancel();
    } catch (submitError) {
      setError(submitError.message || "Could not save the quick filter.");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="dialog quick-filter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onSubmit={submit}
      >
        <div className="dialog__top">
          <span className="dialog__icon" aria-hidden="true">
            <Save size={18} />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog__body">
          <label className="quick-filter-dialog__field">
            <span>Name</span>
            <input
              ref={inputRef}
              value={value}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
            />
          </label>
          {error && (
            <div className="inline-error" role="alert">
              <CircleAlert size={15} aria-hidden="true" /> {error}
            </div>
          )}
        </div>
        <div className="dialog__footer">
          <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? <Spinner small /> : <Check size={15} aria-hidden="true" />}
            {actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function QuickFilterMenu({
  label,
  invalid,
  busy,
  onUpdate,
  onRename,
  onRepair,
  onDelete
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[0]?.focus();
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [open]);

  const items = [
    ["Update from draft", onUpdate, Save],
    ["Rename", onRename, Pencil],
    ...(invalid ? [["Edit or repair", onRepair, RotateCcw]] : []),
    ["Delete", onDelete, Trash2]
  ];

  function navigate(event, index) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const destination =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    itemRefs.current[destination]?.focus();
  }

  return (
    <span ref={rootRef} className="quick-filter-menu">
      <button
        ref={triggerRef}
        type="button"
        className="quick-filter-menu__trigger"
        title={`Manage ${label}`}
        aria-label={`Manage ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {open && (
        <span id={menuId} className="quick-filter-menu__popover" role="menu">
          {items.map(([itemLabel, action, Icon], index) => (
            <button
              key={itemLabel}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              onKeyDown={(event) => navigate(event, index)}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                action();
              }}
            >
              <Icon size={13} aria-hidden="true" /> {itemLabel}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function quickFilterEntries(quickFilters) {
  return [
    ...Object.entries(quickFilters?.built_in ?? {}).map(([id, filter]) => ({
      id,
      kind: "built_in",
      key: `built_in:${id}`,
      ...filter
    })),
    ...Object.entries(quickFilters?.user_created ?? {}).map(([id, filter]) => ({
      id,
      kind: "user_created",
      key: `user_created:${id}`,
      ...filter
    }))
  ];
}

function normalizedQuickFilterName(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function KeywordReference() {
  return (
    <details className="advanced-filter-keywords">
      <summary>Keyword reference</summary>
      <p>
        Keywords are exact and case-sensitive. Dates use this browser's time zone;
        weeks run Monday–Sunday and <code>@weekday</code> uses {FILTER_WEEKDAY_ZERO} = 0.
      </p>
      <dl>
        {FILTER_KEYWORD_DEFINITIONS.map((definition) => (
          <div key={definition.token}>
            <dt><code>{definition.token}</code></dt>
            <dd>{definition.label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function AdvancedFilter({
  fields,
  quickFilters,
  applied,
  relationOptionsForField,
  disabled = false,
  onApply,
  onSaveUserQuickFilters
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => cloneExpression(applied));
  const [showErrors, setShowErrors] = useState(false);
  const [activeQuickKey, setActiveQuickKey] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const editorRef = useRef(null);
  const panelId = useId();
  const entries = useMemo(() => quickFilterEntries(quickFilters), [quickFilters]);
  const validation = validateFilterExpression(draft, { fields });
  const appliedCount = countFilterRules(applied);
  const draftChanged = !filterExpressionsEqual(draft, applied);

  const activeQuick = entries.find((entry) => entry.key === activeQuickKey);
  const activeQuickMatches = Boolean(
    activeQuick && filterExpressionsEqual(activeQuick.expression, applied)
  );

  useEffect(() => {
    if (activeQuickKey && !activeQuickMatches) setActiveQuickKey(null);
  }, [activeQuickKey, activeQuickMatches]);

  function focusFirstError() {
    window.requestAnimationFrame(() =>
      editorRef.current?.querySelector("[aria-invalid='true']")?.focus()
    );
  }

  function requireSavableDraft() {
    setOpen(true);
    if (!validation.valid || isFilterExpressionEmpty(draft)) {
      setShowErrors(true);
      focusFirstError();
      if (isFilterExpressionEmpty(draft)) {
        setSaveError("Add at least one valid rule before saving a quick filter.");
      }
      return false;
    }
    setSaveError("");
    return true;
  }

  function assertUniqueName(name, exceptKey) {
    const normalized = normalizedQuickFilterName(name);
    if (
      entries.some(
        (entry) =>
          entry.key !== exceptKey &&
          normalizedQuickFilterName(entry.label) === normalized
      )
    ) {
      throw new Error("Quick-filter names must be unique.");
    }
  }

  async function storeUsers(nextUsers) {
    if (!onSaveUserQuickFilters) {
      throw new Error("Quick-filter storage is not available.");
    }
    setBusy(true);
    setSaveError("");
    try {
      await onSaveUserQuickFilters(nextUsers);
    } catch (error) {
      setSaveError(error.message || "Could not save quick filters.");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function activate(entry) {
    const entryValidation = validateFilterExpression(entry.expression, { fields });
    if (!entryValidation.valid) return;
    const next = cloneExpression(entry.expression);
    setDraft(next);
    onApply(cloneExpression(next));
    setShowErrors(false);
    setSaveError("");
    setActiveQuickKey(entry.key);
  }

  function applyDraft() {
    setShowErrors(true);
    setSaveError("");
    if (!validation.valid) {
      focusFirstError();
      return;
    }
    const next = canonicalFilterExpression(draft) ?? createEmptyFilter();
    onApply(cloneExpression(next));
    if (
      activeQuickKey &&
      !filterExpressionsEqual(activeQuick?.expression, next)
    ) {
      setActiveQuickKey(null);
    }
    setShowErrors(false);
  }

  function loadRepair(entry) {
    const replace = () => {
      setDraft(cloneExpression(entry.expression));
      setOpen(true);
      setShowErrors(true);
      setSaveError("");
      setConfirmation(null);
      window.requestAnimationFrame(() => focusFirstError());
    };
    if (draftChanged) {
      setConfirmation({ type: "repair", entry, onConfirm: replace });
    } else {
      replace();
    }
  }

  return (
    <div className={cx("advanced-filter", appliedCount && "is-active") }>
      <button
        type="button"
        className="advanced-filter__disclosure"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <ListFilter size={14} aria-hidden="true" />
        <span>Advanced filters{appliedCount ? ` · ${appliedCount}` : ""}</span>
      </button>

      <div id={panelId} className="advanced-filter__panel" hidden={!open}>
        <div className="advanced-filter__body">
          <section className="quick-filters" aria-label="Quick filters">
            <strong>Quick filters</strong>
            <div className="quick-filters__chips">
              {entries.map((entry) => {
                const entryValidation = validateFilterExpression(entry.expression, {
                  fields
                });
                const active =
                  activeQuickKey === entry.key &&
                  filterExpressionsEqual(entry.expression, applied);
                const reason = entryValidation.errors[0]?.message;
                return (
                  <span
                    key={entry.key}
                    className={cx(
                      "quick-filter-chip",
                      active && "is-active",
                      !entryValidation.valid && "is-invalid"
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-disabled={!entryValidation.valid || busy || disabled}
                      aria-label={
                        reason ? `${entry.label}. Unavailable: ${reason}` : undefined
                      }
                      title={reason || entry.label}
                      onClick={() => {
                        if (entryValidation.valid && !busy && !disabled) activate(entry);
                      }}
                    >
                      {!entryValidation.valid && (
                        <CircleAlert size={12} aria-hidden="true" />
                      )}
                      {entry.label}
                    </button>
                    {entry.kind === "user_created" && (
                      <QuickFilterMenu
                        label={entry.label}
                        invalid={!entryValidation.valid}
                        busy={busy || disabled}
                        onUpdate={() => {
                          if (!requireSavableDraft()) return;
                          const users = structuredClone(
                            quickFilters?.user_created ?? {}
                          );
                          users[entry.id] = {
                            ...users[entry.id],
                            expression: canonicalFilterExpression(draft)
                          };
                          void storeUsers(users).catch(() => {});
                        }}
                        onRename={() =>
                          setDialog({
                            type: "rename",
                            entry,
                            initialValue: entry.label
                          })
                        }
                        onRepair={() => loadRepair(entry)}
                        onDelete={() =>
                          setConfirmation({ type: "delete", entry })
                        }
                      />
                    )}
                  </span>
                );
              })}
              {!entries.length && <em>No saved filters</em>}
            </div>
            <button
              type="button"
              className="quick-filters__save"
              disabled={busy || disabled}
              onClick={() => {
                if (requireSavableDraft()) setDialog({ type: "create" });
              }}
            >
              <Save size={13} aria-hidden="true" /> Save as quick filter
            </button>
          </section>

          <FilterExpressionEditor
            expression={draft}
            fields={fields}
            relationOptionsForField={relationOptionsForField}
            showErrors={showErrors}
            idPrefix={`advanced-filter-${panelId}`}
            rootRef={editorRef}
            onChange={(next) => {
              setDraft(next);
              setSaveError("");
            }}
          />

          <KeywordReference />
          {saveError && (
            <div className="advanced-filter__save-error" role="alert">
              <CircleAlert size={14} aria-hidden="true" /> {saveError}
            </div>
          )}
        </div>

        <footer className="advanced-filter__footer">
          <button
            type="button"
            className="button button--secondary"
            disabled={disabled || busy || (!appliedCount && isFilterExpressionEmpty(draft))}
            onClick={() => setConfirmation({ type: "reset" })}
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={disabled || busy}
            onClick={applyDraft}
          >
            <Check size={14} aria-hidden="true" /> Apply
          </button>
        </footer>
      </div>

      {dialog?.type === "create" && (
        <QuickFilterNameDialog
          title="Save quick filter"
          description="Save the complete draft expression without applying it."
          actionLabel="Save filter"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            assertUniqueName(name);
            const usedIds = new Set(entries.map((entry) => entry.id));
            const id = createId(usedIds);
            await storeUsers({
              ...(quickFilters?.user_created ?? {}),
              [id]: {
                label: name,
                expression: canonicalFilterExpression(draft)
              }
            });
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <QuickFilterNameDialog
          title="Rename quick filter"
          description="Only the shortcut name will change."
          actionLabel="Rename"
          initialValue={dialog.initialValue}
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            assertUniqueName(name, dialog.entry.key);
            const users = structuredClone(quickFilters?.user_created ?? {});
            users[dialog.entry.id] = {
              ...users[dialog.entry.id],
              label: name
            };
            await storeUsers(users);
          }}
        />
      )}

      {confirmation?.type === "reset" && (
        <ConfirmationDialog
          title="Reset advanced filters?"
          description="All applied filters and draft changes will be removed. Saved quick filters will remain."
          confirmLabel="Reset filters"
          danger
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            const empty = createEmptyFilter();
            setDraft(empty);
            onApply(cloneExpression(empty));
            setShowErrors(false);
            setSaveError("");
            setActiveQuickKey(null);
          }}
        />
      )}
      {confirmation?.type === "delete" && (
        <ConfirmationDialog
          title={`Delete “${confirmation.entry.label}”?`}
          description="Only this saved shortcut will be deleted. The current draft and applied filters will remain."
          confirmLabel="Delete quick filter"
          danger
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            const users = structuredClone(quickFilters?.user_created ?? {});
            delete users[confirmation.entry.id];
            await storeUsers(users);
            if (activeQuickKey === confirmation.entry.key) {
              setActiveQuickKey(null);
            }
          }}
        />
      )}
      {confirmation?.type === "repair" && (
        <ConfirmationDialog
          title="Replace the unapplied draft?"
          description={`Loading “${confirmation.entry.label}” for repair will discard the current unapplied draft. Applied filters will not change.`}
          confirmLabel="Replace draft"
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => confirmation.onConfirm()}
        />
      )}
    </div>
  );
}

export { AdvancedFilter, FilterExpressionEditor };
