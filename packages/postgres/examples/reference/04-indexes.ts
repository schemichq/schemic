/** Indexes: column UNIQUE, secondary (.index), and composite UNIQUE. */
import { type ExampleGroup, example } from "./_kit";

export const group: ExampleGroup = {
  file: "04-indexes.ts",
  about: "CREATE [UNIQUE] INDEX — column $unique, secondary .index, composite",
  examples: [
    example({
      title: "column UNIQUE ($unique) -> CREATE UNIQUE INDEX",
      note: "the $unique convention names it <table>_<col>_key",
      code: `defineTable("user", { email: s.text().$unique() })`,
      ddl: `CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL
);
CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");`,
    }),
    example({
      title: "secondary index (.index)",
      note: "emit-only: non-unique indexes are not introspected back yet, so they do not round-trip (see COVERAGE)",
      code: `defineTable("post", { title: s.text() }).index(["title"])`,
      ddl: `CREATE TABLE "post" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL
);
CREATE INDEX "post_title_idx" ON "post" ("title");`,
    }),
    example({
      title: "composite UNIQUE index",
      code: `defineTable("membership", { org: s.text(), user: s.text() }).index(["org", "user"], { unique: true })`,
      ddl: `CREATE TABLE "membership" (
  "id" text PRIMARY KEY,
  "org" text NOT NULL,
  "user" text NOT NULL
);
CREATE UNIQUE INDEX "membership_org_user_idx" ON "membership" ("org", "user");`,
    }),
  ],
};
