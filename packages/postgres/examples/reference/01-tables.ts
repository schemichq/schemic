/** Tables: the implicit `id` primary key, composite/custom PK, and table-level CHECK. */
import { defineTable, s } from "../../src/authoring";
import type { ExampleGroup } from "./_kit";

export const group: ExampleGroup = {
  file: "01-tables.ts",
  about: "CREATE TABLE — implicit id PK, composite PK, table-level CHECK",
  examples: [
    {
      title: "implicit id primary key",
      note: 'no PK authored -> the driver adds `"id" text PRIMARY KEY` (mirrors Surreal\'s record id)',
      defs: [defineTable("user", { name: s.text() })],
      ddl: `CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL
);`,
    },
    {
      title: "composite primary key replaces the implicit id",
      defs: [
        defineTable("member", { org: s.text(), person: s.text() }).primaryKey(
          "org",
          "person",
        ),
      ],
      ddl: `CREATE TABLE "member" (
  "org" text NOT NULL,
  "person" text NOT NULL,
  PRIMARY KEY ("org", "person")
);`,
    },
    {
      title: "table-level CHECK",
      note: "emit-faithful; excluded from change-detection (PG rewrites expressions on read)",
      defs: [
        defineTable("account", { balance: s.numeric(12, 2) }).check(
          "balance >= 0",
        ),
      ],
      ddl: `CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "balance" numeric(12, 2) NOT NULL,
  CHECK (balance >= 0)
);`,
    },
  ],
};
