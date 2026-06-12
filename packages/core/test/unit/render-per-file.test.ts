import { describe, expect, test } from "bun:test";
import { renderPerFile } from "../../src/cli/pull";
import type {
  DbStructured,
  StructField,
  StructTable,
} from "../../src/cli/structure";

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
});
