/** Tables: the implicit `id` primary key, composite/custom PK, and table-level CHECK. */
import { type ExampleGroup, example } from "./_kit";

export const group: ExampleGroup = {
  file: "01-tables.ts",
  about: "CREATE TABLE — implicit id PK, composite PK, table-level CHECK",
  examples: [
    example({
      title: "implicit id primary key",
      note: 'no PK authored -> the driver adds `"id" text PRIMARY KEY` (mirrors Surreal\'s record id)',
      code: `defineTable("user", { name: s.text() })`,
      ddl: `CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL
);`,
    }),
    example({
      title: "composite primary key replaces the implicit id",
      code: `defineTable("member", { org: s.text(), person: s.text() }).primaryKey("org", "person")`,
      ddl: `CREATE TABLE "member" (
  "org" text NOT NULL,
  "person" text NOT NULL,
  PRIMARY KEY ("org", "person")
);`,
    }),
    example({
      title: "table-level CHECK",
      note: "emit-faithful; excluded from change-detection (PG rewrites expressions on read)",
      code: `defineTable("account", { balance: s.numeric(12, 2) }).check("balance >= 0")`,
      ddl: `CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "balance" numeric(12, 2) NOT NULL,
  CHECK (balance >= 0)
);`,
    }),
  ],
};
