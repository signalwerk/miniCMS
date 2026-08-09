const FILTER_WEEKDAY_ZERO = "Sunday";

const FILTER_OPERATOR_DEFINITIONS = Object.freeze({
  equals: Object.freeze({ id: "equals", label: "Is", unary: false }),
  not_equals: Object.freeze({
    id: "not_equals",
    label: "Is not",
    unary: false
  }),
  contains: Object.freeze({
    id: "contains",
    label: "Contains",
    unary: false
  }),
  not_contains: Object.freeze({
    id: "not_contains",
    label: "Does not contain",
    unary: false
  }),
  starts_with: Object.freeze({
    id: "starts_with",
    label: "Starts with",
    unary: false
  }),
  ends_with: Object.freeze({
    id: "ends_with",
    label: "Ends with",
    unary: false
  }),
  greater_than: Object.freeze({
    id: "greater_than",
    label: "Is greater than",
    unary: false
  }),
  greater_than_or_equal: Object.freeze({
    id: "greater_than_or_equal",
    label: "Is at least",
    unary: false
  }),
  less_than: Object.freeze({
    id: "less_than",
    label: "Is less than",
    unary: false
  }),
  less_than_or_equal: Object.freeze({
    id: "less_than_or_equal",
    label: "Is at most",
    unary: false
  }),
  is_empty: Object.freeze({
    id: "is_empty",
    label: "Is empty",
    unary: true
  }),
  is_not_empty: Object.freeze({
    id: "is_not_empty",
    label: "Is not empty",
    unary: true
  }),
  is_null: Object.freeze({
    id: "is_null",
    label: "Is null",
    unary: true
  }),
  is_not_null: Object.freeze({
    id: "is_not_null",
    label: "Is not null",
    unary: true
  })
});

const OPERATOR_IDS_BY_KIND = Object.freeze({
  text: Object.freeze([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  number: Object.freeze([
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  datetime: Object.freeze([
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  boolean: Object.freeze([
    "equals",
    "not_equals",
    "is_null",
    "is_not_null"
  ]),
  choice: Object.freeze([
    "equals",
    "not_equals",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  relation: Object.freeze([
    "equals",
    "not_equals",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  multi_relation: Object.freeze([
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]),
  structured: Object.freeze([
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ])
});

const FILTER_KEYWORD_DEFINITIONS = Object.freeze([
  Object.freeze({ token: "@now", category: "datetime", label: "Now" }),
  Object.freeze({
    token: "@yesterday",
    category: "datetime",
    label: "Yesterday at the current time"
  }),
  Object.freeze({
    token: "@tomorrow",
    category: "datetime",
    label: "Tomorrow at the current time"
  }),
  Object.freeze({
    token: "@todayStart",
    category: "boundary",
    label: "Start of today"
  }),
  Object.freeze({
    token: "@todayEnd",
    category: "boundary",
    label: "End of today"
  }),
  Object.freeze({
    token: "@weekStart()",
    category: "boundary",
    label: "Start of this week"
  }),
  Object.freeze({
    token: "@weekEnd()",
    category: "boundary",
    label: "End of this week"
  }),
  Object.freeze({
    token: "@monthStart",
    category: "boundary",
    label: "Start of this month"
  }),
  Object.freeze({
    token: "@monthEnd",
    category: "boundary",
    label: "End of this month"
  }),
  Object.freeze({
    token: "@yearStart",
    category: "boundary",
    label: "Start of this year"
  }),
  Object.freeze({
    token: "@yearEnd",
    category: "boundary",
    label: "End of this year"
  }),
  Object.freeze({
    token: "@now.date()",
    category: "date",
    label: "Today"
  }),
  Object.freeze({
    token: "@yesterday.date()",
    category: "date",
    label: "Yesterday"
  }),
  Object.freeze({
    token: "@tomorrow.date()",
    category: "date",
    label: "Tomorrow"
  }),
  Object.freeze({
    token: "@weekStart.date()",
    category: "date",
    label: "This week's Monday"
  }),
  Object.freeze({
    token: "@weekEnd.date()",
    category: "date",
    label: "This week's Sunday"
  }),
  Object.freeze({
    token: "@days(N)",
    suggestion: "@days(0)",
    category: "relative",
    unit: "days",
    label: "Days from today"
  }),
  Object.freeze({
    token: "@weeks(N)",
    suggestion: "@weeks(0)",
    category: "relative",
    unit: "weeks",
    label: "Weeks from today"
  }),
  Object.freeze({
    token: "@months(N)",
    suggestion: "@months(0)",
    category: "relative",
    unit: "months",
    label: "Months from today"
  }),
  Object.freeze({ token: "@second", category: "number", label: "Second" }),
  Object.freeze({ token: "@minute", category: "number", label: "Minute" }),
  Object.freeze({ token: "@hour", category: "number", label: "Hour" }),
  Object.freeze({
    token: "@weekday",
    category: "number",
    label: `Weekday (${FILTER_WEEKDAY_ZERO} is 0)`
  }),
  Object.freeze({ token: "@day", category: "number", label: "Day" }),
  Object.freeze({ token: "@month", category: "number", label: "Month" }),
  Object.freeze({ token: "@year", category: "number", label: "Year" }),
  Object.freeze({ token: "@null", category: "null", label: "Null" }),
  Object.freeze({ token: "@true", category: "boolean", label: "True" }),
  Object.freeze({ token: "@false", category: "boolean", label: "False" })
]);

const FIXED_KEYWORDS = new Map(
  FILTER_KEYWORD_DEFINITIONS
    .filter((definition) => !definition.unit)
    .map((definition) => [definition.token, definition])
);
const RELATIVE_KEYWORDS = new Map(
  FILTER_KEYWORD_DEFINITIONS
    .filter((definition) => definition.unit)
    .map((definition) => [definition.unit, definition])
);

function createEmptyFilter() {
  return { mode: "all", children: [] };
}

function filterFieldKind(field = {}) {
  if (field.widget === "image") return "structured";
  if (field.widget === "tags") return "multi_relation";
  if (field.widget === "reference") {
    return field.multiple === true ? "multi_relation" : "relation";
  }
  if (field.widget === "boolean") return "boolean";
  if (field.widget === "number") return "number";
  if (
    field.widget === "datetime" ||
    field.display === "date" ||
    field.display === "datetime"
  ) {
    return "datetime";
  }
  if (field.widget === "select") return "choice";
  return "text";
}

function filterOperatorsForField(field) {
  return OPERATOR_IDS_BY_KIND[filterFieldKind(field)].map(
    (id) => FILTER_OPERATOR_DEFINITIONS[id]
  );
}

function filterOperatorRequiresValue(operator) {
  return FILTER_OPERATOR_DEFINITIONS[operator]?.unary === false;
}

function filterValueControl(field, operator) {
  if (!filterOperatorRequiresValue(operator)) return null;
  const kind = filterFieldKind(field);
  if (kind === "choice") return "select";
  if (kind === "multi_relation" || kind === "relation") return "reference";
  return kind;
}

function parseFilterKeyword(input) {
  if (typeof input !== "string") {
    return { matched: false, value: input };
  }

  const token = input.trim();
  const definition = FIXED_KEYWORDS.get(token);
  if (definition) {
    return { matched: true, valid: true, token, definition };
  }

  const relative = token.match(/^@(days|weeks|months)\(([+-]?\d+)\)$/);
  if (relative) {
    const argument = Number(relative[2]);
    return {
      matched: true,
      valid: Number.isSafeInteger(argument),
      token,
      argument,
      definition: RELATIVE_KEYWORDS.get(relative[1])
    };
  }

  return { matched: false, value: token };
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function formatLocalDate(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

function formatLocalDateTime(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${sign}${pad(
    Math.floor(absoluteOffset / 60)
  )}:${pad(absoluteOffset % 60)}`;
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function shiftCalendarDays(date, days) {
  const shifted = cloneDate(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function startOfDay(date) {
  const result = cloneDate(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date) {
  const result = cloneDate(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfWeek(date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function endOfWeek(date) {
  return endOfDay(shiftCalendarDays(startOfWeek(date), 6));
}

function startOfMonth(date) {
  const result = startOfDay(date);
  result.setDate(1);
  return result;
}

function endOfMonth(date) {
  const result = startOfDay(date);
  result.setMonth(result.getMonth() + 1, 0);
  return endOfDay(result);
}

function startOfYear(date) {
  const result = startOfDay(date);
  result.setMonth(0, 1);
  return result;
}

function endOfYear(date) {
  const result = startOfDay(date);
  result.setMonth(11, 31);
  return endOfDay(result);
}

function shiftCalendarMonths(date, months) {
  const result = cloneDate(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function normalizeNow(now) {
  const date = now instanceof Date ? cloneDate(now) : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Filter keyword resolution requires a valid current date.");
  }
  return date;
}

function resolveFilterKeyword(input, { now = new Date() } = {}) {
  const parsed = parseFilterKeyword(input);
  if (!parsed.matched) return parsed;
  if (!parsed.valid) {
    return {
      ...parsed,
      value: undefined,
      error: "Relative keyword offsets must be safe signed integers."
    };
  }

  const current = normalizeNow(now);
  const token = parsed.token;
  let value;

  if (token === "@now") value = formatLocalDateTime(current);
  else if (token === "@yesterday") {
    value = formatLocalDateTime(shiftCalendarDays(current, -1));
  } else if (token === "@tomorrow") {
    value = formatLocalDateTime(shiftCalendarDays(current, 1));
  } else if (token === "@todayStart") {
    value = formatLocalDateTime(startOfDay(current));
  } else if (token === "@todayEnd") {
    value = formatLocalDateTime(endOfDay(current));
  } else if (token === "@weekStart()") {
    value = formatLocalDateTime(startOfWeek(current));
  } else if (token === "@weekEnd()") {
    value = formatLocalDateTime(endOfWeek(current));
  } else if (token === "@monthStart") {
    value = formatLocalDateTime(startOfMonth(current));
  } else if (token === "@monthEnd") {
    value = formatLocalDateTime(endOfMonth(current));
  } else if (token === "@yearStart") {
    value = formatLocalDateTime(startOfYear(current));
  } else if (token === "@yearEnd") {
    value = formatLocalDateTime(endOfYear(current));
  } else if (token === "@now.date()") value = formatLocalDate(current);
  else if (token === "@yesterday.date()") {
    value = formatLocalDate(shiftCalendarDays(current, -1));
  } else if (token === "@tomorrow.date()") {
    value = formatLocalDate(shiftCalendarDays(current, 1));
  } else if (token === "@weekStart.date()") {
    value = formatLocalDate(startOfWeek(current));
  } else if (token === "@weekEnd.date()") {
    value = formatLocalDate(endOfWeek(current));
  } else if (parsed.definition.unit === "days") {
    value = formatLocalDate(shiftCalendarDays(current, parsed.argument));
  } else if (parsed.definition.unit === "weeks") {
    value = formatLocalDate(shiftCalendarDays(current, parsed.argument * 7));
  } else if (parsed.definition.unit === "months") {
    value = formatLocalDate(shiftCalendarMonths(current, parsed.argument));
  } else if (token === "@second") value = current.getSeconds();
  else if (token === "@minute") value = current.getMinutes();
  else if (token === "@hour") value = current.getHours();
  else if (token === "@weekday") value = current.getDay();
  else if (token === "@day") value = current.getDate();
  else if (token === "@month") value = current.getMonth() + 1;
  else if (token === "@year") value = current.getFullYear();
  else if (token === "@null") value = null;
  else if (token === "@true") value = true;
  else if (token === "@false") value = false;

  return { ...parsed, value };
}

function keywordIsCompatible(parsed, kind, operator) {
  if (!parsed.matched || !parsed.valid) return false;
  const category = parsed.definition.category;
  if (category === "null") {
    return ["equals", "not_equals"].includes(operator);
  }
  if (category === "boolean") {
    return kind === "boolean" && ["equals", "not_equals"].includes(operator);
  }
  if (category === "number") return kind === "number";
  return kind === "datetime";
}

function filterKeywordSuggestions(field, operator) {
  if (!filterOperatorRequiresValue(operator)) return [];
  const kind = filterFieldKind(field);
  return FILTER_KEYWORD_DEFINITIONS
    .filter((definition) => {
      const input = definition.suggestion || definition.token;
      return keywordIsCompatible(parseFilterKeyword(input), kind, operator);
    })
    .map((definition) => ({
      ...definition,
      suggestion: definition.suggestion || definition.token
    }));
}

function fieldMapValue(fields, name) {
  if (fields instanceof Map) return fields.get(name);
  if (Array.isArray(fields)) {
    return fields.find((field) => field?.name === name);
  }
  return fields?.[name];
}

function hasFieldMap(fields) {
  return fields instanceof Map || Array.isArray(fields) || (
    fields !== null && typeof fields === "object"
  );
}

function temporalValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? date.getTime()
      : null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function literalIsValid(value, kind) {
  if ([null, undefined].includes(value)) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (!["string", "number", "boolean"].includes(typeof value)) return false;
  if (kind === "number") {
    return value !== "" && Number.isFinite(Number(value));
  }
  if (kind === "datetime") return temporalValue(value) !== null;
  if (kind === "boolean") return typeof value === "boolean";
  return true;
}

function validationError(path, property, code, message) {
  return { path: [...path], property, code, message };
}

function validateFilterExpression(expression, { fields } = {}) {
  const errors = [];
  const ancestors = new WeakSet();

  function visitGroup(group, path, root = false) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      errors.push(
        validationError(path, null, "invalid_group", "Expected a filter group.")
      );
      return;
    }
    if (ancestors.has(group)) {
      errors.push(
        validationError(path, null, "cyclic_filter", "Filter groups cannot contain cycles.")
      );
      return;
    }
    ancestors.add(group);

    if (!["all", "any"].includes(group.mode)) {
      errors.push(
        validationError(
          path,
          "mode",
          "invalid_mode",
          "Choose whether this group matches all or any rules."
        )
      );
    }
    if (!Array.isArray(group.children)) {
      errors.push(
        validationError(
          path,
          "children",
          "invalid_children",
          "A filter group must contain an ordered rule list."
        )
      );
      ancestors.delete(group);
      return;
    }
    if (!root && group.children.length === 0) {
      errors.push(
        validationError(
          path,
          "children",
          "empty_group",
          "Add a rule to this group or remove the group."
        )
      );
    }

    group.children.forEach((child, index) => {
      const childPath = [...path, index];
      if (
        child &&
        typeof child === "object" &&
        !Array.isArray(child) &&
        Object.hasOwn(child, "children")
      ) {
        visitGroup(child, childPath);
      } else {
        visitRule(child, childPath);
      }
    });
    ancestors.delete(group);
  }

  function visitRule(rule, path) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(
        validationError(path, null, "invalid_rule", "Expected a filter rule.")
      );
      return;
    }
    const fieldName = typeof rule.field === "string" ? rule.field.trim() : "";
    if (!fieldName) {
      errors.push(
        validationError(path, "field", "missing_field", "Choose a field.")
      );
    }
    const field = fieldMapValue(fields, fieldName);
    if (fieldName && hasFieldMap(fields) && !field) {
      errors.push(
        validationError(
          path,
          "field",
          "unknown_field",
          `The field \"${fieldName}\" is no longer available.`
        )
      );
    }

    const operator =
      typeof rule.operator === "string" ? rule.operator.trim() : "";
    if (!operator) {
      errors.push(
        validationError(path, "operator", "missing_operator", "Choose an operator.")
      );
      return;
    }
    if (!FILTER_OPERATOR_DEFINITIONS[operator]) {
      errors.push(
        validationError(
          path,
          "operator",
          "unknown_operator",
          `The operator \"${operator}\" is not supported.`
        )
      );
      return;
    }

    const kind = filterFieldKind(field);
    if (field && !OPERATOR_IDS_BY_KIND[kind].includes(operator)) {
      errors.push(
        validationError(
          path,
          "operator",
          "incompatible_operator",
          `The operator \"${operator}\" cannot be used with this field.`
        )
      );
      return;
    }
    if (!filterOperatorRequiresValue(operator)) return;

    if (!Object.hasOwn(rule, "value")) {
      errors.push(
        validationError(path, "value", "missing_value", "Enter a value.")
      );
      return;
    }
    const parsed = parseFilterKeyword(rule.value);
    if (parsed.matched) {
      if (!parsed.valid) {
        errors.push(
          validationError(
            path,
            "value",
            "invalid_keyword",
            "Relative keyword offsets must be safe signed integers."
          )
        );
      } else if (field && !keywordIsCompatible(parsed, kind, operator)) {
        errors.push(
          validationError(
            path,
            "value",
            "incompatible_keyword",
            `The keyword \"${parsed.token}\" cannot be used with this field and operator.`
          )
        );
      }
      return;
    }
    if (!literalIsValid(parsed.value, kind)) {
      const message = kind === "number"
        ? "Enter a finite number or a compatible keyword."
        : kind === "datetime"
          ? "Enter an ISO 8601 date, datetime, or compatible keyword."
          : kind === "boolean"
            ? "Choose true or false."
            : "Enter a value; blank has no implicit meaning.";
      errors.push(validationError(path, "value", "invalid_value", message));
    }
  }

  visitGroup(expression, [], true);
  return { valid: errors.length === 0, errors };
}

function canonicalValue(value) {
  if (typeof value === "string") return value.trim();
  if ([null, undefined].includes(value)) return value;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return String(value);
}

function canonicalFilterExpression(expression) {
  const ancestors = new WeakSet();

  function canonicalNode(node, groupExpected = false) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    if (ancestors.has(node)) return null;
    ancestors.add(node);

    if (groupExpected || Object.hasOwn(node, "children")) {
      if (!["all", "any"].includes(node.mode) || !Array.isArray(node.children)) {
        ancestors.delete(node);
        return null;
      }
      const children = node.children.map((child) => canonicalNode(child));
      ancestors.delete(node);
      if (children.some((child) => child === null)) return null;
      return { mode: node.mode, children };
    }

    const field = typeof node.field === "string" ? node.field.trim() : "";
    const operator =
      typeof node.operator === "string" ? node.operator.trim() : "";
    if (!field || !FILTER_OPERATOR_DEFINITIONS[operator]) {
      ancestors.delete(node);
      return null;
    }
    const result = { field, operator };
    if (filterOperatorRequiresValue(operator) && Object.hasOwn(node, "value")) {
      result.value = canonicalValue(node.value);
    }
    ancestors.delete(node);
    return result;
  }

  return canonicalNode(expression, true);
}

function filterExpressionsEqual(left, right) {
  const canonicalLeft = canonicalFilterExpression(left);
  const canonicalRight = canonicalFilterExpression(right);
  if (!canonicalLeft || !canonicalRight) return false;
  return JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight);
}

function countFilterRules(expression) {
  const visited = new WeakSet();
  function count(node) {
    if (!node || typeof node !== "object" || visited.has(node)) return 0;
    visited.add(node);
    if (!Array.isArray(node.children)) return 1;
    return node.children.reduce((total, child) => total + count(child), 0);
  }
  return count(expression);
}

function isFilterExpressionEmpty(expression) {
  const canonical = canonicalFilterExpression(expression);
  return Boolean(canonical && canonical.children.length === 0);
}

function defaultFilterValue(item, fieldName) {
  if (fieldName === "$id") return item?.id;
  if (fieldName === "$created_at") return item?.created_at;
  if (fieldName === "$updated_at") return item?.updated_at;
  if (fieldName.startsWith("properties.")) {
    return fieldName
      .slice("properties.".length)
      .split(".")
      .reduce((value, key) => value?.[key], item?.properties);
  }
  if (item?.properties && Object.hasOwn(item.properties, fieldName)) {
    return item.properties[fieldName];
  }
  return item?.[fieldName];
}

function relationScalar(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value.ref;
  }
  return value;
}

function scalarEquals(left, right, kind) {
  const actual = relationScalar(left);
  if (right === null) return actual === null || actual === undefined;
  if (kind === "number") {
    return actual !== "" && Number.isFinite(Number(actual)) && Number(actual) === right;
  }
  if (kind === "datetime") {
    const actualTime = temporalValue(actual);
    return actualTime !== null && actualTime === right;
  }
  if (kind === "text") {
    return actual !== null && actual !== undefined &&
      String(actual).toLowerCase() === String(right).toLowerCase();
  }
  return Object.is(actual, right);
}

function isEmptyValue(value) {
  return value === "" || (Array.isArray(value) && value.length === 0);
}

function comparableRuleValue(value, kind, now) {
  const resolved = resolveFilterKeyword(value, { now });
  const result = resolved.matched ? resolved.value : resolved.value;
  if (kind === "number" && result !== null) return Number(result);
  if (kind === "datetime" && result !== null) return temporalValue(result);
  return result;
}

function evaluateRule(rule, item, options) {
  const field = fieldMapValue(options.fields, rule.field) ?? {};
  const kind = filterFieldKind(field);
  const actual = options.getValue(item, rule.field, field);
  const operator = rule.operator;

  if (operator === "is_null") return actual === null || actual === undefined;
  if (operator === "is_not_null") return actual !== null && actual !== undefined;
  if (operator === "is_empty") return isEmptyValue(actual);
  if (operator === "is_not_empty") {
    return actual !== null && actual !== undefined && !isEmptyValue(actual);
  }

  const expected = comparableRuleValue(rule.value, kind, options.now);
  if (operator === "equals") return scalarEquals(actual, expected, kind);
  if (operator === "not_equals") return !scalarEquals(actual, expected, kind);

  if (["contains", "not_contains"].includes(operator)) {
    let contains = false;
    if (kind === "multi_relation") {
      contains = Array.isArray(actual) && actual.some((value) =>
        Object.is(relationScalar(value), expected)
      );
    } else if (actual !== null && actual !== undefined) {
      contains = String(actual).toLowerCase().includes(String(expected).toLowerCase());
    }
    return operator === "contains" ? contains : !contains;
  }

  if (actual === null || actual === undefined || actual === "") return false;
  if (operator === "starts_with") {
    return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
  }
  if (operator === "ends_with") {
    return String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
  }

  const comparableActual = kind === "datetime"
    ? temporalValue(actual)
    : kind === "number"
      ? Number(actual)
      : actual;
  if (
    comparableActual === null ||
    !["number", "string"].includes(typeof comparableActual) ||
    (typeof comparableActual === "number" && !Number.isFinite(comparableActual))
  ) {
    return false;
  }
  if (operator === "greater_than") return comparableActual > expected;
  if (operator === "greater_than_or_equal") return comparableActual >= expected;
  if (operator === "less_than") return comparableActual < expected;
  if (operator === "less_than_or_equal") return comparableActual <= expected;
  return false;
}

function compileFilterExpression(
  expression,
  { fields, getValue = defaultFilterValue, now = new Date() } = {}
) {
  const validation = validateFilterExpression(expression, { fields });
  if (!validation.valid) {
    return { ...validation, test: () => false };
  }
  const canonical = canonicalFilterExpression(expression);
  const current = normalizeNow(now);

  function evaluateGroup(group, item, root = false) {
    if (root && group.children.length === 0) return true;
    const evaluateChild = (child) =>
      Array.isArray(child.children)
        ? evaluateGroup(child, item)
        : evaluateRule(child, item, { fields, getValue, now: current });
    return group.mode === "all"
      ? group.children.every(evaluateChild)
      : group.children.some(evaluateChild);
  }

  return {
    ...validation,
    expression: canonical,
    test: (item) => evaluateGroup(canonical, item, true)
  };
}

function evaluateFilterExpression(expression, item, options) {
  return compileFilterExpression(expression, options).test(item);
}

export {
  FILTER_KEYWORD_DEFINITIONS,
  FILTER_OPERATOR_DEFINITIONS,
  FILTER_WEEKDAY_ZERO,
  canonicalFilterExpression,
  compileFilterExpression,
  countFilterRules,
  createEmptyFilter,
  evaluateFilterExpression,
  filterExpressionsEqual,
  filterFieldKind,
  filterKeywordSuggestions,
  filterOperatorRequiresValue,
  filterOperatorsForField,
  filterValueControl,
  isFilterExpressionEmpty,
  parseFilterKeyword,
  resolveFilterKeyword,
  validateFilterExpression
};
