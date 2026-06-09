/**
 * PARITY — generated DDL assertions (no DB).
 *
 * Section-by-section feature audit of the surreal-zod SCHEMA/DDL layer against
 * SurrealDB's SurQL `DEFINE` statements. Each `test` pins the exact DDL surreal-zod
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
  sz,
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
    expect(typeOf(sz.string())).toBe("string");
    expect(typeOf(sz.boolean())).toBe("bool");
    expect(typeOf(sz.null())).toBe("null");
    expect(typeOf(sz.any())).toBe("any");
    expect(typeOf(sz.unknown())).toBe("any");
  });

  test("numbers: int family -> int, float -> float, plain -> number, decimal -> decimal", () => {
    expect(typeOf(sz.int())).toBe("int");
    expect(typeOf(sz.int32())).toBe("int");
    expect(typeOf(sz.uint32())).toBe("int");
    expect(typeOf(sz.bigint())).toBe("int");
    expect(typeOf(sz.float())).toBe("float");
    expect(typeOf(sz.number())).toBe("number");
    expect(typeOf(sz.decimal())).toBe("decimal");
  });

  test("surreal-native: datetime / duration / bytes / uuid / file", () => {
    expect(typeOf(sz.datetime())).toBe("datetime");
    expect(typeOf(sz.date())).toBe("datetime"); // alias
    expect(typeOf(sz.duration())).toBe("duration");
    expect(typeOf(sz.bytes())).toBe("bytes");
    expect(typeOf(sz.uuid())).toBe("uuid");
    expect(typeOf(sz.file())).toBe("file");
  });
});

describe("types — geometry (all 7 kinds match the DB)", () => {
  test("bare geometry and every geometry<kind>", () => {
    expect(typeOf(sz.geometry())).toBe("geometry");
    for (const k of [
      "point",
      "line",
      "polygon",
      "multipoint",
      "multiline",
      "multipolygon",
      "collection",
    ] as const) {
      expect(typeOf(sz.geometry(k))).toBe(`geometry<${k}>`);
    }
  });
});

describe("types — string formats (string::is_* baked when the DB has the validator)", () => {
  test("bakeable formats add a string::is_<fmt> ASSERT", () => {
    expect(fieldDdl(sz.email())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_email($value);",
    );
    expect(fieldDdl(sz.url())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_url($value);",
    );
    expect(fieldDdl(sz.ipv4())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ipv4($value);",
    );
    expect(fieldDdl(sz.ipv6())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ipv6($value);",
    );
    expect(fieldDdl(sz.ulid())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_ulid($value);",
    );
  });

  test("non-bakeable formats stay a plain string (no fabricated regex)", () => {
    // The DB has no string::is_<fmt> for these — surreal-zod leaves them assert-free.
    expect(fieldDdl(sz.jwt())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
    expect(fieldDdl(sz.cuid())).toBe("DEFINE FIELD f ON TABLE t TYPE string;");
    expect(fieldDdl(sz.nanoid())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string;",
    );
    expect(fieldDdl(sz.base64())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string;",
    );
  });
});

describe("types — record links", () => {
  test("single, multi-table, array-of-record", () => {
    expect(typeOf(sz.recordId("user"))).toBe("record<user>");
    expect(typeOf(sz.recordId(["user", "admin"]))).toBe("record<user | admin>");
    expect(typeOf(sz.array(sz.recordId("user")))).toBe("array<record<user>>");
  });

  test("an id-value type does not change the DDL leaf (record<user>)", () => {
    expect(typeOf(sz.recordId("user").type(z.string()))).toBe("record<user>");
  });
});

describe("types — literals / enums / unions / tuples", () => {
  test("literal scalar / enum / string-literal union", () => {
    expect(typeOf(sz.literal("admin"))).toBe('"admin"');
    expect(typeOf(sz.literal(42))).toBe("42");
    expect(typeOf(sz.enum(["a", "b", "c"]))).toBe('"a" | "b" | "c"');
    expect(typeOf(sz.union([sz.literal("ok"), sz.literal("err")]))).toBe(
      '"ok" | "err"',
    );
  });

  test("nativeEnum (string + numeric) -> literal union", () => {
    expect(typeOf(sz.nativeEnum({ A: "a", B: "b" } as const))).toBe(
      '"a" | "b"',
    );
    expect(typeOf(sz.nativeEnum({ A: 1, B: 2 } as const))).toBe("1 | 2");
  });

  test("union of scalar types / tuple -> [a, b]", () => {
    expect(typeOf(sz.union([sz.string(), sz.number()]))).toBe(
      "string | number",
    );
    expect(typeOf(sz.tuple([sz.string(), sz.number()]))).toBe(
      "[string, number]",
    );
  });
});

describe("types — collections (objects / arrays / maps)", () => {
  test("nested object expands into path-qualified subfields", () => {
    const ddl = fieldDdl(
      sz.object({ a: sz.string(), b: sz.number().optional() }),
    );
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object;",
        "DEFINE FIELD f.a ON TABLE t TYPE string;",
        "DEFINE FIELD f.b ON TABLE t TYPE option<number>;",
      ].join("\n"),
    );
  });

  test("array of object emits the element via .* subfields", () => {
    const ddl = fieldDdl(
      sz.array(sz.object({ x: sz.string(), y: sz.number() })),
    );
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE array<object>;",
        "DEFINE FIELD f.*.x ON TABLE t TYPE string;",
        "DEFINE FIELD f.*.y ON TABLE t TYPE number;",
      ].join("\n"),
    );
  });

  test("open-keyed record/map -> object with a .* value field", () => {
    const ddl = fieldDdl(sz.record(z.string(), sz.number()));
    expect(ddl).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object;",
        "DEFINE FIELD f.* ON TABLE t TYPE number;",
      ].join("\n"),
    );
    // sz.map renders identically.
    expect(fieldDdl(sz.map(sz.string(), sz.number()))).toBe(ddl);
  });

  test("deeply nested object chains f.a.b.c", () => {
    const ddl = fieldDdl(
      sz.object({ a: sz.object({ b: sz.object({ c: sz.string() }) }) }),
    );
    expect(ddl).toContain("DEFINE FIELD f.a.b.c ON TABLE t TYPE string;");
  });

  test("intersection of objects merges their subfields", () => {
    const ddl = fieldDdl(
      sz.intersection(
        sz.object({ a: sz.string() }),
        sz.object({ b: sz.number() }),
      ),
    );
    expect(ddl).toContain("DEFINE FIELD f.a ON TABLE t TYPE string;");
    expect(ddl).toContain("DEFINE FIELD f.b ON TABLE t TYPE number;");
  });
});

describe("types — optionality folding", () => {
  test("optional -> option<T>, nullable -> T | null, nullish folds together", () => {
    expect(typeOf(sz.string().optional())).toBe("option<string>");
    expect(typeOf(sz.string().nullable())).toBe("string | null");
    expect(typeOf(sz.string().nullish())).toBe("option<string | null>");
  });

  test("option<any> is suppressed (any already admits NONE)", () => {
    expect(typeOf(sz.any().optional())).toBe("any");
  });

  test("a DB-side DEFAULT/VALUE strips a leading option<>", () => {
    // The column is always populated -> drop option<>.
    expect(fieldDdl(sz.string().optional().$default("x"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string DEFAULT "x";',
    );
  });
});

describe("types — GAPS (confirmed against the DB)", () => {
  // FIXED (batch 1): sz.set() now emits the distinct, round-tripping `set<T>` (not `array<T>`).
  test("set<T> is preserved (was lossy → array<T>)", () => {
    expect(typeOf(sz.set(sz.string()))).toBe("set<string>");
  });

  // Object-LITERAL unions: the DB accepts
  //   TYPE { kind: "a", x: string } | { kind: "b", y: number }
  // but surreal-zod collapses a discriminatedUnion of objects to a plain `object`.
  test("object-literal union collapses to plain object (lossy)", () => {
    const ddl = fieldDdl(
      sz.discriminatedUnion("kind", [
        sz.object({ kind: sz.literal("a"), x: sz.string() }),
        sz.object({ kind: sz.literal("b"), y: sz.number() }),
      ]),
    );
    expect(ddl).toBe("DEFINE FIELD f ON TABLE t TYPE object;");
  });
  test.todo('GAP: object-literal union should emit `{ kind: "a", x: string } | { kind: "b", y: number }`', () => {});

  // array<T, N> / set<T, N> max-size param: no surreal-zod API.
  test.todo("GAP: array/set max-size param (DB: TYPE array<string, 3> / set<int, 5>)", () => {});

  // range / regex / point(bare) / function — valid DB field types with no sz.* type.
  test.todo("GAP: no sz.range() (DB: TYPE range), sz.regex() (TYPE regex)", () => {});
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
        defineTable("cf", { id: sz.string() }).changefeed("1d", {
          includeOriginal: true,
        }),
      ).split("\n")[0],
    ).toContain("CHANGEFEED 1d INCLUDE ORIGINAL");
  });
  test.todo("GAP: TYPE RELATION ... ENFORCED (referential integrity on relate endpoints)", () => {});
  test.todo("GAP: computed/view tables (DB: DEFINE TABLE ... AS SELECT ... FROM ...)", () => {});
});

describe("relations", () => {
  test("restricted endpoints -> TYPE RELATION FROM a TO b", () => {
    const A = defineTable("usr", { id: z.string() });
    const rel = defineRelation("friend", { weight: sz.number() }).from(A).to(A);
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
    expect(fieldDdl(sz.string().$default("pending"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string DEFAULT "pending";',
    );
    expect(fieldDdl(sz.string().$default(surql`time::now()`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string DEFAULT time::now();",
    );
    expect(fieldDdl(sz.datetime().$defaultAlways(surql`time::now()`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE datetime DEFAULT ALWAYS time::now();",
    );
  });

  test("VALUE / READONLY / COMMENT", () => {
    expect(fieldDdl(sz.string().$value(surql`string::lowercase($value)`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string VALUE string::lowercase($value);",
    );
    expect(fieldDdl(sz.string().$readonly())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string READONLY;",
    );
    expect(fieldDdl(sz.string().$comment("a field"))).toBe(
      'DEFINE FIELD f ON TABLE t TYPE string COMMENT "a field";',
    );
  });

  test("ASSERT: custom surql + derived from $-constraints (AND-combined)", () => {
    expect(fieldDdl(sz.number().$assert(surql`$value > 0`))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE number ASSERT $value > 0;",
    );
    expect(fieldDdl(sz.string().$min(3).$max(10))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT string::len($value) >= 3 AND string::len($value) <= 10;",
    );
    expect(fieldDdl(sz.number().$gt(0))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE number ASSERT $value > 0;",
    );
    expect(fieldDdl(sz.string().$regex(/^[a-z]+$/))).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string ASSERT $value = /^[a-z]+$/;",
    );
  });

  test("FLEXIBLE (loose object)", () => {
    expect(fieldDdl(sz.object({ a: sz.string() }).flexible())).toBe(
      [
        "DEFINE FIELD f ON TABLE t TYPE object FLEXIBLE;",
        "DEFINE FIELD f.a ON TABLE t TYPE string;",
      ].join("\n"),
    );
  });

  test("field PERMISSIONS: per-op object + `same as` references", () => {
    expect(
      fieldDdl(sz.string().$permissions({ select: true, update: false })),
    ).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string PERMISSIONS FOR select FULL FOR update NONE;",
    );
    expect(
      fieldDdl(
        sz.string().$permissions({
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
    expect(fieldDdl(sz.string().$internal())).toBe(
      "DEFINE FIELD f ON TABLE t TYPE string PERMISSIONS NONE;",
    );
  });

  // GAP: record references — REFERENCE [ON DELETE ...]. The DB accepts
  //   DEFINE FIELD author ON comment TYPE record<person> REFERENCE ON DELETE CASCADE;
  // surreal-zod has no `.reference()` / ON DELETE builder.
  test.todo("GAP: REFERENCE / ON DELETE (CASCADE|REJECT|IGNORE|UNSET|THEN) on record fields", () => {});
});

// ===========================================================================
// SECTION: INDEXES — https://surrealdb.com/docs/surrealql/statements/define/indexes
// ===========================================================================
describe("indexes", () => {
  test("single-field plain index via .index()", () => {
    const ddl = emitTable(
      defineTable("t", { id: z.string(), email: sz.string().index() }),
    );
    expect(ddl).toContain("DEFINE INDEX t_email_idx ON TABLE t FIELDS email;");
  });

  test("single-field UNIQUE via .unique()", () => {
    const ddl = emitTable(
      defineTable("t", { id: z.string(), email: sz.string().unique() }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX t_email_idx ON TABLE t FIELDS email UNIQUE;",
    );
  });

  test("composite UNIQUE via .index(name, fields, { unique })", () => {
    const ddl = emitTable(
      defineTable("t", {
        id: z.string(),
        a: sz.string(),
        b: sz.string(),
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
    const fn = defineFunction("greet", { name: sz.string() })
      .returns(sz.string())
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
