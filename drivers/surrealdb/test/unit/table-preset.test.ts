// Table PRESETS (ratified cross-driver): defineTable.preset({ columns?, permissions?, events?,
// indexes? }) applied via CHAINED TableDef.use(preset). Columns typed-merge (a name clash is a
// compile error + runtime throw), permissions per-op AND-combine (narrow, never widen),
// events/indexes append. Configurable presets are plain functions returning one.
import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { emitTable } from "../../src/ddl";
import { defineTable, s } from "../../src/index";

// -- reusable presets (the gulybyte tenant-table shape, generalized) ------------------------------

const timestamps = () =>
  defineTable.preset({
    columns: {
      createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
      updatedAt: s.datetime().$value(surql`time::now()`),
    },
  });

const tenantCol = () => s.string().$readonly();
const tenant = <K extends string>(field: K) =>
  defineTable.preset({
    columns: { [field]: tenantCol() } as Record<
      K,
      ReturnType<typeof tenantCol>
    >,
    // Scope every op to the caller's org (static expr here; the column name is for the rows).
    permissions: surql`$auth.org != NONE`,
    events: [
      {
        name: "tenant_guard",
        when: surql`$event = 'UPDATE'`,
        then: surql`RETURN true`,
      },
    ],
    indexes: [{ name: `by_${field}`, fields: [field] }],
  });

describe("defineTable.preset + .use: columns typed-merge", () => {
  const Doc = defineTable("preset_doc", { title: s.string() })
    .use(tenant("org_id"))
    .use(timestamps());

  test("preset columns land in the table (chained, both presets)", () => {
    const ddl = emitTable(Doc);
    expect(ddl).toContain("DEFINE FIELD title ON TABLE preset_doc");
    expect(ddl).toContain("DEFINE FIELD org_id ON TABLE preset_doc");
    expect(ddl).toContain("DEFINE FIELD createdAt ON TABLE preset_doc");
    expect(ddl).toContain("DEFINE FIELD updatedAt ON TABLE preset_doc");
  });

  test("the merge is TYPED — preset columns are real fields on .fields at any chain depth", () => {
    // Compile-time: these property accesses only typecheck if the merge carried the types.
    const f = Doc.fields;
    expect(f.org_id).toBeDefined();
    expect(f.createdAt).toBeDefined();
    expect(f.updatedAt).toBeDefined();
    expect(f.title).toBeDefined();
  });

  test("derived .create/.update see preset columns with their flags", () => {
    // createdAt: $default + $readonly -> optional on create, excluded from update.
    const created = Doc.create.safeParse({ title: "t", org_id: "acme" });
    expect(created.success).toBe(true);
    const updated = Doc.update.safeParse({ title: "t2" });
    expect(updated.success).toBe(true);
    // readonly createdAt is not part of the update shape at all:
    expect("createdAt" in Doc.update.shape).toBe(false);
    expect("updatedAt" in Doc.update.shape).toBe(true);
  });
});

describe(".use: permissions per-op AND-combine (narrow, never widen)", () => {
  test("blanket preset expr ANDs into per-op table perms", () => {
    const T = defineTable("preset_perm", { title: s.string() })
      .permissions({
        select: true,
        update: surql`user = $auth.id`,
        delete: false,
      })
      .use(defineTable.preset({ permissions: surql`org = $auth.org` }));
    const ddl = emitTable(T);
    // select: true is the identity -> the preset expr. create: table had none -> preset expr.
    expect(ddl).toContain("FOR select, create WHERE org = $auth.org");
    // update: both exprs AND together — DB-canonical, no redundant parens (would phantom-diff).
    expect(ddl).toContain(
      "FOR update WHERE user = $auth.id AND org = $auth.org",
    );
    // delete: false (NONE) absorbs — a preset can never widen it.
    expect(ddl).toContain("FOR delete NONE");
  });

  test("an OR-containing operand keeps its (required) parens — DB-canonical", () => {
    const T = defineTable("preset_or", { title: s.string() })
      .permissions({ update: surql`user = $auth.id OR admin = true` })
      .use(
        defineTable.preset({ permissions: { update: surql`org = $auth.org` } }),
      );
    const ddl = emitTable(T);
    expect(ddl).toContain(
      "FOR update WHERE (user = $auth.id OR admin = true) AND org = $auth.org",
    );
  });

  test("`same as X` refs resolve to concrete rules before combining", () => {
    const T = defineTable("preset_sameas", { title: s.string() })
      .permissions({
        select: surql`published = true`,
        update: "same as select",
      })
      .use(
        defineTable.preset({ permissions: { update: surql`org = $auth.org` } }),
      );
    const ddl = emitTable(T);
    expect(ddl).toContain("FOR select WHERE published = true");
    expect(ddl).toContain(
      "FOR update WHERE published = true AND org = $auth.org",
    );
  });

  test("preset false narrows a table true to NONE", () => {
    const T = defineTable("preset_none", { title: s.string() })
      .permissions(true)
      .use(defineTable.preset({ permissions: { delete: false } }));
    const ddl = emitTable(T);
    expect(ddl).toContain("FOR delete NONE");
    expect(ddl).toContain("FOR select, create, update FULL");
  });
});

describe(".use: events + indexes append", () => {
  test("preset events/indexes land after the table's own", () => {
    const T = defineTable("preset_evt", { title: s.string() })
      .event("own_evt", { then: surql`RETURN true` })
      .index("by_title", ["title"])
      .use(tenant("org_id"));
    const ddl = emitTable(T);
    expect(ddl).toContain("DEFINE EVENT own_evt ON TABLE preset_evt");
    expect(ddl).toContain("DEFINE EVENT tenant_guard ON TABLE preset_evt");
    expect(ddl).toContain("DEFINE INDEX by_title ON TABLE preset_evt");
    expect(ddl).toContain(
      "DEFINE INDEX by_org_id ON TABLE preset_evt FIELDS org_id",
    );
    expect(ddl.indexOf("own_evt")).toBeLessThan(ddl.indexOf("tenant_guard"));
  });
});

describe(".use: column-name clashes are rejected", () => {
  const clash = defineTable.preset({ columns: { title: s.number() } });

  test("compile-time: a clashing preset does not typecheck", () => {
    const T = defineTable("preset_clash", { title: s.string() });
    // @ts-expect-error — preset column "title" collides with the table's "title"
    const use = () => T.use(clash);
    expect(use).toThrow(/preset column "title" conflicts/);
  });

  test("compile-time: preset-vs-preset clashes surface too (checked vs table-so-far)", () => {
    const T = defineTable("preset_clash2", { name: s.string() });
    const applyTwice = () =>
      // @ts-expect-error — the second tenant("org_id") collides with the first's column
      T.use(tenant("org_id")).use(tenant("org_id"));
    expect(applyTwice).toThrow(/preset column "org_id" conflicts/);
  });

  test("a preset never clobbers silently — the runtime throw names table + column", () => {
    const T = defineTable("preset_clash3", { title: s.string() });
    expect(() => T.use(clash as never)).toThrow(
      'preset column "title" conflicts with an existing column on table "preset_clash3"',
    );
  });
});
