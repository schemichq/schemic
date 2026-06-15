import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { schemaStruct } from "../../src/cli/lower";
import { liftDb, lowerDb } from "../../src/driver/surreal-ir";
import { defineTable, s } from "../../src/pure";

// Milestone 2 PARITY ORACLE (the gate for flipping equality to structured deep-compare): lifting a
// real, type-rich authored schema into the portable IR and lowering it back must be IDENTITY. If it
// is, the PortableType layer is lossless for the Surreal dialect at the whole-DB level — so a
// structured deep-compare over it cannot miss a real change.

const User = defineTable("user", {
  name: s.string(),
  nickname: s.string().optional().nullable(),
});

const Account = defineTable("account", {
  email: s.string().$assert(surql`string::is_email($value)`),
  age: s.int().optional(),
  score: s.number().nullable(),
  status: s.enum(["active", "archived"]),
  tags: s.array(s.string()),
  profile: s.object({ bio: s.string().optional(), handle: s.string() }),
  owner: s.recordId("user").optional(),
  created: s.datetime().$default(surql`time::now()`),
});

describe("portable-IR lift/lower parity (Milestone 2 oracle)", () => {
  test("lower∘lift is identity on a type-rich schema", () => {
    const struct = schemaStruct([Account, User], []);
    expect(lowerDb(liftDb(struct))).toEqual(struct);
  });

  test("lift actually structures the types (not a string passthrough)", () => {
    const struct = schemaStruct([Account], []);
    const acct = liftDb(struct).tables.find((t) => t.name === "account");
    const byName = new Map(acct?.fields.map((f) => [f.name, f.type]));
    expect(byName.get("age")).toEqual({
      t: "option",
      inner: { t: "scalar", name: "int" },
    });
    expect(byName.get("score")).toEqual({
      t: "nullable",
      inner: { t: "scalar", name: "number" },
    });
    expect(byName.get("tags")).toEqual({
      t: "array",
      elem: { t: "scalar", name: "string" },
    });
    expect(byName.get("owner")).toEqual({
      t: "option",
      inner: { t: "record", tables: ["user"] },
    });
  });
});
