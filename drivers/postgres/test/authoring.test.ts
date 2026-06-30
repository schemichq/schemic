import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import * as z from "zod";
import { postgresDriver } from "../src/driver";
import {
  type App,
  defineDomain,
  defineEnum,
  defineExtension,
  defineFunction,
  defineMaterializedView,
  definePolicy,
  defineSequence,
  defineTable,
  defineTrigger,
  defineView,
  type PgConn,
  PgField,
  s,
  sqlExpr,
  type Wire,
} from "../src/index";
import { registry, splitTables } from "../src/kinds";
import { lowerTable, pgLower } from "../src/lower";

// The pg-native s.* authoring surface, post-flip: author with pg vocabulary -> lower to the driver's
// table IR (lowerTable) -> split into kind objects -> emit pg DDL -> apply to a real PGlite ->
// introspectAll -> diff = 0. Structural clauses (native types + params, identity, composite PK, FK
// actions) round-trip; expression clauses (default/check/generated/comment) are emit-faithful but
// excluded from change-detection (Postgres rewrites them) via the table kind's `canonical`.

async function open(): Promise<PgConn> {
  return (await postgresDriver.connect({
    params: { url: "" },
  } as never)) as PgConn;
}
const ddl = (t: ReturnType<typeof defineTable>) =>
  emitKinds(registry, splitTables([lowerTable(t)])).join("\n");
const roundtripEmpty = async (
  ...tables: ReturnType<typeof defineTable>[]
): Promise<boolean> => {
  const ir = pgLower(tables);
  const conn = await open();
  try {
    await postgresDriver.apply(conn, emitKinds(registry, splitTables(ir)));
    const live = await postgresDriver.introspectAll(conn);
    return buildKindDiff(registry, live, splitTables(ir)).up.length === 0;
  } finally {
    await conn.close();
  }
};

describe("lower: pg s.* -> table IR", () => {
  test("canonical types -> portable scalars; pg-specific -> native(+params)", () => {
    const t = defineTable("widget", {
      name: s.text(),
      count: s.integer(),
      big: s.bigint(),
      price: s.numeric(12, 2),
      label: s.varchar(255),
      created: s.timestamptz(),
      tags: s.text().array(),
      meta: s.jsonb(),
    });
    const f = new Map(lowerTable(t).fields.map((x) => [x.name, x.type]));
    expect(f.get("name")).toEqual({ t: "scalar", name: "string" });
    expect(f.get("count")).toEqual({ t: "scalar", name: "int" });
    expect(f.get("big")).toEqual({
      t: "native",
      db: "postgres",
      name: "bigint",
    });
    expect(f.get("price")).toEqual({
      t: "native",
      db: "postgres",
      name: "numeric",
      params: [12, 2],
    });
    expect(f.get("label")).toEqual({
      t: "native",
      db: "postgres",
      name: "varchar",
      params: [255],
    });
    expect(f.get("created")).toEqual({ t: "scalar", name: "datetime" });
    expect(f.get("tags")).toEqual({
      t: "array",
      elem: { t: "scalar", name: "string" },
    });
    expect(f.get("meta")).toEqual({ t: "object", fields: {} });
  });

  test("optional/nullable wrappers + clauses land in the IR", () => {
    const t = defineTable("acct", {
      age: s.smallint().optional(),
      seq: s.integer().$identity("always"),
      who: s.references("person", {
        onDelete: "cascade",
        onUpdate: "restrict",
      }),
    });
    const byName = new Map(lowerTable(t).fields.map((x) => [x.name, x]));
    expect(byName.get("age")?.type).toEqual({
      t: "option",
      inner: { t: "native", db: "postgres", name: "smallint" },
    });
    expect(byName.get("seq")?.identity).toBe("always");
    expect(byName.get("who")?.type).toEqual({
      t: "record",
      tables: ["person"],
    });
    expect(byName.get("who")?.reference).toEqual({
      on_delete: "cascade",
      on_update: "restrict",
    });
  });

  test("tables satisfy the CLI loader duck-type (name/fields/config/record)", () => {
    const t = defineTable("x", { a: s.text() });
    expect(typeof t.name).toBe("string");
    expect(typeof t.fields).toBe("object");
    expect(typeof t.config).toBe("object");
    expect(typeof t.record).toBe("function");
    expect(t.record({ onDelete: "cascade" }).native.references).toEqual({
      table: "x",
      onDelete: "cascade",
    });
  });

  test("table-level composite PK + field clauses", () => {
    const t = defineTable("member", {
      org: s.text(),
      person: s.text(),
      role: s.text().$default("member"),
      score: s.integer().$check("score >= 0"),
    }).primaryKey("org", "person");
    const tbl = lowerTable(t);
    expect(tbl.primaryKey).toEqual(["org", "person"]);
    const byName = new Map(tbl.fields.map((x) => [x.name, x]));
    expect(byName.get("role")?.default).toBe("'member'");
    expect(byName.get("score")?.check).toBe("score >= 0");
  });
});

describe("emit: DDL clause rendering", () => {
  test("native types with params, identity, default, check, generated", () => {
    const out = ddl(
      defineTable("p", {
        label: s.varchar(255),
        price: s.numeric(10, 2),
        seq: s.integer().$identity("by-default"),
        status: s.text().$default("active"),
        created: s.timestamptz().$default(sqlExpr("now()")),
        score: s.integer().$check("score >= 0"),
        total: s.numeric(12, 2).$generated("price * 2"),
        note: s.text().$comment("free text"),
      }),
    );
    expect(out).toContain('"label" varchar(255)');
    expect(out).toContain('"price" numeric(10, 2)');
    expect(out).toContain("GENERATED BY DEFAULT AS IDENTITY");
    expect(out).toContain("DEFAULT 'active'");
    expect(out).toContain("DEFAULT now()");
    expect(out).toContain("CHECK (score >= 0)");
    expect(out).toContain("GENERATED ALWAYS AS (price * 2) STORED");
    expect(out).toContain('COMMENT ON COLUMN "p"."note" IS \'free text\'');
  });

  test("composite PK replaces the implicit id; FK carries ON DELETE/UPDATE", () => {
    const member = ddl(
      defineTable("m", { a: s.text(), b: s.text() }).primaryKey("a", "b"),
    );
    expect(member).toContain('PRIMARY KEY ("a", "b")');
    expect(member).not.toContain('"id" text PRIMARY KEY');

    const post = ddl(
      defineTable("post", {
        author: s.references("usr", {
          onDelete: "cascade",
          onUpdate: "no action",
        }),
      }),
    );
    // The constraint kind canonicalizes actions (UPPERCASE so they match introspect / round-trip) and
    // omits the default NO ACTION — unlike the old fixed-slot emit which echoed the authored case.
    expect(post).toContain("ON DELETE CASCADE");
    expect(post).not.toContain("ON UPDATE");
  });

  test("$unique emits a UNIQUE index", () => {
    const out = ddl(defineTable("u", { email: s.text().$unique() }));
    expect(out).toContain('CREATE UNIQUE INDEX "u_email_key" ON "u" ("email")');
  });
});

describe("round-trip: author -> emit -> PGlite -> introspectAll -> diff = 0", () => {
  test("diverse native types + nullability + identity", async () => {
    expect(
      await roundtripEmpty(
        defineTable("widget", {
          name: s.varchar(255),
          age: s.smallint().optional(),
          balance: s.numeric(12, 2),
          big: s.bigint(),
          ratio: s.real(),
          active: s.boolean(),
          created: s.timestamptz(),
          meta: s.jsonb(),
          tags: s.text().array(),
          token: s.uuid(),
          seq: s.integer().$identity("by-default"),
        }),
      ),
    ).toBe(true);
  });

  test("FK with referential actions + composite PK", async () => {
    expect(
      await roundtripEmpty(
        defineTable("user", { name: s.text() }),
        defineTable("post", {
          title: s.text(),
          author: s.references("user", { onDelete: "cascade" }),
        }),
        defineTable("member", {
          org: s.text(),
          person: s.text(),
        }).primaryKey("org", "person"),
      ),
    ).toBe(true);
  });

  test("non-unique secondary index round-trips (introspected, not just unique)", async () => {
    expect(
      await roundtripEmpty(
        defineTable("post", { title: s.text() }).index(["title"]),
      ),
    ).toBe(true);
  });

  test("overridden id column (uuid / serial / bigint PK) round-trips", async () => {
    expect(
      await roundtripEmpty(
        defineTable("a", { id: s.uuid().$primaryKey(), name: s.text() }),
      ),
    ).toBe(true);
    expect(
      await roundtripEmpty(
        defineTable("b", { id: s.serial().$primaryKey(), name: s.text() }),
      ),
    ).toBe(true);
    expect(
      await roundtripEmpty(
        defineTable("c", { id: s.bigint(), name: s.text() }).primaryKey("id"),
      ),
    ).toBe(true);
  });

  test("implicit id + composite PK still round-trip (no regression)", async () => {
    expect(await roundtripEmpty(defineTable("d", { name: s.text() }))).toBe(
      true,
    );
    expect(
      await roundtripEmpty(
        defineTable("e", { a: s.text(), b: s.text() }).primaryKey("a", "b"),
      ),
    ).toBe(true);
  });

  test("$postgres escape hatch round-trips as its native pg type", async () => {
    const codec = s.$postgres("text", s.text().schema);
    expect(await roundtripEmpty(defineTable("blob", { raw: codec }))).toBe(
      true,
    );
  });

  test("chainable .$postgres(wire, codec) stores via the wire type + round-trips", async () => {
    class Money {
      constructor(public cents: number) {}
    }
    // App value (Money) stored as a varchar(32) wire column via a codec.
    const amount = new PgField(z.instanceof(Money), {}).$postgres(
      s.varchar(32),
      {
        encode: (m: Money) => String(m.cents),
        decode: (v) => new Money(Number(v as string)),
      },
    );
    const tx = defineTable("tx", { amount });

    // Column emits as the WIRE type, not the App type.
    expect(ddl(tx)).toContain('"amount" varchar(32) NOT NULL');
    // Codec maps app <-> wire both ways.
    expect(amount.encode(new Money(1299))).toBe("1299");
    expect(amount.decode("1299")).toBeInstanceOf(Money);
    expect((amount.decode("1299") as Money).cents).toBe(1299);
    // And it round-trips through a real engine.
    expect(await roundtripEmpty(tx)).toBe(true);
  });

  test("chainable .$postgres(wire) without a codec is an identity mapping", async () => {
    const slug = new PgField(z.string(), {}).$postgres(s.varchar(64));
    expect(ddl(defineTable("p", { slug }))).toContain(
      '"slug" varchar(64) NOT NULL',
    );
  });
});

describe("defineEnum: native CREATE TYPE", () => {
  test("a table column uses the enum type; both round-trip via explode/introspectAll", async () => {
    const mood = defineEnum("mood", ["happy", "sad", "ok"]);
    const person = defineTable("person", {
      name: s.text(),
      mood: mood.column(),
      mood2: mood.column().optional(),
    });
    const objs = postgresDriver.explode([person], [mood]);
    const out = emitKinds(registry, objs);
    expect(out[0]).toBe(`CREATE TYPE "mood" AS ENUM ('happy', 'sad', 'ok');`);
    expect(out.join("\n")).toContain('"mood" mood NOT NULL');
    expect(out.join("\n")).toContain('"mood2" mood'); // nullable -> no NOT NULL

    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, out);
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });

  test("mood.column() App type is the literal union (z.enum)", () => {
    const mood = defineEnum("mood", ["happy", "sad"]);
    const col = mood.column();
    expect(col.schema.parse("happy")).toBe("happy");
    expect(() => col.schema.parse("nope")).toThrow();
  });
});

describe("defineView: CREATE VIEW", () => {
  test("a view emits after its table + round-trips (presence) via explode/introspectAll", async () => {
    const user = defineTable("vu", { name: s.text(), active: s.boolean() });
    const active = defineView(
      "vu_active",
      'SELECT id, name FROM "vu" WHERE active',
    );
    const objs = postgresDriver.explode([user], [active]);
    const out = emitKinds(registry, objs);
    expect(
      out.find((x) => x.startsWith('CREATE VIEW "vu_active"')),
    ).toBeTruthy();
    expect(out.findIndex((x) => x.includes('CREATE TABLE "vu"'))).toBeLessThan(
      out.findIndex((x) => x.includes('CREATE VIEW "vu_active"')),
    );

    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, out);
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("PgTableDef.object / decode (row codec — what the query builder reuses)", () => {
  const post = defineTable("post", {
    title: s.text(),
    views: s.integer(),
    at: s.timestamptz(),
  });

  test("object is a z.ZodObject whose shape mirrors the authored columns", () => {
    expect(post.object).toBeInstanceOf(z.ZodObject);
    expect(Object.keys(post.object.shape).sort()).toEqual([
      "at",
      "title",
      "views",
    ]);
  });

  test("decode runs the wire row through the column codecs (timestamptz -> Date)", () => {
    const row = post.decode({
      title: "hello",
      views: 3,
      at: new Date("2021-02-03T04:05:06.000Z"),
    });
    expect(row.title).toBe("hello");
    expect(row.views).toBe(3);
    expect(row.at).toBeInstanceOf(Date);
  });

  test("decode applies a $postgres codec (wire text -> app value)", () => {
    const t = defineTable("slugged", {
      slug: s.text().$postgres(s.text(), {
        encode: (a: string) => a.toLowerCase(),
        decode: (w) => String(w).toUpperCase(),
      }),
    });
    expect(t.decode({ slug: "ab-c" }).slug).toBe("AB-C");
  });

  test("safeDecode reports failure without throwing", () => {
    const r = post.safeDecode({
      title: "x",
      views: "not-an-int",
      at: new Date(),
    });
    expect(r.success).toBe(false);
  });
});

describe("standalone DDL objects via the authoring surface (explode)", () => {
  const roundtrip = async (objs: ReturnType<typeof postgresDriver.explode>) => {
    const out = emitKinds(registry, objs);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, out);
      const live = await postgresDriver.introspectAll(conn);
      return buildKindDiff(registry, live, objs);
    } finally {
      await conn.close();
    }
  };

  test("defineSequence: emits + round-trips (default + custom)", async () => {
    const plain = defineSequence("ats_plain");
    const order = defineSequence("ats_order", { start: 1000, increment: 5 });
    const out = emitKinds(registry, postgresDriver.explode([], [plain, order]));
    expect(out).toContain('CREATE SEQUENCE "ats_plain";');
    expect(out).toContain(
      'CREATE SEQUENCE "ats_order" INCREMENT BY 5 START WITH 1000;',
    );
    const { up, down } = await roundtrip(
      postgresDriver.explode([], [plain, order]),
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("defineDomain: .column() types a table column as the domain; round-trips", async () => {
    const code = defineDomain("atd_code", s.varchar(50), {
      notNull: true,
      check: "VALUE ~ '^[A-Z]+$'",
    });
    const t = defineTable("atd_t", { code: code.column() });
    const objs = postgresDriver.explode([t], [code]);
    const out = emitKinds(registry, objs);
    // domain emits before the table that uses it
    expect(
      out.findIndex((x) => x.startsWith('CREATE DOMAIN "atd_code"')),
    ).toBeLessThan(out.findIndex((x) => x.includes('CREATE TABLE "atd_t"')));
    expect(out.find((x) => x.includes('"code" atd_code'))).toBeTruthy();
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("defineMaterializedView: emits after its table + round-trips", async () => {
    const u = defineTable("atm_u", { name: s.text() });
    const stats = defineMaterializedView(
      "atm_stats",
      'SELECT count(*) AS n FROM "atm_u"',
    );
    const objs = postgresDriver.explode([u], [stats]);
    const out = emitKinds(registry, objs);
    expect(
      out.findIndex((x) => x.includes('CREATE TABLE "atm_u"')),
    ).toBeLessThan(
      out.findIndex((x) =>
        x.startsWith('CREATE MATERIALIZED VIEW "atm_stats"'),
      ),
    );
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("defineExtension: emits CREATE EXTENSION IF NOT EXISTS (first)", () => {
    const citext = defineExtension("citext");
    const u = defineTable("ate_u", { name: s.text() });
    const out = emitKinds(registry, postgresDriver.explode([u], [citext]));
    expect(out[0]).toBe('CREATE EXTENSION IF NOT EXISTS "citext";');
  });
});

describe("functions / triggers / policies via the authoring surface (explode)", () => {
  const roundtrip = async (objs: ReturnType<typeof postgresDriver.explode>) => {
    const out = emitKinds(registry, objs);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, out);
      const live = await postgresDriver.introspectAll(conn);
      return buildKindDiff(registry, live, objs);
    } finally {
      await conn.close();
    }
  };

  test("defineFunction: emits CREATE FUNCTION + round-trips (sql + plpgsql)", async () => {
    const addOne = defineFunction("afn_add", {
      args: "n integer",
      returns: "integer",
      body: "SELECT n + 1",
    });
    const touch = defineFunction("afn_touch", {
      returns: "trigger",
      language: "plpgsql",
      body: " BEGIN RETURN NEW; END ",
    });
    const out = emitKinds(
      registry,
      postgresDriver.explode([], [addOne, touch]),
    );
    expect(
      out.find((x) => x.startsWith('CREATE FUNCTION "afn_add"(n integer)')),
    ).toBeTruthy();
    const { up, down } = await roundtrip(
      postgresDriver.explode([], [addOne, touch]),
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("defineTrigger: emits after its table + function, round-trips", async () => {
    const post = defineTable("atr_post", {
      title: s.text(),
      updated: s.timestamptz().optional(),
    });
    const touch = defineFunction("atr_touch", {
      returns: "trigger",
      language: "plpgsql",
      body: " BEGIN NEW.updated := now(); RETURN NEW; END ",
    });
    const trg = defineTrigger("atr_set", {
      table: "atr_post",
      timing: "before",
      events: ["update"],
      function: "atr_touch",
    });
    const objs = postgresDriver.explode([post], [touch, trg]);
    const out = emitKinds(registry, objs);
    // trigger emits after both its table and the function it calls
    const ti = out.findIndex((x) => x.includes('CREATE TRIGGER "atr_set"'));
    expect(
      out.findIndex((x) => x.includes('CREATE TABLE "atr_post"')),
    ).toBeLessThan(ti);
    expect(
      out.findIndex((x) => x.startsWith('CREATE FUNCTION "atr_touch"')),
    ).toBeLessThan(ti);
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("definePolicy: enables RLS + creates the policy, round-trips", async () => {
    const doc = defineTable("apo_doc", { owner: s.text() });
    const pol = definePolicy("apo_owner", {
      table: "apo_doc",
      command: "select",
      using: "true",
    });
    const objs = postgresDriver.explode([doc], [pol]);
    const out = emitKinds(registry, objs);
    expect(
      out.some((x) => x === 'ALTER TABLE "apo_doc" ENABLE ROW LEVEL SECURITY;'),
    ).toBe(true);
    expect(out.some((x) => x.startsWith('CREATE POLICY "apo_owner"'))).toBe(
      true,
    );
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });
});

describe("PgTableDef.foreignKey (composite / non-id FK via the authoring surface)", () => {
  const roundtrip = async (objs: ReturnType<typeof postgresDriver.explode>) => {
    const out = emitKinds(registry, objs);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, out);
      const live = await postgresDriver.introspectAll(conn);
      return buildKindDiff(registry, live, objs);
    } finally {
      await conn.close();
    }
  };

  test("composite FK -> a composite-PK table round-trips", async () => {
    const team = defineTable("aft_team", {
      org_id: s.text(),
      code: s.text(),
    }).primaryKey("org_id", "code");
    const member = defineTable("aft_member", {
      org_id: s.text(),
      team_code: s.text(),
    }).foreignKey({
      columns: ["org_id", "team_code"],
      refTable: "aft_team",
      refColumns: ["org_id", "code"],
      onDelete: "cascade",
    });
    const objs = postgresDriver.explode([team, member], []);
    const out = emitKinds(registry, objs);
    expect(
      out.find((x) => x.includes("ADD CONSTRAINT") && x.includes("aft_member")),
    ).toContain(
      'FOREIGN KEY ("org_id", "team_code") REFERENCES "aft_team" ("org_id", "code")',
    );
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("FK to a non-id column (refColumns) round-trips", async () => {
    const u = defineTable("afu_u", { email: s.text().$unique() });
    const prof = defineTable("afu_prof", { email: s.text() }).foreignKey({
      columns: ["email"],
      refTable: "afu_u",
      refColumns: ["email"],
    });
    const objs = postgresDriver.explode([u, prof], []);
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test('refColumns defaults to ["id"] when omitted', async () => {
    const parent = defineTable("afd_parent", { name: s.text() });
    const child = defineTable("afd_child", { parent_id: s.text() }).foreignKey({
      columns: ["parent_id"],
      refTable: "afd_parent",
    });
    const objs = postgresDriver.explode([parent, child], []);
    const out = emitKinds(registry, objs);
    expect(
      out.find((x) => x.includes("ADD CONSTRAINT") && x.includes("afd_child")),
    ).toContain('REFERENCES "afd_parent" ("id")');
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });
});

describe("PgTableDef.index — method + partial (via the authoring surface)", () => {
  const roundtrip = async (objs: ReturnType<typeof postgresDriver.explode>) => {
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      return buildKindDiff(registry, live, objs);
    } finally {
      await conn.close();
    }
  };

  test("a gin index + a partial index emit + round-trip", async () => {
    const doc = defineTable("aix_doc", {
      meta: s.jsonb(),
      score: s.integer(),
      active: s.boolean(),
    })
      .index(["meta"], { method: "gin" })
      .index(["score"], { name: "aix_hot", where: "active" });
    const objs = postgresDriver.explode([doc], []);
    const out = emitKinds(registry, objs);
    expect(out.find((x) => x.includes("aix_doc_meta_idx"))).toContain(
      'USING gin ("meta")',
    );
    expect(out.find((x) => x.includes("aix_hot"))).toContain("WHERE active");
    const { up, down } = await roundtrip(objs);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });
});

describe("string format factories (App-side Zod validators on text columns)", () => {
  test("emit as plain text columns (format is App-side, not a pg type)", () => {
    const t = defineTable("sf", {
      em: s.email(),
      link: s.url(),
      code: s.cuid2(),
      tok: s.jwt(),
    });
    const out = emitKinds(registry, postgresDriver.explode([t], [])).join("\n");
    expect(out).toContain('"em" text NOT NULL');
    expect(out).toContain('"link" text NOT NULL');
    expect(out).toContain('"code" text NOT NULL');
    expect(out).toContain('"tok" text NOT NULL');
  });

  test("validate App-side: decode accepts valid, rejects invalid", () => {
    expect(s.email().decode("ada@example.com")).toBe("ada@example.com");
    expect(s.email().safeDecode("nope").success).toBe(false);
    expect(s.url().safeDecode("https://schemic.dev").success).toBe(true);
    expect(s.url().safeDecode("not a url").success).toBe(false);
    const _s: string = s.email().decode("a@b.com");
    expect(_s).toBe("a@b.com");
  });

  test("a table of formats round-trips (all text)", async () => {
    const t = defineTable("sfrt", {
      em: s.email(),
      link: s.url(),
      tok: s.jwt(),
      b64: s.base64(),
      slug: s.cuid2(),
    });
    const objs = postgresDriver.explode([t], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("Zod chain methods (string + number; App-side, no DDL change)", () => {
  test("string format + length + transform chains validate/normalize App-side", () => {
    expect(s.text().email().safeDecode("a@b.com").success).toBe(true);
    expect(s.text().email().safeDecode("nope").success).toBe(false);
    expect(s.text().min(3).safeDecode("ab").success).toBe(false);
    expect(s.text().email().min(3).safeDecode("a@b.com").success).toBe(true); // chains compose
    expect(s.text().trim().decode("  hi  ")).toBe("hi");
    expect(s.text().toLowerCase().decode("AB")).toBe("ab");
    expect(
      s
        .varchar(50)
        .regex(/^[a-z]+$/)
        .safeDecode("ABC").success,
    ).toBe(false);
  });

  test("number bound chains validate App-side", () => {
    expect(s.integer().gt(0).safeDecode(-1).success).toBe(false);
    expect(s.integer().gte(0).safeDecode(0).success).toBe(true);
    expect(s.integer().positive().safeDecode(5).success).toBe(true);
    expect(s.numeric().multipleOf(0.5).safeDecode(0.25).success).toBe(false);
  });

  test("a chain method that doesn't apply to the base type throws (like Zod)", () => {
    expect(() => s.integer().regex(/x/)).toThrow(/not available on this field/);
  });

  test("chains DON'T change the column type — DDL unchanged + round-trips", async () => {
    const t = defineTable("zc", {
      em: s.text().email().min(3), // still text
      slug: s.varchar(50).regex(/^[a-z-]+$/), // still varchar(50)
      age: s.integer().gte(0).lte(150), // still integer
    });
    const objs = postgresDriver.explode([t], []);
    const stmts = emitKinds(registry, objs);
    const out = stmts.join("\n");
    expect(out).toContain('"em" text NOT NULL');
    expect(out).toContain('"slug" varchar(50) NOT NULL');
    expect(out).toContain('"age" integer NOT NULL');
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, stmts);
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("composite factories (record/tuple/union/intersection/discriminatedUnion/lazy -> jsonb)", () => {
  test("all emit jsonb columns", () => {
    const t = defineTable("comp", {
      rec: s.record(z.string(), s.integer()),
      tup: s.tuple([s.text(), s.integer()]),
      uni: s.union([s.text(), s.integer()]),
      inter: s.intersection(
        s.object({ a: s.text() }),
        s.object({ b: s.integer() }),
      ),
    });
    const out = emitKinds(registry, postgresDriver.explode([t], [])).join("\n");
    expect(out).toContain('"rec" jsonb NOT NULL');
    expect(out).toContain('"tup" jsonb NOT NULL');
    expect(out).toContain('"uni" jsonb NOT NULL');
    expect(out).toContain('"inter" jsonb NOT NULL');
  });

  test("validate App-side per the composite shape", () => {
    expect(s.tuple([s.text(), s.integer()]).safeDecode(["a", 1]).success).toBe(
      true,
    );
    expect(
      s.tuple([s.text(), s.integer()]).safeDecode(["a", "b"]).success,
    ).toBe(false);
    expect(s.union([s.text(), s.integer()]).safeDecode(7).success).toBe(true);
    expect(s.union([s.text(), s.integer()]).safeDecode(true).success).toBe(
      false,
    );
    expect(s.record(z.string(), s.integer()).safeDecode({ x: 1 }).success).toBe(
      true,
    );
    expect(
      s.record(z.string(), s.integer()).safeDecode({ x: "no" }).success,
    ).toBe(false);
    const du = s.discriminatedUnion("kind", [
      s.object({ kind: s.literal("a"), x: s.text() }),
      s.object({ kind: s.literal("b"), y: s.integer() }),
    ]);
    expect(du.safeDecode({ kind: "a", x: "hi" }).success).toBe(true);
    expect(du.safeDecode({ kind: "a", y: 1 }).success).toBe(false);
  });

  test("a composites table round-trips (all jsonb)", async () => {
    const t = defineTable("comprt", {
      rec: s.record(z.string(), s.integer()),
      tup: s.tuple([s.text(), s.boolean()]),
      uni: s.union([s.text(), s.integer()]),
    });
    const objs = postgresDriver.explode([t], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("object composition (PgObjectField: .extend/.merge/.pick/.omit/.partial/...)", () => {
  const base = s.object({ a: s.text(), b: s.integer() });

  test("compose + validate App-side (fields OR raw Zod)", () => {
    const ext = base.extend({ c: s.boolean() });
    expect(ext.safeDecode({ a: "x", b: 1, c: true }).success).toBe(true);
    expect(ext.safeDecode({ a: "x", b: 1 }).success).toBe(false); // c required
    expect(base.pick({ a: true }).safeDecode({ a: "x" }).success).toBe(true);
    expect(base.omit({ b: true }).safeDecode({ a: "x" }).success).toBe(true);
    expect(base.partial().safeDecode({}).success).toBe(true);
    expect(
      base.merge(s.object({ d: s.text() })).safeDecode({ a: "x", b: 1, d: "y" })
        .success,
    ).toBe(true);
    expect(Object.keys(base.shape)).toEqual(["a", "b"]);
  });

  test("App type stays precise through composition", () => {
    const ext = base.extend({ c: s.boolean() });
    const app: { a: string; b: number; c: boolean } = ext.decode({
      a: "x",
      b: 1,
      c: true,
    });
    expect(app).toEqual({ a: "x", b: 1, c: true });
    const picked: { a: string } = base.pick({ a: true }).decode({ a: "x" });
    expect(picked).toEqual({ a: "x" });
  });

  test("inherited .loose()/.strict() return a still-composable PgObjectField", () => {
    expect(typeof base.loose().extend).toBe("function");
    expect(
      base.loose().extend({ z: s.text() }).safeDecode({
        a: "x",
        b: 1,
        z: "q",
        extra: 99,
      }).success,
    ).toBe(true);
  });

  test("a composed object is still ONE jsonb column + round-trips", async () => {
    const t = defineTable("oc", { meta: base.extend({ c: s.boolean() }) });
    const objs = postgresDriver.explode([t], []);
    const out = emitKinds(registry, objs).join("\n");
    expect(out).toContain('"meta" jsonb NOT NULL');
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("s.bigint() precision — z.bigint(), no silent loss past 2^53", () => {
  const HUGE = 9007199254740993n; // 2^53 + 1 — not representable exactly as a JS number

  test("App / Wire are bigint (not number)", () => {
    const t = defineTable("bp_types", { big: s.bigint() });
    // compiles only if both sides are `bigint`:
    const app: App<typeof t> = { big: HUGE };
    const wire: Wire<typeof t> = { big: HUGE };
    expect(app.big).toBe(HUGE);
    expect(wire.big).toBe(HUGE);
  });

  test("field encode/decode are bigint-precise (identity, no codec)", () => {
    const f = s.bigint();
    expect(f.decode(HUGE)).toBe(HUGE); // wire bigint -> app bigint
    expect(f.encode(HUGE)).toBe(HUGE); // app bigint -> wire bigint (create-input/seed path)
  });

  test("round-trips a value past 2^53 through PGlite EXACTLY", async () => {
    const acct = defineTable("bp_acct", { balance: s.bigint() });
    const objs = postgresDriver.explode([acct], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      // write through the field's encode (app bigint -> wire), as a create/seed path would:
      await conn.query(
        `INSERT INTO "bp_acct" ("id", "balance") VALUES ($1, $2);`,
        ["a", acct.fields.balance.encode(HUGE)],
      );
      const { rows } = await conn.query<{ balance: bigint }>(
        `SELECT "balance" FROM "bp_acct";`,
      );
      expect(typeof rows[0].balance).toBe("bigint");
      expect(rows[0].balance).toBe(HUGE); // precise — was lossy when backed by z.int()/number
      // and through the table's row codec:
      expect(acct.decode(rows[0]).balance).toBe(HUGE);
      // a schema-DDL round-trip is unchanged (pg type is still "bigint"):
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("s.enum().exclude()/.extract() (PgEnumField — derive narrower enums)", () => {
  const status = s.enum(["draft", "published", "archived"]);

  test("exclude drops members; extract keeps only the listed ones (App-side)", () => {
    const noArch = status.exclude(["archived"]);
    expect(noArch.safeDecode("draft").success).toBe(true);
    expect(noArch.safeDecode("archived").success).toBe(false);
    const onlyPub = status.extract(["published"]);
    expect(onlyPub.safeDecode("published").success).toBe(true);
    expect(onlyPub.safeDecode("draft").success).toBe(false);
  });

  test("App type narrows through exclude/extract", () => {
    const noArch = status.exclude(["archived"]);
    const v: "draft" | "published" = noArch.decode("draft");
    expect(v).toBe("draft");
  });

  test("derived enum is still a text column + round-trips", async () => {
    const t = defineTable("doc", { st: status.exclude(["archived"]) });
    const objs = postgresDriver.explode([t], []);
    expect(emitKinds(registry, objs).join("\n")).toContain(
      '"st" text NOT NULL',
    );
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("Tier-3 long-tail factories (z.* -> s.* literal drop-ins)", () => {
  test("long-tail string formats validate App-side, emit text", () => {
    expect(
      s.uuidv7().safeDecode("0192f0a0-0000-7000-8000-000000000000").success,
    ).toBe(true);
    expect(
      s.uuidv7().safeDecode("00000000-0000-4000-8000-000000000000").success,
    ).toBe(false); // a v4 is not a v7
    expect(s.httpUrl().safeDecode("https://schemic.dev").success).toBe(true);
    expect(s.hex().safeDecode("deadBEEF").success).toBe(true);
    expect(s.hex().safeDecode("nothex!").success).toBe(false);
    expect(s.hash("sha256").safeDecode("a".repeat(64)).success).toBe(true);
    const t = defineTable("lt", {
      a: s.uuidv4(),
      b: s.httpUrl(),
      c: s.hostname(),
      d: s.mac(),
    });
    const out = emitKinds(registry, postgresDriver.explode([t], [])).join("\n");
    for (const col of ["a", "b", "c", "d"])
      expect(out).toContain(`"${col}" text NOT NULL`);
  });

  test("nested s.iso.* are ISO string-format validators on text", () => {
    expect(s.iso.date().safeDecode("2020-01-02").success).toBe(true);
    expect(s.iso.date().safeDecode("nope").success).toBe(false);
    expect(s.iso.datetime().safeDecode("2020-01-02T03:04:05Z").success).toBe(
      true,
    );
    expect(s.iso.time().safeDecode("03:04:05").success).toBe(true);
    const out = emitKinds(
      registry,
      postgresDriver.explode([defineTable("ic", { d: s.iso.date() })], []),
    ).join("\n");
    expect(out).toContain('"d" text NOT NULL');
  });

  test("s.stringbool — string wire, boolean app", () => {
    const sb = s.stringbool();
    expect(sb.decode("true")).toBe(true);
    expect(typeof sb.decode("true")).toBe("boolean");
    expect(sb.encode(true as never)).toBe("true"); // app bool -> wire string
    expect(
      emitKinds(
        registry,
        postgresDriver.explode([defineTable("sb", { on: sb })], []),
      ).join("\n"),
    ).toContain('"on" text NOT NULL');
  });

  test("s.json() no-shape is the recursive JSON schema", () => {
    expect(s.json().safeDecode({ a: [1, "x", null] }).success).toBe(true);
  });

  test("s.strictObject rejects extra keys; s.looseObject allows them", () => {
    expect(
      s.strictObject({ a: s.text() }).safeDecode({ a: "x", b: 1 }).success,
    ).toBe(false);
    expect(
      s.looseObject({ a: s.text() }).safeDecode({ a: "x", b: 1 }).success,
    ).toBe(true);
  });

  test("s.codec infers the column type from the wire schema A + round-trips", async () => {
    // wire string -> app Date (column text); wire number -> app bigint (column double precision)
    const at = s.codec(z.string(), z.date(), {
      decode: (x) => new Date(x),
      encode: (d) => d.toISOString(),
    });
    expect(at.decode("2020-01-02T03:04:05.000Z") instanceof Date).toBe(true);
    const t = defineTable("cdc", {
      at,
      n: s.codec(z.number(), z.bigint(), {
        decode: (n) => BigInt(n),
        encode: (b) => Number(b),
      }),
    });
    const objs = postgresDriver.explode([t], []);
    const out = emitKinds(registry, objs).join("\n");
    expect(out).toContain('"at" text NOT NULL');
    expect(out).toContain('"n" double precision NOT NULL');
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

describe("cross-driver factories (network formats, width numerics, schema factories)", () => {
  test("network string-format validators -> text", () => {
    expect(s.ipv4().safeDecode("1.2.3.4").success).toBe(true);
    expect(s.ipv4().safeDecode("999.0.0.0").success).toBe(false);
    expect(s.ipv6().safeDecode("::1").success).toBe(true);
    expect(s.cidrv4().safeDecode("10.0.0.0/8").success).toBe(true);
    expect(s.cidrv6().safeDecode("::/0").success).toBe(true);
    const out = emitKinds(
      registry,
      postgresDriver.explode(
        [
          defineTable("net", {
            a: s.ipv4(),
            b: s.ipv6(),
            c: s.cidrv4(),
            d: s.cidrv6(),
          }),
        ],
        [],
      ),
    ).join("\n");
    for (const col of ["a", "b", "c", "d"])
      expect(out).toContain(`"${col}" text NOT NULL`);
  });

  test("width numerics emit the right column types", () => {
    const t = defineTable("w", {
      i32: s.int32(),
      u32: s.uint32(),
      i64: s.int64(),
      u64: s.uint64(),
      f32: s.float32(),
      f64: s.float64(),
    });
    const out = emitKinds(registry, postgresDriver.explode([t], [])).join("\n");
    expect(out).toContain('"i32" integer NOT NULL');
    expect(out).toContain('"u32" bigint NOT NULL'); // unsigned 32 -> bigint (range)
    expect(out).toContain('"i64" bigint NOT NULL');
    expect(out).toContain('"u64" numeric NOT NULL'); // unsigned 64 -> numeric (range)
    expect(out).toContain('"f32" real NOT NULL');
    expect(out).toContain('"f64" double precision NOT NULL');
  });

  test("bigint-backed fields round-trip at BOTH a small (<=2^53) and a large value", async () => {
    // PGlite returns a bigint column as a JS number when <=2^53, bigint when larger — both must decode.
    const t = defineTable("bn", {
      big: s.bigint(),
      i64: s.int64(),
      u32: s.uint32(),
      u64: s.uint64(),
    });
    const objs = postgresDriver.explode([t], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const f = t.fields;
      const cases: Array<[string, bigint, bigint, number, bigint]> = [
        ["small", 5n, 5n, 5, 5n], // <=2^53 -> PGlite returns number (the previously-broken case)
        [
          "large",
          9007199254740993n, // 2^53 + 1
          9223372036854775807n, // int64 max
          4294967295, // uint32 max
          18446744073709551615n, // uint64 max
        ],
      ];
      for (const [id, big, i64, u32, u64] of cases) {
        await conn.query(
          `INSERT INTO "bn" ("id","big","i64","u32","u64") VALUES ($1,$2,$3,$4,$5);`,
          [
            id,
            f.big.encode(big as never),
            f.i64.encode(i64 as never),
            f.u32.encode(u32 as never),
            f.u64.encode(u64 as never),
          ],
        );
        const row = (
          await conn.query<{
            big: unknown;
            i64: unknown;
            u32: unknown;
            u64: unknown;
          }>(`SELECT "big","i64","u32","u64" FROM "bn" WHERE id=$1;`, [id])
        ).rows[0];
        expect(f.big.decode(row.big)).toBe(big);
        expect(f.i64.decode(row.i64)).toBe(i64);
        expect(f.u32.decode(row.u32)).toBe(u32);
        expect(f.u64.decode(row.u64)).toBe(u64);
      }
      const { up, down } = buildKindDiff(
        registry,
        await postgresDriver.introspectAll(conn),
        objs,
      );
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });

  test("schema factories: xor / records / stringFormat / templateLiteral / keyof / preprocess", () => {
    const xor = s.xor([
      z.object({ a: z.string() }),
      z.object({ b: z.string() }),
    ]);
    expect(xor.safeDecode({ a: "x" }).success).toBe(true);
    expect(xor.safeDecode({ a: "x", b: "y" }).success).toBe(false); // exclusive
    expect(
      s.partialRecord(z.string(), s.int()).safeDecode({ x: 1 }).success,
    ).toBe(true);
    expect(
      s.looseRecord(z.string(), s.int()).safeDecode({ x: 1 }).success,
    ).toBe(true);
    expect(
      s.stringFormat("hex", (v) => /^[0-9a-f]+$/.test(v)).safeDecode("ff")
        .success,
    ).toBe(true);
    expect(
      s.keyof(s.object({ a: s.text(), b: s.int() })).safeDecode("a").success,
    ).toBe(true);
    expect(s.keyof(s.object({ a: s.text() })).safeDecode("z").success).toBe(
      false,
    );
    expect(s.preprocess((x) => String(x), s.text()).decode(123)).toBe("123");
    // jsonb / text / inherited column types
    const out = emitKinds(
      registry,
      postgresDriver.explode(
        [
          defineTable("sf", {
            x: s.xor([z.string(), z.number()]),
            r: s.partialRecord(z.string(), s.int()),
            tl: s.templateLiteral(["a", z.number()]),
            pp: s.preprocess((v) => v, s.integer()),
          }),
        ],
        [],
      ),
    ).join("\n");
    expect(out).toContain('"x" jsonb NOT NULL');
    expect(out).toContain('"r" jsonb NOT NULL');
    expect(out).toContain('"tl" text NOT NULL');
    expect(out).toContain('"pp" integer NOT NULL'); // preprocess inherits the inner field's column
  });
});
