import { describe, expect, test } from "bun:test";
import { renderPerFile } from "../../src/cli/pull";
import type {
  DbStructured,
  StructField,
  StructTable,
} from "../../src/cli/structure";
import { formatForAssert } from "../../src/pure";

const f = (name: string, kind: string, table: string): StructField => ({
  name,
  kind,
  table,
});
const t = (name: string, fields: StructField[]): StructTable => ({
  name,
  kind: { kind: "NORMAL" },
  schemafull: true,
  fields,
  indexes: [],
  events: [],
});

describe("renderPerFile", () => {
  const db: DbStructured = {
    tables: [
      t("user", [f("id", "string", "user"), f("name", "string", "user")]),
      t("post", [
        f("id", "string", "post"),
        f("author", "record<user>", "post"),
      ]),
    ],
    functions: [],
    accesses: [],
    analyzers: [],
  };

  test("renders one module per object, keyed by file path", () => {
    const files = renderPerFile(
      db,
      (_kind, name) => `database/schema/tables/${name}.ts`,
    );
    expect([...files.keys()].sort()).toEqual([
      "database/schema/tables/post.ts",
      "database/schema/tables/user.ts",
    ]);
  });

  test("a cross-table ref becomes an import (matching pull's dir layout)", () => {
    const files = renderPerFile(db, (_kind, name) => `tables/${name}.ts`);
    const post = files.get("tables/post.ts") ?? "";
    expect(post).toContain(`import { User } from "./user";`);
    expect(post).toContain("author: User.record()");
    const user = files.get("tables/user.ts") ?? "";
    expect(user).toContain("export const User = defineTable(");
    expect(user).not.toContain("import { User }");
  });

  test("literal defaults render bare; expressions stay surql (with surql from surrealdb)", () => {
    const withDefaults: DbStructured = {
      tables: [
        {
          name: "thing",
          kind: { kind: "NORMAL" },
          schemafull: true,
          indexes: [],
          events: [],
          fields: [
            { name: "id", kind: "string", table: "thing" },
            // a bare literal — must round-trip as a plain JS value, not wrapped in surql
            {
              name: "archived",
              kind: "bool",
              default: "false",
              table: "thing",
            },
            { name: "count", kind: "int", default: "0", table: "thing" },
            // an expression — must stay tagged surql, and pull surql in from surrealdb
            {
              name: "createdAt",
              kind: "datetime",
              default: "time::now()",
              table: "thing",
            },
          ],
        },
      ],
      functions: [],
      accesses: [],
      analyzers: [],
    };
    const out = renderPerFile(withDefaults, (_k, n) => `${n}.ts`).get(
      "thing.ts",
    );
    if (!out) throw new Error("no thing.ts");
    expect(out).toContain(".$default(false)");
    expect(out).toContain(".$default(0)");
    expect(out).toContain(".$default(surql`time::now()`)");
    expect(out).not.toContain(".$default(surql`false`)");
    // surql is imported from surrealdb, NOT folded into the @schemic/core import.
    expect(out).toContain(`import { surql } from "surrealdb";`);
    expect(out).toContain(
      `import { s, defineTable } from "@schemic/surrealdb";`,
    );
  });

  test("a record field's REFERENCE round-trips to .$reference(...) (VALUE preserved)", () => {
    const withRef: DbStructured = {
      tables: [
        t("account", [f("id", "string", "account")]),
        {
          name: "comment",
          kind: { kind: "NORMAL" },
          schemafull: true,
          indexes: [],
          events: [],
          fields: [
            f("id", "string", "comment"),
            // bare REFERENCE (or the materialized default IGNORE) -> .$reference()
            {
              name: "ref",
              kind: "record<account>",
              reference: {},
              table: "comment",
            },
            // ON DELETE UNSET *and* a VALUE — the original bug dropped the reference entirely.
            {
              name: "author",
              kind: "record<account>",
              reference: { on_delete: "UNSET" },
              value: "fn::validate::user_exists()",
              table: "comment",
            },
          ],
        },
      ],
      functions: [],
      accesses: [],
      analyzers: [],
    };
    const out =
      renderPerFile(withRef, (_k, n) => `${n}.ts`).get("comment.ts") ?? "";
    expect(out).toContain(".$reference()");
    expect(out).toContain('.$reference({ onDelete: "unset" })');
    expect(out).toContain(".$value(surql`fn::validate::user_exists()`)");
  });
});

describe("formatForAssert", () => {
  test("recovers a format name from an exact baked assert; rejects anything else", () => {
    expect(formatForAssert("string::is_email($value)")).toBe("email");
    expect(formatForAssert("string::is_url( $value )")).toBe("url"); // spacing-tolerant
    expect(formatForAssert("string::is_ipv4($value)")).toBe("ipv4");
    expect(formatForAssert("string::len($value) < 5")).toBeUndefined(); // not a format
    expect(
      formatForAssert("string::is_email($value) AND $value != NONE"),
    ).toBeUndefined(); // combined → not swallowed
    expect(formatForAssert("string::is_madeup($value)")).toBeUndefined();
  });
});

describe("pull reverses native codecs / string formats", () => {
  const sf = (name: string, kind: string, extra: Partial<StructField> = {}) =>
    ({ name, kind, table: "t", ...extra }) as StructField;
  const render = (fields: StructField[]): string => {
    const db: DbStructured = {
      tables: [
        {
          name: "t",
          kind: { kind: "NORMAL" },
          schemafull: true,
          fields,
          indexes: [],
          events: [],
        },
      ],
      functions: [],
      accesses: [],
      analyzers: [],
    };
    return renderPerFile(db, (_k, n) => `${n}.ts`).get("t.ts") ?? "";
  };

  test("string-format asserts reverse to the builder; the $assert is dropped", () => {
    const out = render([
      sf("id", "string"),
      sf("email", "string", { assert: "string::is_email($value)" }),
      sf("site", "option<string>", { assert: "string::is_url($value)" }),
      sf("handle", "string", { assert: "string::is_alpha($value)" }),
    ]);
    expect(out).toContain("email: s.email()");
    expect(out).toContain("site: s.url().optional()");
    expect(out).toContain("handle: s.alpha()");
    expect(out).not.toContain("string::is_email");
  });

  test("a non-format assert stays string + $assert (never swallowed)", () => {
    const out = render([
      sf("id", "string"),
      sf("notes", "string", { assert: "string::len($value) < 5" }),
    ]);
    expect(out).toContain(
      "notes: s.string().$assert(surql`string::len($value) < 5`)",
    );
  });

  test("file and geometry native types reverse from the type name", () => {
    const out = render([
      sf("id", "string"),
      sf("doc", "file"),
      sf("loc", "geometry<point>"),
    ]);
    expect(out).toContain("doc: s.file()");
    expect(out).toContain('loc: s.geometry("point")');
  });

  test("a NORMAL table keeps fields literally named `in`/`out`", () => {
    // Regression: `in`/`out` are the implicit endpoints of a RELATION only. On a plain table a user
    // can define record fields named `in`/`out` (`DEFINE FIELD in ON order TYPE record<person>`);
    // pull was dropping them along with relation endpoints. They must survive on a NORMAL table.
    const db: DbStructured = {
      tables: [
        t("order", [
          f("currency", "string", "order"),
          f("in", "record<person>", "order"),
          f("out", "record<product>", "order"),
        ]),
      ],
      functions: [],
      accesses: [],
      analyzers: [],
    };
    const out = renderPerFile(db, (_k, n) => `${n}.ts`).get("order.ts") ?? "";
    expect(out).toContain("export const Order = defineTable(");
    expect(out).toContain('in: s.recordId("person")');
    expect(out).toContain('out: s.recordId("product")');
  });

  test("a RELATION still omits implicit in/out (endpoints render via from/to)", () => {
    const db: DbStructured = {
      tables: [
        {
          name: "likes",
          kind: { kind: "RELATION", in: ["person"], out: ["product"] },
          schemafull: true,
          fields: [
            f("since", "datetime", "likes"),
            f("in", "record<person>", "likes"),
            f("out", "record<product>", "likes"),
          ],
          indexes: [],
          events: [],
        },
      ],
      functions: [],
      accesses: [],
      analyzers: [],
    };
    const out = renderPerFile(db, (_k, n) => `${n}.ts`).get("likes.ts") ?? "";
    expect(out).toContain("export const Likes = defineRelation(");
    expect(out).toContain("since: s.datetime()");
    expect(out).not.toContain("in: s.recordId");
    expect(out).not.toContain("out: s.recordId");
  });
});
