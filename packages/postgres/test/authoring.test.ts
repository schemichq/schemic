import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import * as z from "zod";
import {
  defineEnum,
  defineTable,
  defineView,
  type PgConn,
  PgField,
  postgresDriver,
  s,
  sqlExpr,
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
