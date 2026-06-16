import { describe, expect, test } from "bun:test";
import {
  deepEqual,
  normalizeFunction,
  normalizeTable,
  normalizeType,
} from "../../src/cli/struct";
import type { StructField, StructTable } from "../../src/cli/structure";

const field = (
  name: string,
  kind: string,
  extra: Partial<StructField> = {},
): StructField => ({ name, kind, table: "t", ...extra });

const table = (
  fields: StructField[],
  extra: Partial<StructTable> = {},
): StructTable => ({
  name: "t",
  kind: { kind: "NORMAL" },
  schemafull: true,
  fields,
  indexes: [],
  events: [],
  ...extra,
});

describe("normalizeType", () => {
  test("folds `T | none` into option<T> (gotcha 1), both orders", () => {
    expect(normalizeType("none | int")).toBe("option<int>");
    expect(normalizeType("int | none")).toBe("option<int>");
    expect(normalizeType("option<int>")).toBe("option<int>");
  });

  test("keeps `T | null` distinct from option (nullable is a different type)", () => {
    expect(normalizeType("int | null")).toBe("int | null");
    expect(normalizeType("null | int")).toBe("int | null");
  });

  test("sorts record<> multi-targets with space-pipe-space (gotcha 3)", () => {
    expect(normalizeType("record<zebra | apple>")).toBe(
      "record<apple | zebra>",
    );
    expect(normalizeType("record<b|a>")).toBe("record<a | b>");
    expect(normalizeType("record<user>")).toBe("record<user>");
  });

  test("sorts literal unions (gotcha 2)", () => {
    expect(normalizeType("'b' | 'a'")).toBe("'a' | 'b'");
    expect(normalizeType("'a'")).toBe("'a'");
  });

  test("canonicalizes double-quoted literals to single (inferField vs INFO)", () => {
    expect(normalizeType('"admin"')).toBe("'admin'");
    expect(normalizeType('"b" | "a"')).toBe("'a' | 'b'");
    // mixed authoring still converges
    expect(normalizeType("\"b\" | 'a'")).toBe("'a' | 'b'");
  });

  test("keeps array/set size N with comma-space spelling (gotcha 4)", () => {
    expect(normalizeType("array<string,3>")).toBe("array<string, 3>");
    expect(normalizeType("set<int, 5>")).toBe("set<int, 5>");
    expect(normalizeType("array<string>")).toBe("array<string>");
  });

  test("recurses into nested constructors", () => {
    expect(normalizeType("option<array<record<b|a>>>")).toBe(
      "option<array<record<a | b>>>",
    );
  });

  test("is idempotent", () => {
    for (const k of [
      "none | int",
      "record<zebra | apple>",
      "'b' | 'a'",
      "array<string,3>",
      "option<array<record<b|a>>>",
    ])
      expect(normalizeType(normalizeType(k))).toBe(normalizeType(k));
  });
});

describe("normalizeTable", () => {
  test("drops the implicit id field (normal table)", () => {
    const out = normalizeTable(
      table([field("id", "record<t>"), field("name", "string")]),
    );
    expect(out.fields.map((f) => f.name)).toEqual(["name"]);
  });

  test("drops implicit in/out on a relation", () => {
    const out = normalizeTable(
      table(
        [
          field("in", "record<a>"),
          field("out", "record<b>"),
          field("at", "datetime"),
        ],
        {
          kind: { kind: "RELATION", in: ["a"], out: ["b"] },
        },
      ),
    );
    expect(out.fields.map((f) => f.name)).toEqual(["at"]);
  });

  test("sorts fields parent-before-child", () => {
    const out = normalizeTable(
      table([
        field("address.city", "string"),
        field("name", "string"),
        field("address", "object"),
      ]),
    );
    expect(out.fields.map((f) => f.name)).toEqual([
      "address",
      "address.city",
      "name",
    ]);
  });

  test("folds a trivial array element into the parent type and drops `x.*`", () => {
    const out = normalizeTable(
      table([field("tags", "array"), field("tags.*", "string")]),
    );
    expect(out.fields.map((f) => f.name)).toEqual(["tags"]);
    expect(out.fields[0].kind).toBe("array<string>");
  });

  test("keeps a customized array element", () => {
    const out = normalizeTable(
      table([
        field("tags", "array"),
        field("tags.*", "string", { assert: "string::len($value) > 0" }),
      ]),
    );
    expect(out.fields.map((f) => f.name)).toEqual(["tags", "tags.*"]);
  });

  test("strips default permissions (table NONE, field FULL) to undefined", () => {
    const out = normalizeTable(
      table(
        [
          field("name", "string", {
            permissions: { select: true, create: true, update: true },
          }),
        ],
        {
          permissions: {
            select: false,
            create: false,
            update: false,
            delete: false,
          },
        },
      ),
    );
    expect(out.permissions).toBeUndefined();
    expect(out.fields[0].permissions).toBeUndefined();
  });
});

describe("convergence (the unifier in miniature)", () => {
  test("a fromTableDef-shaped table and a fromInfo-shaped table normalize deep-equal", () => {
    // As fromTableDef would emit: declares id, option<int>, fields in author order, no perms.
    const fromTableDef = table([
      field("email", "string"),
      field("id", "record<t>"),
      field("age", "option<int>"),
    ]);
    // As fromInfo (INFO STRUCTURE) returns: no id, option expanded to `none | int`, other field
    // order, default permissions materialized.
    const fromInfo = table([
      field("age", "none | int"),
      field("email", "string", {
        permissions: { select: true, create: true, update: true },
      }),
    ]);
    expect(
      deepEqual(normalizeTable(fromTableDef), normalizeTable(fromInfo)),
    ).toBe(true);
  });
});

describe("normalizeFunction", () => {
  test("strips the default FULL execute permission", () => {
    expect(
      normalizeFunction({ name: "f", args: [], block: "{}", permissions: true })
        .permissions,
    ).toBeUndefined();
    expect(
      normalizeFunction({
        name: "f",
        args: [],
        block: "{}",
        permissions: false,
      }).permissions,
    ).toBe(false);
  });
});

describe("deepEqual", () => {
  test("ignores key order, respects array order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: { x: 1 } }, { a: { x: 2 } })).toBe(false);
  });
});
