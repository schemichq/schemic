/**
 * PARITY — generated DDL assertions (no DB).
 *
 * Section-by-section feature audit of the @schemic/core SCHEMA/DDL layer against
 * SurrealDB's SurQL `DEFINE` statements. Each `test` pins the exact DDL @schemic/core
 * emits for a feature (simple + complex/edge case); `test.todo` marks a confirmed GAP
 * (the SurQL it would need is in the comment + PARITY.md). The live round-trips that
 * prove SurrealDB 3.1.3 ACCEPTS this DDL live are in `live-parity.test.ts`.
 *
 * Docs (source of truth):
 *   https://surrealdb.com/docs/surrealql/datamodel
 *   https://surrealdb.com/docs/surrealql/statements/define/{table,field,indexes}
 */
import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { z } from "zod";
import {
  emitDefStatement,
  emitField,
  emitTable,
  fieldType,
} from "../../src/ddl";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  type SField,
  s,
} from "../../src/pure";

/** DDL for a single standalone field `f` on table `t`. */
const fieldDdl = (field: SField) => emitField("f", "t", field);
/** The bare SurrealQL leaf type a field infers to (`fieldType` from the library). */
const typeOf = (field: SField) => fieldType(field);

// ===========================================================================
// SECTION: DATA MODEL / TYPES — https://surrealdb.com/docs/surrealql/datamodel
// ===========================================================================
describe("types — scalars", () => {
  test("string / bool / null / any", () => {
    expect(typeOf(s.string())).toBe("string");
    expect(typeOf(s.boolean())).toBe("bool");
    expect(typeOf(s.null())).toBe("null");
    expect(typeOf(s.any())).toBe("any");
    expect(typeOf(s.unknown())).toBe("any");
  });

  test("numbers: int family -> int, float -> float, plain -> number, decimal -> decimal", () => {
    expect(typeOf(s.int())).toBe("int");
    expect(typeOf(s.int32())).toBe("int");
    expect(typeOf(s.uint32())).toBe("int");
    expect(typeOf(s.bigint())).toBe("int");
    expect(typeOf(s.float())).toBe("float");
    expect(typeOf(s.number())).toBe("number");
    expect(typeOf(s.decimal())).toBe("decimal");
  });

  test("surreal-native: datetime / duration / bytes / uuid / file", () => {
    expect(typeOf(s.datetime())).toBe("datetime");
    expect(typeOf(s.date())).toBe("datetime"); // alias
    expect(typeOf(s.duration())).toBe("duration");
    expect(typeOf(s.bytes())).toBe("bytes");
    expect(typeOf(s.uuid())).toBe("uuid");
    expect(typeOf(s.file())).toBe("file");
  });
});

describe("types — geometry (all 7 kinds match the DB)", () => {
  test("bare geometry and every geometry<kind>", () => {
    expect(typeOf(s.geometry())).toBe("geometry");
    for (const k of [
      "point",
      "line",
      "polygon",
      "multipoint",
      "multiline",
      "multipolygon",
      "collection",
    ] as const) {
      expect(typeOf(s.geometry(k))).toBe(`geometry<${k}>`);
    }
  });
});

describe("types — string formats (string::is_* baked when the DB has the validator)", () => {
  test("bakeable formats add a string::is_<fmt> ASSERT", () => {
    expect(fieldDdl(s.email())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_email($value);",
    );
    expect(fieldDdl(s.url())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_url($value);",
    );
    expect(fieldDdl(s.ipv4())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ipv4($value);",
    );
    expect(fieldDdl(s.ipv6())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ipv6($value);",
    );
    expect(fieldDdl(s.ulid())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ulid($value);",
    );
  });

  // FIXED (batch 2): additional 3.1.3 string::is_* validators (no Zod format builder).
  test("batch-2 validators bake their string::is_* ASSERT", () => {
    const cases: [SField, string][] = [
      [s.alpha(), "is_alpha"],
      [s.alphanum(), "is_alphanum"],
      [s.ascii(), "is_ascii"],
      [s.numeric(), "is_numeric"],
      [s.semver(), "is_semver"],
      [s.hexadecimal(), "is_hexadecimal"],
      [s.latitude(), "is_latitude"],
      [s.longitude(), "is_longitude"],
      [s.ip(), "is_ip"],
      [s.domain(), "is_domain"],
    ];
    for (const [field, fn] of cases) {
      expect(fieldDdl(field)).toBe(
        `DEFINE FIELD f ON TABLE t TYPE string ASSERT string::${fn}($value);`,
      );
    }
  });

  test("non-bakeable formats stay a plain string (no fabricated regex)", () => {
    // The DB has no string::is_<fmt> for these — @schemic/core leaves them assert-free.
    expect(fieldDdl(s.jwt())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
    expect(fieldDdl(s.cuid())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
    expect(fieldDdl(s.nanoid())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
    expect(fieldDdl(s.base64())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
  });
});

describe("types — record links", () => {
  test("single, multi-table, array-of-record", () => {
    expect(typeOf(s.recordId("user"))).toBe("record<user>");
    expect(typeOf(s.recordId(["user", "admin"]))).toBe("record<user | admin>");
    expect(typeOf(s.array(s.recordId("user")))).toBe("array<record<user>>");
  });

  test("an id-value type does not change the DDL leaf (record<user>)", () => {
    expect(typeOf(s.recordId("user").type(z.string()))).toBe("record<user>");
  });
});

describe("types — literals / enums / unions / tuples", () => {
  test("literal scalar / enum / string-literal union", () => {
    expect(typeOf(s.literal("admin"))).toBe('"admin"');
    expect(typeOf(s.literal(42))).toBe("42");
    expect(typeOf(s.enum(["a", "b", "c"]))).toBe('"a" | "b" | "c"');
    expect(typeOf(s.union([s.literal("ok"), s.literal("err")]))).toBe(
      '"ok" | "err"',
    );
  });

  test("nativeEnum (string + numeric) -> literal union", () => {
    expect(typeOf(s.nativeEnum({ A: "a", B: "b" } as const))).toBe('"a" | "b"');
    expect(typeOf(s.nativeEnum({ A: 1, B: 2 } as const))).toBe("1 | 2");
  });

  test("union of scalar types / tuple -> [a, b]", () => {
    expect(typeOf(s.union([s.string(), s.number()]))).toBe("string | number");
    expect(typeOf(s.tuple([s.string(), s.number()]))).toBe("[string, number]");
  });
});

describe("types — collections (objects / arrays / maps)", () => {
  test("nested object expands into path-qualified subfields", () => {
    const ddl = fieldDdl(s.object({ a: s.string(), b: s.number().optional() }));
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object;",
        "DEFINE FIELD f.a ON TABLE t TYPE string;",
        "DEFINE FIELD f.b ON TABLE t TYPE option<number>;",
      ].join("\n"),
    );
  });

  test("array of object emits the element via .* subfields", () => {
    const ddl = fieldDdl(s.array(s.object({ x: s.string(), y: s.number() })));
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE array<object>;",
        "DEFINE FIELD f.*.x ON TABLE t TYPE string;",
        "DEFINE FIELD f.*.y ON TABLE t TYPE number;",
      ].join("\n"),
    );
  });

  test("open-keyed record/map -> object with a .* value field", () => {
    const ddl = fieldDdl(s.record(z.string(), s.number()));
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object;",
        "DEFINE FIELD f.* ON TABLE t TYPE number;",
      ].join("\n"),
    );
    // s.map renders identically.
    expect(fieldDdl(s.map(s.string(), s.number()))).toBe(ddl);
  });

  test("deeply nested object chains f.a.b.c", () => {
    const ddl = fieldDdl(
      s.object({ a: s.object({ b: s.object({ c: s.string() }) }) }),
    );
    expect(ddl).toContain("DEFINE FIELD f.a.b.c ON TABLE t TYPE string;");
  });

  test("intersection of objects merges their subfields", () => {
    const ddl = fieldDdl(
      s.intersection(s.object({ a: s.string() }), s.object({ b: s.number() })),
    );
    expect(ddl).toContain("DEFINE FIELD f.a ON TABLE t TYPE string;");
    expect(ddl).toContain("DEFINE FIELD f.b ON TABLE t TYPE number;");
  });
});

describe("types — optionality folding", () => {
  test("optional -> option<T>, nullable -> T | null, nullish folds together", () => {
    expect(typeOf(s.string().optional())).toBe("option<string>");
    expect(typeOf(s.string().nullable())).toBe("string | null");
    expect(typeOf(s.string().nullish())).toBe("option<string | null>");
  });

  test("option<any> is suppressed (any already admits NONE)", () => {
    expect(typeOf(s.any().optional())).toBe("any");
  });

  test("a DB-side DEFAULT/VALUE strips a leading option<>", () => {
    // The column is always populated -> drop option<>.
    expect(fieldDdl(s.string().optional().$default("x"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string DEFAULT "x";',
    );
  });
});

describe("types — GAPS (confirmed against the DB)", () => {
  // FIXED (batch 1): s.set() now emits the distinct, round-tripping `set<T>` (not `array<T>`).
  test("set<T> is preserved (was lossy → array<T>)", () => {
    expect(typeOf(s.set(s.string()))).toBe("set<string>");
  });

  // Object-LITERAL unions: the DB accepts
  //   TYPE { kind: "a", x: string } | { kind: "b", y: number }
  // but @schemic/core collapses a discriminatedUnion of objects to a plain `object`.
  test("object-literal union collapses to plain object (lossy)", () => {
    const ddl = fieldDdl(
      s.discriminatedUnion("kind", [
        s.object({ kind: s.literal("a"), x: s.string() }),
        s.object({ kind: s.literal("b"), y: s.number() }),
      ]),
    );
    expect(ddl).toBe("DEFINE FIELD f ON TABLE t TYPE object;");
  });
  test.todo('GAP: object-literal union should emit `{ kind: "a", x: string } | { kind: "b", y: number }`', () => {});

  // FIXED (batch 2): array<T, N> / set<T, N> max-size via `{ max }` (N is the MAX size).
  test("sized array<T, N> / set<T, N> via { max }", () => {
    expect(typeOf(s.array(s.string(), { max: 3 }))).toBe("array<string, 3>");
    expect(typeOf(s.set(s.int(), { max: 5 }))).toBe("set<int, 5>");
    // set stays `set` (never `array`), sized or not:
    expect(typeOf(s.set(s.string()))).toBe("set<string>");
    expect(typeOf(s.set(s.string(), { max: 2 }))).toBe("set<string, 2>");
  });

  // range / regex / point(bare) / function — valid DB field types with no s.* type.
  test.todo("GAP: no s.range() (DB: TYPE range), s.regex() (TYPE regex)", () => {});
});

// ===========================================================================
// SECTION: TABLE CLAUSES — https://surrealdb.com/docs/surrealql/statements/define/table
// ===========================================================================
describe("table clauses", () => {
  const head = (t: ReturnType<typeof defineTable>) =>
    emitTable(t).split("\n")[0];

  test("default = TYPE NORMAL SCHEMAFULL", () => {
    expect(head(defineTable("t", { id: z.string() }))).toBe(
      "DEFINE TABLE t TYPE NORMAL SCHEMAFULL;",
    );
  });

  test("schemaless()", () => {
    expect(head(defineTable("t", { id: z.string() }).schemaless())).toBe(
      "DEFINE TABLE t TYPE NORMAL SCHEMALESS;",
    );
  });

  test("typeAny() -> TYPE ANY", () => {
    expect(head(defineTable("t", { id: z.string() }).typeAny())).toBe(
      "DEFINE TABLE t TYPE ANY SCHEMAFULL;",
    );
  });

  test("drop() + comment()", () => {
    expect(head(defineTable("t", { id: z.string() }).schemaless().drop())).toBe(
      "DEFINE TABLE t TYPE NORMAL DROP SCHEMALESS;",
    );
    expect(head(defineTable("t", { id: z.string() }).comment("hi"))).toBe(
      'DEFINE TABLE t TYPE NORMAL SCHEMAFULL COMMENT "hi";',
    );
  });

  test("table PERMISSIONS folded into the DEFINE TABLE head", () => {
    const t = defineTable("t", { id: z.string() }).permissions({
      select: true,
      create: surql`$auth.id != NONE`,
    });
    expect(head(t)).toBe(
      "DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select FULL FOR create WHERE $auth.id != NONE;",
    );
  });

  test("OVERWRITE / IF NOT EXISTS prefixes", () => {
    const t = defineTable("t", { id: z.string() });
    expect(emitTable(t, { exists: "overwrite" }).split("\n")[0]).toBe(
      "DEFINE TABLE OVERWRITE t TYPE NORMAL SCHEMAFULL;",
    );
    expect(emitTable(t, { exists: "ignore" }).split("\n")[0]).toBe(
      "DEFINE TABLE IF NOT EXISTS t TYPE NORMAL SCHEMAFULL;",
    );
  });

  test("CHANGEFEED clause (FIXED batch 1)", () => {
    expect(
      emitTable(
        defineTable("cf", { id: s.string() }).changefeed("1d", {
          includeOriginal: true,
        }),
      ).split("\n")[0],
    ).toContain("CHANGEFEED 1d INCLUDE ORIGINAL");
  });
  // FIXED (batch 2): TYPE RELATION ... ENFORCED via .enforced().
  test("TYPE RELATION ... ENFORCED via .enforced()", () => {
    const A = defineTable("usr", { id: z.string() });
    const rel = defineRelation("friend", {}).from(A).to(A).enforced();
    expect(emitTable(rel).split("\n")[0]).toBe(
      "DEFINE TABLE friend TYPE RELATION FROM usr TO usr ENFORCED SCHEMAFULL;",
    );
    expect(emitTable(defineRelation("rel", {}).enforced()).split("\n")[0]).toBe(
      "DEFINE TABLE rel TYPE RELATION ENFORCED SCHEMAFULL;",
    );
  });
  test.todo("GAP: computed/view tables (DB: DEFINE TABLE ... AS SELECT ... FROM ...)", () => {});
});

describe("relations", () => {
  test("restricted endpoints -> TYPE RELATION FROM a TO b", () => {
    const A = defineTable("usr", { id: z.string() });
    const rel = defineRelation("friend", { weight: s.number() }).from(A).to(A);
    const lines = emitTable(rel).split("\n");
    expect(lines[0]).toBe(
      "DEFINE TABLE friend TYPE RELATION FROM usr TO usr SCHEMAFULL;",
    );
    expect(lines).toContain("DEFINE FIELD weight ON TABLE friend TYPE number;");
  });

  test("open relation -> bare TYPE RELATION (no FROM/TO)", () => {
    expect(emitTable(defineRelation("rel", {})).split("\n")[0]).toBe(
      "DEFINE TABLE rel TYPE RELATION SCHEMAFULL;",
    );
  });
});

// ===========================================================================
// SECTION: FIELD CLAUSES — https://surrealdb.com/docs/surrealql/statements/define/field
// ===========================================================================
describe("field clauses", () => {
  test("DEFAULT (literal + surql) and DEFAULT ALWAYS", () => {
    expect(fieldDdl(s.string().$default("pending"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string DEFAULT "pending";',
    );
    expect(fieldDdl(s.string().$default(surql`time::now()`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string DEFAULT time::now();",
    );
    expect(fieldDdl(s.datetime().$defaultAlways(surql`time::now()`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE datetime DEFAULT ALWAYS time::now();",
    );
  });

  test("VALUE / READONLY / COMMENT", () => {
    expect(fieldDdl(s.string().$value(surql`string::lowercase($value)`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string VALUE string::lowercase($value);",
    );
    expect(fieldDdl(s.string().$readonly())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string READONLY;",
    );
    expect(fieldDdl(s.string().$comment("a field"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string COMMENT "a field";',
    );
  });

  test("ASSERT: custom surql + derived from $-constraints (AND-combined)", () => {
    expect(fieldDdl(s.number().$assert(surql`$value > 0`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE number ASSERT $value > 0;",
    );
    expect(fieldDdl(s.string().$min(3).$max(10))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::len($value) >= 3 AND string::len($value) <= 10;",
    );
    expect(fieldDdl(s.number().$gt(0))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE number ASSERT $value > 0;",
    );
    expect(fieldDdl(s.string().$regex(/^[a-z]+$/))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT $value = /^[a-z]+$/;",
    );
  });

  test("FLEXIBLE (loose object)", () => {
    expect(fieldDdl(s.object({ a: s.string() }).flexible())).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object FLEXIBLE;",
        "DEFINE FIELD f.a ON TABLE t TYPE string;",
      ].join("\n"),
    );
  });

  test("field PERMISSIONS: per-op object + `same as` references", () => {
    expect(
      fieldDdl(s.string().$permissions({ select: true, update: false })),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string PERMISSIONS FOR select FULL FOR update NONE;",
    );
    expect(
      fieldDdl(
        s.string().$permissions({
          select: surql`$auth.id != NONE`,
          create: "same as select",
          update: "same as select",
        }),
      ),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string PERMISSIONS FOR select, create, update WHERE $auth.id != NONE;",
    );
  });

  test("$internal() -> PERMISSIONS NONE (DB-managed, client-hidden)", () => {
    expect(fieldDdl(s.string().$internal())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string PERMISSIONS NONE;",
    );
  });

  // FIXED (batch 2): record references — REFERENCE [ON DELETE ...] via .$reference().
  test("REFERENCE / ON DELETE on record fields", () => {
    expect(fieldDdl(s.recordId("person").$reference())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE record<person> REFERENCE;",
    );
    expect(
      fieldDdl(s.recordId("person").$reference({ onDelete: "cascade" })),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE record<person> REFERENCE ON DELETE CASCADE;",
    );
    // works on array<record<>> too, and a surql expr -> ON DELETE THEN:
    expect(
      fieldDdl(s.array(s.recordId("c")).$reference({ onDelete: "unset" })),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE array<record<c>> REFERENCE ON DELETE UNSET;",
    );
    expect(
      fieldDdl(
        s.recordId("person").$reference({ onDelete: surql`DELETE $this` }),
      ),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE record<person> REFERENCE ON DELETE THEN DELETE $this;",
    );
  });
});

// ===========================================================================
// SECTION: INDEXES — https://surrealdb.com/docs/surrealql/statements/define/indexes
// ===========================================================================
describe("indexes", () => {
  test("single-field plain index via .index()", () => {
    const ddl = emitTable(
      defineTable("t", { id: z.string(), email: s.string().index() }),
    );
    expect(ddl).toContain("DEFINE INDEX t_email_idx ON TABLE t FIELDS email;");
  });

  test("single-field UNIQUE via .unique()", () => {
    const ddl = emitTable(
      defineTable("t", { id: z.string(), email: s.string().unique() }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX t_email_idx ON TABLE t FIELDS email UNIQUE;",
    );
  });

  test("composite UNIQUE via .index(name, fields, { unique })", () => {
    const ddl = emitTable(
      defineTable("t", {
        id: z.string(),
        a: s.string(),
        b: s.string(),
      }).index("ab_idx", ["a", "b"], { unique: true }),
    );
    expect(ddl).toContain("DEFINE INDEX ab_idx ON TABLE t FIELDS a, b UNIQUE;");
  });

  test.todo("GAP: FULLTEXT search index (DB: DEFINE INDEX ... FULLTEXT ANALYZER x BM25 HIGHLIGHTS)", () => {});
  test.todo("GAP: HNSW / MTREE / DISKANN vector indexes (DB: ... HNSW DIMENSION n ...)", () => {});
  test.todo("GAP: CONCURRENTLY / DEFER / COUNT index modifiers", () => {});
});

// ===========================================================================
// SECTION: DEFINE statements coverage (function / access supported; others GAP)
// ===========================================================================
describe("DEFINE statements", () => {
  test("DEFINE FUNCTION (args, return type, body)", () => {
    const fn = defineFunction("greet", { name: s.string() })
      .returns(s.string())
      .body(surql`RETURN "Hi " + $name`);
    const out = emitDefStatement(fn).ddl;
    expect(out).toBe(
      'DEFINE FUNCTION fn::greet($name: string) -> string { RETURN "Hi " + $name };',
    );
  });

  test("DEFINE ACCESS RECORD / JWT / BEARER", () => {
    const rec = defineAccess("app")
      .record()
      .signin(surql`SELECT * FROM usr WHERE email = $email`)
      .duration({ token: "1h", session: "12h" });
    expect(emitDefStatement(rec).ddl).toBe(
      "DEFINE ACCESS app ON DATABASE TYPE RECORD SIGNIN { SELECT * FROM usr WHERE email = $email } DURATION FOR TOKEN 1h, FOR SESSION 12h;",
    );
    const jwt = defineAccess("ext").jwt({ alg: "HS512", key: "secret" });
    expect(emitDefStatement(jwt).ddl).toBe(
      'DEFINE ACCESS ext ON DATABASE TYPE JWT ALGORITHM HS512 KEY "secret";',
    );
    const bearer = defineAccess("svc")
      .bearer({ for: "record" })
      .duration({ grant: "30d" });
    expect(emitDefStatement(bearer).ddl).toBe(
      "DEFINE ACCESS svc ON DATABASE TYPE BEARER FOR RECORD DURATION FOR GRANT 30d;",
    );
  });

  test.todo("GAP: DEFINE ANALYZER (needed to back a FULLTEXT index)", () => {});
  test.todo("GAP: DEFINE PARAM ($global = value)", () => {});
  test.todo("GAP: DEFINE USER / SEQUENCE / CONFIG / API / BUCKET / MODEL", () => {});
});
