import assert from "node:assert/strict";
import test from "node:test";
import {
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
} from "./advancedFilter.js";

const fields = {
  title: { label: "Title", widget: "string" },
  score: { label: "Score", widget: "number" },
  published: { label: "Published", widget: "boolean" },
  released: { label: "Released", widget: "datetime" },
  status: {
    label: "Status",
    widget: "select",
    options: ["draft", "published"]
  },
  author: { label: "Author", widget: "reference", collection: "authors" },
  contributors: {
    label: "Contributors",
    widget: "reference",
    collection: "authors",
    multiple: true
  },
  tags: { label: "Tags", widget: "tags", collection: "tags" },
  hero: { label: "Hero", widget: "image" },
  $updated_at: { label: "Updated", display: "datetime" }
};

function operatorIds(field) {
  return filterOperatorsForField(field).map(({ id }) => id);
}

test("derives stable operator matrices and value controls from field metadata", () => {
  assert.equal(filterFieldKind(fields.title), "text");
  assert.equal(filterFieldKind(fields.score), "number");
  assert.equal(filterFieldKind(fields.released), "datetime");
  assert.equal(filterFieldKind(fields.published), "boolean");
  assert.equal(filterFieldKind(fields.status), "choice");
  assert.equal(filterFieldKind(fields.author), "relation");
  assert.equal(filterFieldKind(fields.tags), "multi_relation");
  assert.equal(filterFieldKind(fields.hero), "structured");
  assert.equal(filterFieldKind(fields.$updated_at), "datetime");

  assert.deepEqual(operatorIds(fields.title), [
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
  ]);
  assert.deepEqual(operatorIds(fields.tags), [
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]);
  assert.deepEqual(operatorIds(fields.hero), [
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null"
  ]);
  assert.ok(operatorIds(fields.score).includes("greater_than_or_equal"));
  assert.equal(operatorIds(fields.published).includes("contains"), false);
  assert.equal(filterOperatorRequiresValue("equals"), true);
  assert.equal(filterOperatorRequiresValue("is_null"), false);
  assert.equal(filterValueControl(fields.status, "equals"), "select");
  assert.equal(filterValueControl(fields.author, "equals"), "reference");
  assert.equal(filterValueControl(fields.score, "greater_than"), "number");
  assert.equal(filterValueControl(fields.title, "is_empty"), null);
});

test("recognizes only complete case-sensitive keyword tokens after trimming", () => {
  assert.deepEqual(
    (({ matched, valid, token }) => ({ matched, valid, token }))(
      parseFilterKeyword("  @now  ")
    ),
    { matched: true, valid: true, token: "@now" }
  );
  assert.equal(parseFilterKeyword("@Now").matched, false);
  assert.equal(parseFilterKeyword("before @now").matched, false);
  assert.equal(parseFilterKeyword("@days( 2)").matched, false);

  const relative = parseFilterKeyword("@weeks(-12)");
  assert.equal(relative.matched, true);
  assert.equal(relative.valid, true);
  assert.equal(relative.argument, -12);
  assert.equal(relative.definition.unit, "weeks");

  const positive = parseFilterKeyword("@months(+3)");
  assert.equal(positive.argument, 3);
  assert.equal(
    parseFilterKeyword("@days(999999999999999999999999)").valid,
    false
  );
  assert.deepEqual(parseFilterKeyword(" literal value "), {
    matched: false,
    value: "literal value"
  });
});

test("offers only keywords compatible with the selected field and operator", () => {
  const datetimeEquality = filterKeywordSuggestions(fields.released, "equals")
    .map(({ suggestion }) => suggestion);
  assert.ok(datetimeEquality.includes("@now"));
  assert.ok(datetimeEquality.includes("@days(0)"));
  assert.ok(datetimeEquality.includes("@null"));
  assert.equal(datetimeEquality.includes("@year"), false);

  const datetimeComparison = filterKeywordSuggestions(
    fields.released,
    "greater_than"
  ).map(({ suggestion }) => suggestion);
  assert.ok(datetimeComparison.includes("@todayStart"));
  assert.equal(datetimeComparison.includes("@null"), false);

  const numbers = filterKeywordSuggestions(fields.score, "less_than")
    .map(({ suggestion }) => suggestion);
  assert.ok(numbers.includes("@weekday"));
  assert.equal(numbers.includes("@now"), false);

  assert.deepEqual(
    filterKeywordSuggestions(fields.published, "equals")
      .map(({ suggestion }) => suggestion),
    ["@null", "@true", "@false"]
  );
  assert.deepEqual(filterKeywordSuggestions(fields.title, "contains"), []);
  assert.deepEqual(filterKeywordSuggestions(fields.title, "is_empty"), []);
});

test("resolves datetime, boundary, and date keywords in local calendar time", () => {
  const now = new Date(2025, 2, 5, 14, 6, 7, 8); // Wednesday.
  const resolvedNow = resolveFilterKeyword("@now", { now }).value;
  assert.match(
    resolvedNow,
    /^2025-03-05T14:06:07\.008(?:[+-]\d{2}:\d{2})$/
  );
  assert.equal(new Date(resolvedNow).getTime(), now.getTime());

  assert.equal(
    resolveFilterKeyword("@yesterday.date()", { now }).value,
    "2025-03-04"
  );
  assert.equal(
    resolveFilterKeyword("@tomorrow.date()", { now }).value,
    "2025-03-06"
  );
  assert.equal(
    resolveFilterKeyword("@weekStart.date()", { now }).value,
    "2025-03-03"
  );
  assert.equal(
    resolveFilterKeyword("@weekEnd.date()", { now }).value,
    "2025-03-09"
  );

  const start = new Date(resolveFilterKeyword("@todayStart", { now }).value);
  assert.deepEqual(
    [start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()],
    [0, 0, 0, 0]
  );
  const end = new Date(resolveFilterKeyword("@todayEnd", { now }).value);
  assert.deepEqual(
    [end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()],
    [23, 59, 59, 999]
  );

  const weekStart = new Date(
    resolveFilterKeyword("@weekStart()", { now }).value
  );
  const weekEnd = new Date(resolveFilterKeyword("@weekEnd()", { now }).value);
  assert.equal(weekStart.getDay(), 1);
  assert.equal(weekEnd.getDay(), 0);
  assert.equal(FILTER_WEEKDAY_ZERO, "Sunday");
});

test("resolves relative dates with calendar arithmetic and month-end clamping", () => {
  const now = new Date(2025, 0, 31, 18, 0, 0, 0);
  assert.equal(resolveFilterKeyword("@days(-2)", { now }).value, "2025-01-29");
  assert.equal(resolveFilterKeyword("@weeks(+1)", { now }).value, "2025-02-07");
  assert.equal(resolveFilterKeyword("@months(1)", { now }).value, "2025-02-28");
  assert.equal(resolveFilterKeyword("@months(-1)", { now }).value, "2024-12-31");

  const sunday = new Date(2025, 5, 8, 10, 11, 12, 0);
  assert.equal(resolveFilterKeyword("@weekday", { now: sunday }).value, 0);
  assert.equal(resolveFilterKeyword("@month", { now: sunday }).value, 6);
  assert.equal(resolveFilterKeyword("@year", { now: sunday }).value, 2025);
  assert.equal(resolveFilterKeyword("@null", { now }).value, null);
  assert.equal(resolveFilterKeyword("@true", { now }).value, true);
  assert.equal(resolveFilterKeyword("@false", { now }).value, false);
});

test("validates empty roots and complete nested boolean expressions", () => {
  const empty = createEmptyFilter();
  assert.deepEqual(empty, { mode: "all", children: [] });
  assert.deepEqual(validateFilterExpression(empty, { fields }), {
    valid: true,
    errors: []
  });
  assert.equal(isFilterExpressionEmpty(empty), true);

  const expression = {
    mode: "all",
    children: [
      { field: "title", operator: "contains", value: "Beowulf" },
      {
        mode: "any",
        children: [
          { field: "score", operator: "greater_than", value: "4" },
          { field: "published", operator: "equals", value: "@true" }
        ]
      }
    ]
  };
  assert.deepEqual(validateFilterExpression(expression, { fields }), {
    valid: true,
    errors: []
  });
  assert.equal(countFilterRules(expression), 3);
  assert.equal(isFilterExpressionEmpty(expression), false);
});

test("reports path-addressable errors without silently dropping invalid rules", () => {
  const expression = {
    mode: "all",
    children: [
      { field: "missing", operator: "equals", value: "x" },
      { field: "title", operator: "greater_than", value: "x" },
      { field: "score", operator: "equals", value: "" },
      { field: "title", operator: "equals", value: "@now" },
      { field: "released", operator: "equals", value: "2025-02-30" },
      { mode: "any", children: [] }
    ]
  };
  const validation = validateFilterExpression(expression, { fields });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.map(({ path, property, code }) => ({ path, property, code })),
    [
      { path: [0], property: "field", code: "unknown_field" },
      { path: [1], property: "operator", code: "incompatible_operator" },
      { path: [2], property: "value", code: "invalid_value" },
      { path: [3], property: "value", code: "incompatible_keyword" },
      { path: [4], property: "value", code: "invalid_value" },
      { path: [5], property: "children", code: "empty_group" }
    ]
  );
});

test("accepts typed fields as a Map or named array", () => {
  const expression = {
    mode: "all",
    children: [{ field: "score", operator: "equals", value: 2 }]
  };
  assert.equal(
    validateFilterExpression(expression, {
      fields: new Map([["score", fields.score]])
    }).valid,
    true
  );
  assert.equal(
    validateFilterExpression(expression, {
      fields: [{ name: "score", ...fields.score }]
    }).valid,
    true
  );
});

test("canonicalizes stable AST data and compares ordered expressions", () => {
  const expression = {
    mode: "all",
    localId: "draft-only",
    children: [
      {
        operator: "contains",
        value: "  Beowulf  ",
        field: " title ",
        error: "ignored"
      },
      {
        field: "status",
        operator: "is_null",
        value: "this unary value is ignored"
      }
    ]
  };
  const canonical = canonicalFilterExpression(expression);
  assert.deepEqual(canonical, {
    mode: "all",
    children: [
      { field: "title", operator: "contains", value: "Beowulf" },
      { field: "status", operator: "is_null" }
    ]
  });
  assert.equal(filterExpressionsEqual(expression, canonical), true);
  assert.equal(
    filterExpressionsEqual(canonical, {
      ...canonical,
      children: [...canonical.children].reverse()
    }),
    false
  );
  assert.equal(filterExpressionsEqual({}, {}), false);
});

test("evaluates nested all/any groups and short-circuits children", () => {
  const expression = {
    mode: "all",
    children: [
      { field: "title", operator: "contains", value: "wulf" },
      {
        mode: "any",
        children: [
          { field: "score", operator: "greater_than_or_equal", value: 8 },
          { field: "published", operator: "equals", value: "@true" },
          { field: "status", operator: "equals", value: "never reached" }
        ]
      }
    ]
  };
  const item = {
    id: "source-1",
    properties: { title: "Beowulf", score: 7, published: true }
  };
  const calls = [];
  const compiled = compileFilterExpression(expression, {
    fields,
    getValue(current, field) {
      calls.push(field);
      return current.properties[field];
    },
    now: new Date(2025, 0, 1)
  });
  assert.equal(compiled.valid, true);
  assert.equal(compiled.test(item), true);
  assert.deepEqual(calls, ["title", "score", "published"]);

  calls.length = 0;
  assert.equal(
    compiled.test({ ...item, properties: { ...item.properties, title: "Grendel" } }),
    false
  );
  assert.deepEqual(calls, ["title"]);
});

test("evaluates scalar, relation, collection, and system-field values", () => {
  const expression = {
    mode: "all",
    children: [
      { field: "status", operator: "equals", value: "published" },
      { field: "author", operator: "equals", value: "author-1" },
      { field: "tags", operator: "contains", value: "tag-2" },
      { field: "$updated_at", operator: "less_than", value: "@tomorrow" }
    ]
  };
  const item = {
    id: "source-1",
    updated_at: "2025-03-05T20:00:00Z",
    properties: {
      status: "published",
      author: { ref: "author-1", selections: {} },
      tags: ["tag-1", "tag-2"]
    }
  };
  assert.equal(
    evaluateFilterExpression(expression, item, {
      fields,
      now: new Date(2025, 2, 5, 12, 0, 0)
    }),
    true
  );

  item.properties.tags = ["tag-1"];
  assert.equal(
    evaluateFilterExpression(expression, item, {
      fields,
      now: new Date(2025, 2, 5, 12, 0, 0)
    }),
    false
  );
});

test("keeps null and empty values distinct", () => {
  const cases = [
    ["is_null", null, true],
    ["is_null", "", false],
    ["is_empty", "", true],
    ["is_empty", null, false],
    ["is_not_empty", "value", true],
    ["is_not_empty", null, false],
    ["equals", null, true],
    ["equals", "", false]
  ];
  for (const [operator, value, expected] of cases) {
    const rule = operator === "equals"
      ? { field: "title", operator, value: "@null" }
      : { field: "title", operator };
    assert.equal(
      evaluateFilterExpression(
        { mode: "all", children: [rule] },
        { properties: { title: value } },
        { fields }
      ),
      expected,
      `${operator} against ${String(value)}`
    );
  }
});

test("resolves keywords once when compiling a query", () => {
  const expression = {
    mode: "all",
    children: [{ field: "score", operator: "equals", value: "@month" }]
  };
  const january = compileFilterExpression(expression, {
    fields,
    now: new Date(2025, 0, 31, 23, 59, 59)
  });
  const february = compileFilterExpression(expression, {
    fields,
    now: new Date(2025, 1, 1, 0, 0, 0)
  });
  assert.equal(january.test({ properties: { score: 1 } }), true);
  assert.equal(january.test({ properties: { score: 2 } }), false);
  assert.equal(february.test({ properties: { score: 2 } }), true);
});

test("an invalid expression compiles atomically to an always-false predicate", () => {
  const expression = {
    mode: "any",
    children: [
      { field: "title", operator: "equals", value: "Beowulf" },
      { field: "missing", operator: "equals", value: "anything" }
    ]
  };
  const compiled = compileFilterExpression(expression, { fields });
  assert.equal(compiled.valid, false);
  assert.equal(compiled.test({ properties: { title: "Beowulf" } }), false);
});

test("the empty root is a no-op predicate", () => {
  const empty = compileFilterExpression(createEmptyFilter(), { fields });
  assert.equal(empty.valid, true);
  assert.equal(empty.test({}), true);
});
