// defineSingleton — a table meant to hold exactly ONE record (system-wide config). The record id
// is FIXED and the DATABASE enforces it via the literal id type (`DEFINE FIELD id ON config TYPE
// 'default'`, SurrealDB >= 3.1). The fixed key types through the shape (the id field's VALUE type
// is the string literal), so id-optional client sugar survives presets and chaining.
import { describe, expect, test } from "bun:test";
import { emitTable } from "../../src/ddl";
import { defineSingleton, defineTable, s, surql } from "../../src/index";
import { create, get, remove, select, update } from "../../src/query";

const Config = defineSingleton("sg_config", {
  maintenance: s.boolean().$default(surql`false`),
  motd: s.string().optional(),
});
const User = defineTable("sg_user", { name: s.string() });

describe("authoring + DDL", () => {
  test("emits the literal id type: DEFINE FIELD id ON TABLE sg_config TYPE 'default'", () => {
    const ddl = emitTable(Config);
    expect(ddl).toContain("DEFINE FIELD id ON TABLE sg_config TYPE 'default';");
  });

  test("a custom key rides the opts: { id: 'main' }", () => {
    const Main = defineSingleton("sg_main", { x: s.number() }, { id: "main" });
    expect(emitTable(Main)).toContain(
      "DEFINE FIELD id ON TABLE sg_main TYPE 'main';",
    );
    expect(Main.singletonId).toBe("main");
  });

  test("a non-identifier key is rejected with guidance", () => {
    expect(() => defineSingleton("sg_bad", {}, { id: "not ok" })).toThrow(
      /plain identifier/,
    );
  });

  test("singletonId survives chaining and presets", () => {
    const preset = defineTable.preset({
      columns: { createdAt: s.datetime().$default(surql`time::now()`) },
    });
    const Chained = defineSingleton("sg_chained", { x: s.number() })
      .use(preset)
      .comment("one row");
    expect(Chained.singletonId).toBe("default");
    expect(emitTable(Chained)).toContain(
      "DEFINE FIELD id ON TABLE sg_chained TYPE 'default';",
    );
  });
});

describe("query sugar — the id argument is optional (and only for singletons)", () => {
  test("get(Config) targets the fixed record", () => {
    const { sql, vars } = get(Config).toSQL();
    expect(sql).toBe("SELECT * FROM $__thing LIMIT 1");
    expect(String(vars.__thing)).toBe("sg_config:default");
  });

  test("update(Config)/remove(Config) target the fixed record", () => {
    const u = update(Config).merge({ maintenance: true }).toSQL();
    expect(String(u.vars.__thing)).toBe("sg_config:default");
    const d = remove(Config).toSQL();
    expect(String(d.vars.__thing)).toBe("sg_config:default");
  });

  test("create(Config) creates THE record (a bare CREATE would mint a rejected random id)", () => {
    const { sql, vars } = create(Config).content({}).toSQL();
    expect(sql).toContain("CREATE $__thing CONTENT");
    expect(String(vars.__thing)).toBe("sg_config:default");
  });

  test("normal tables still require the id", () => {
    // @ts-expect-error — sg_user is not a singleton; the id argument is required
    const _bad = () => get(User);
    expect(typeof _bad).toBe("function");
    expect(() => (get as (t: unknown) => unknown)(User)).toThrow(
      /only a defineSingleton/,
    );
  });

  test("an explicit id still overrides on a singleton", () => {
    const { vars } = get(Config, "other").toSQL();
    expect(String(vars.__thing)).toBe("sg_config:other");
  });
});

// --- live (SURREAL_URL-gated) ---------------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("singleton live", () => {
  test("the DB enforces the fixed id; sugar round-trips; drift-free; pull regenerates", async () => {
    const { Surreal } = await import("surrealdb");
    const { explodeSchema, introspectAll } = await import(
      "../../src/kinds/explode"
    );
    const { deepEqual } = await import("../../src/cli/struct");
    const { connect } = await import("../../src/client");

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "sg", database: "sg" });
    await c.query("REMOVE TABLE IF EXISTS sg_config;");
    await c.query(emitTable(Config, { exists: "overwrite" }));

    // Any other id is REJECTED by the database itself.
    let rejected = "";
    try {
      await c.query("CREATE sg_config:other SET motd = 'x'");
    } catch (e) {
      rejected = (e as Error).message;
    }
    expect(rejected).toContain("Expected `'default'`");

    // create/get/update sugar, no id anywhere.
    const db = connect(c);
    const created = await db.create(Config).content({ motd: "hello" });
    expect(String(created.id)).toBe("sg_config:default");
    expect(created.maintenance).toBe(false); // DB default
    const got = await db.get(Config);
    expect(got?.motd).toBe("hello");
    await db.update(Config).merge({ maintenance: true });
    expect((await db.get(Config))?.maintenance).toBe(true);
    // The one-record invariant holds.
    expect(await select(Config).count().run(c)).toBe(1);

    // Round-trips drift-free (the literal id field is kept on both sides).
    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
    const pick = (objs: { kind: string; name: string }[]) =>
      objs.find(
        (o) => o.kind === "table" && o.name === "sg_config",
      ) as unknown as { struct: unknown };
    const authored = pick(explodeSchema([Config]));
    const live = pick(await introspectAll(c));
    expect(deepEqual(scrub(authored.struct), scrub(live.struct))).toBe(true);

    // Pull codegen regenerates defineSingleton (not defineTable + id hint).
    const { renderSchemaToTS } = await import("../../src/cli/pull.ts");
    const { introspectStructured } = await import("../../src/cli/structure");
    const { normalizeDb } = await import("../../src/cli/struct");
    const rendered = renderSchemaToTS(normalizeDb(await introspectStructured(c)));
    expect(rendered).toContain('defineSingleton("sg_config", {');
    expect(rendered).not.toContain("id: s.string()");

    await c.query("REMOVE TABLE IF EXISTS sg_config;");
    await c.close();
  }, 60_000);
});
