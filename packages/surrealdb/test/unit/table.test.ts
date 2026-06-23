import { describe, expect, test } from "bun:test";
import { DateTime, RecordId, surql, Table } from "surrealdb";
import { z } from "zod";
import { emitTable } from "../../src/ddl";
import {
  defineAnalyzer,
  defineRelation,
  defineTable,
  defineView,
  RecordIdField,
  s,
} from "../../src/pure";

const defType = (s: z.ZodType) => (s._zod.def as { type: string }).type;

describe("smart id", () => {
  test("a plain id schema becomes record<self, idType>", () => {
    const T = defineTable("widget", { id: z.string(), name: s.string() });
    const id = T.fields.id as RecordIdField<"widget">;
    expect(id).toBeInstanceOf(RecordIdField);
    expect(id.tables).toEqual(["widget"]);
    expect(id.schema.safeParse(new RecordId("widget", "x")).success).toBe(true);
    expect(id.schema.safeParse(new RecordId("other", "x")).success).toBe(false);
  });

  test("an omitted id defaults to record<self>", () => {
    const T = defineTable("widget", { name: s.string() });
    const id = T.fields.id as RecordIdField<"widget">;
    expect(id).toBeInstanceOf(RecordIdField);
    expect(id.tables).toEqual(["widget"]);
  });

  test("callback shape: `self` is a record<thisTable> self-link", () => {
    const Node = defineTable("node", (self) => ({
      id: z.string(),
      parent: self,
      reports: self.optional(),
    }));
    // bare `self` is a RecordIdField restricted to this table
    const parent = Node.fields.parent as RecordIdField<"node">;
    expect(parent).toBeInstanceOf(RecordIdField);
    expect(parent.tables).toEqual(["node"]);
    // and the whole table emits self record links (incl. the wrapped, optional one)
    const ddl = emitTable(Node);
    expect(ddl).toContain(
      "DEFINE FIELD parent ON TABLE node TYPE record<node>;",
    );
    expect(ddl).toContain(
      "DEFINE FIELD reports ON TABLE node TYPE option<record<node>>;",
    );
  });
});

describe("bare table (no shape)", () => {
  test("defineTable(name) with no shape is a table with just the implicit id", () => {
    // Regression: `shape` used to be required, so `defineTable("user")` was a type error AND threw
    // `Object.entries(undefined)` at runtime. It's now optional (default `{}`), like defineRelation.
    const User = defineTable("user");
    expect(User.fields.id).toBeInstanceOf(RecordIdField);
    expect(emitTable(User)).toBe("DEFINE TABLE user TYPE NORMAL SCHEMAFULL;");
  });

  test("chains still work on a bare table", () => {
    expect(emitTable(defineTable("blob").schemaless())).toBe(
      "DEFINE TABLE blob TYPE NORMAL SCHEMALESS;",
    );
  });
});

describe("table instance helpers", () => {
  const User = defineTable("user", { id: s.string(), name: s.string() });

  test(".table returns a SurrealDB Table instance for direct SDK calls", () => {
    expect(User.table).toBeInstanceOf(Table);
    expect(User.table.name).toBe("user");
  });

  test("a record id is built via User.record().for(id)", () => {
    const rid = User.record().for("abc");
    expect(rid).toBeInstanceOf(RecordId);
    expect(rid.table.name).toBe("user");
    expect(rid.id).toBe("abc");
  });

  test("a relation also exposes .table (inherited from TableDef)", () => {
    const Wrote = defineRelation("wrote", {});
    expect(Wrote.table).toBeInstanceOf(Table);
    expect(Wrote.table.name).toBe("wrote");
  });
});

describe("encode / encodePartial", () => {
  const User = defineTable("user", {
    id: z.string(),
    name: s.string(),
    role: s.enum(["admin", "member"]).$default(surql`"member"`),
    settings: s.object({
      theme: s.string(),
      lastSeen: s.datetime().optional(),
    }),
    createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  });

  test("encode omits absent fields and encodes the present ones", () => {
    const payload = User.encode({
      name: "Alice",
      settings: {
        theme: "dark",
        lastSeen: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    expect(Object.keys(payload).sort()).toEqual(["name", "settings"]);
    expect(payload.name).toBe("Alice");
    // nested datetime encoded to DateTime
    expect((payload.settings as { lastSeen: unknown }).lastSeen).toBeInstanceOf(
      DateTime,
    );
  });

  test("encode accepts a full App object and a partial create input alike", () => {
    // full app (every key supplied, including DB-filled defaults)
    const full = User.encode({
      id: new RecordId("user", "alice"),
      name: "Alice",
      role: "admin",
      settings: {
        theme: "dark",
        lastSeen: new Date("2022-01-01T00:00:00.000Z"),
      },
      createdAt: new Date("2022-01-01T00:00:00.000Z"),
    });
    expect(full.role).toBe("admin");
    expect(full.createdAt).toBeInstanceOf(DateTime);
    // partial create input (DB-filled fields omitted)
    const partial = User.encode({ name: "Bob", settings: { theme: "light" } });
    expect(Object.keys(partial).sort()).toEqual(["name", "settings"]);
  });

  test("encodePartial encodes only the given keys", () => {
    const patch = User.encodePartial({ role: "admin" });
    expect(Object.keys(patch)).toEqual(["role"]);
    expect(patch.role).toBe("admin");
  });
});

describe("nested create-optionality (runtime)", () => {
  const Widget = defineTable("widget", {
    id: z.string(),
    settings: s.object({
      theme: s.string().$default(surql`"x"`),
      tz: s.string(),
      lastSeen: s.datetime().optional(),
    }),
  });

  test("encode omits an absent nested defaulted field so the DB fills it", () => {
    const payload = Widget.encode({ settings: { tz: "utc" } });
    expect(Object.keys(payload)).toEqual(["settings"]);
    const settings = payload.settings as Record<string, unknown>;
    expect(settings).not.toHaveProperty("theme");
    expect(Object.keys(settings)).toEqual(["tz"]);
    expect(settings.tz).toBe("utc");
  });

  test("encode includes a provided nested field and encodes nested codecs", () => {
    const payload = Widget.encode({
      settings: {
        tz: "utc",
        theme: "dark",
        lastSeen: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    const settings = payload.settings as Record<string, unknown>;
    expect(Object.keys(settings).sort()).toEqual(["lastSeen", "theme", "tz"]);
    expect(settings.theme).toBe("dark");
    // nested datetime codec still encoded through the recursion
    expect(settings.lastSeen).toBeInstanceOf(DateTime);
  });

  test("encodePartial encodes the full nested object (no sibling dropped)", () => {
    const patch = Widget.encodePartial({
      settings: { theme: "dark", tz: "utc" },
    });
    const settings = patch.settings as Record<string, unknown>;
    expect(Object.keys(settings).sort()).toEqual(["theme", "tz"]);
    expect(settings.theme).toBe("dark");
    expect(settings.tz).toBe("utc");
  });

  test("array<object>: absent nested defaults are omitted per element", () => {
    const List = defineTable("list", {
      id: z.string(),
      tags: s
        .object({ name: s.string(), color: s.string().$default("#fff") })
        .array(),
    });
    const payload = List.encode({
      tags: [{ name: "a" }, { name: "b", color: "#000" }],
    });
    const tags = payload.tags as Record<string, unknown>[];
    expect(tags[0]).not.toHaveProperty("color");
    expect(Object.keys(tags[0]!)).toEqual(["name"]);
    expect(tags[1]!.color).toBe("#000");
  });

  test("encodePartial is deep-partial: a partial nested object round-trips (no sibling added)", () => {
    // MERGE deep-merges, so a single nested key is a valid patch — and only it is emitted.
    const patch = Widget.encodePartial({ settings: { theme: "dark" } });
    expect(Object.keys(patch)).toEqual(["settings"]);
    expect(patch.settings as Record<string, unknown>).toEqual({
      theme: "dark",
    });
  });
});

describe("encode / safeEncode agreement on nested input (Fix 1)", () => {
  const T = defineTable("nested", {
    id: z.string(),
    settings: s.object({
      theme: s.string().$default(surql`"x"`),
      tz: s.string(),
    }),
  });
  // Mirror helper: did `encode` throw for this input?
  const encodeThrew = (input: Parameters<typeof T.encode>[0]) => {
    try {
      T.encode(input);
      return false;
    } catch {
      return true;
    }
  };

  test("a nested-partial input: encode accepts and safeEncode agrees (same data)", () => {
    const input = { settings: { tz: "utc" } } as const;
    expect(encodeThrew(input)).toBe(false);
    const res = T.safeEncode(input);
    expect(res.success).toBe(true);
    if (res.success)
      expect(res.data as Record<string, unknown>).toEqual({
        settings: { tz: "utc" },
      });
  });

  test("an invalid nested field: encode throws and safeEncode agrees (rejects, correct path)", () => {
    // tz must be a string — both paths must reject.
    const input = { settings: { tz: 123 } } as unknown as Parameters<
      typeof T.encode
    >[0];
    expect(encodeThrew(input)).toBe(true);
    const res = T.safeEncode(input);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBeInstanceOf(z.ZodError);
      expect(res.error.issues.map((i) => i.path.join("."))).toContain(
        "settings.tz",
      );
    }
  });
});

describe("safeEncode / encode validation (#6, #7)", () => {
  const User = defineTable("user", {
    id: z.string(),
    name: s.string().$min(1),
    email: s.email(),
    createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
    passhash: s.string().$internal(),
  });

  test("safeEncode with valid input -> { success: true, data } with encoded/wire values", () => {
    const res = User.safeEncode({
      name: "Alice",
      email: "alice@example.com",
      createdAt: new Date("2022-01-01T00:00:00.000Z"),
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.name).toBe("Alice");
      expect(res.data.email).toBe("alice@example.com");
      // codec field encoded to its wire value
      expect(res.data.createdAt).toBeInstanceOf(DateTime);
    }
  });

  test("safeEncode with invalid input -> { success: false } with an aggregated ZodError", () => {
    const res = User.safeEncode({ name: "", email: "not-an-email" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBeInstanceOf(z.ZodError);
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name"); // .$min(1) rejects ""
      expect(paths).toContain("email"); // bad email format
    }
  });

  test("encode throws a ZodError on invalid input", () => {
    expect(() =>
      User.encode({ name: "", email: "alice@example.com" }),
    ).toThrow();
    expect(() => User.encode({ name: "Alice", email: "nope" })).toThrow();
  });

  test("safeEncodePartial validates only the provided keys", () => {
    expect(User.safeEncodePartial({ name: "Bob" }).success).toBe(true);
    expect(User.safeEncodePartial({ name: "" }).success).toBe(false);
  });

  test("SystemView.safeEncode validates internal fields too", () => {
    const ok = User.system.safeEncode({
      name: "Alice",
      email: "a@b.co",
      passhash: "secret",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.passhash).toBe("secret");

    const bad = User.system.safeEncode({
      name: "",
      email: "a@b.co",
      passhash: "secret",
    });
    expect(bad.success).toBe(false);
  });
});

describe("async encode (recursive encoder)", () => {
  const User = defineTable("user", {
    id: z.string(),
    name: s.string().$min(1),
    settings: s.object({
      theme: s.string(),
      lastSeen: s.datetime().optional(),
    }),
    createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  });

  test("encodeAsync round-trips nested codecs and omits absent defaults", async () => {
    const payload = await User.encodeAsync({
      name: "Alice",
      settings: {
        theme: "dark",
        lastSeen: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    expect(Object.keys(payload).sort()).toEqual(["name", "settings"]);
    expect((payload.settings as { lastSeen: unknown }).lastSeen).toBeInstanceOf(
      DateTime,
    );
    expect(payload).not.toHaveProperty("createdAt");
  });

  test("safeEncodeAsync aggregates leaf errors with correct paths", async () => {
    const res = await User.safeEncodeAsync({
      name: "",
      settings: { theme: "x" },
    });
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error.issues.map((i) => i.path.join("."))).toContain("name");
  });

  test("encodePartialAsync encodes only the given keys", async () => {
    const patch = await User.encodePartialAsync({ name: "Bob" });
    expect(Object.keys(patch)).toEqual(["name"]);
    expect(patch.name).toBe("Bob");
  });

  test("encodeAsync throws the aggregated ZodError on invalid input", async () => {
    await expect(
      User.encodeAsync({ name: "", settings: { theme: "x" } }),
    ).rejects.toThrow();
  });
});

describe("$internal fields (runtime)", () => {
  const Account = defineTable("account", {
    id: z.string(),
    email: s.email(),
    passhash: s.string().$internal(),
  });

  test("decode strips the internal field; the system view keeps it", () => {
    const row = {
      id: new RecordId("account", "1"),
      email: "alice@example.com",
      passhash: "secret",
    };
    const app = Account.decode(row);
    expect(app).not.toHaveProperty("passhash");
    expect(app.email).toBe("alice@example.com");

    const sys = Account.system.decode(row);
    expect(sys.passhash).toBe("secret");
    expect(sys.email).toBe("alice@example.com");
  });

  test("encode omits internal; system.encode includes it", () => {
    const payload = Account.encode({ email: "alice@example.com" });
    expect(payload).not.toHaveProperty("passhash");
    expect(payload.email).toBe("alice@example.com");

    const sysPayload = Account.system.encode({
      email: "alice@example.com",
      passhash: "secret",
    });
    expect(sysPayload.passhash).toBe("secret");
  });
});

describe("shape ops", () => {
  const User = defineTable("user", {
    id: z.string(),
    name: s.string(),
    email: s.email(),
    bio: s.string().optional(),
  });

  test("pick / omit", () => {
    expect(Object.keys(User.pick("name", "email").fields).sort()).toEqual([
      "email",
      "name",
    ]);
    expect(Object.keys(User.omit("email").fields).sort()).toEqual([
      "bio",
      "id",
      "name",
    ]);
  });

  test("partial makes every field optional", () => {
    const p = User.partial();
    for (const f of Object.values(p.fields))
      expect(defType(f.schema)).toBe("optional");
  });

  test("required unwraps optional fields", () => {
    const r = User.required();
    expect(defType(r.fields.bio.schema)).toBe("string");
  });

  test("extend adds fields and preserves config", () => {
    const e = User.comment("note").extend({ nick: s.string() });
    expect(Object.keys(e.fields)).toContain("nick");
    expect(e.config.comment).toBe("note");
  });
});

describe("config chain (immutable)", () => {
  const User = defineTable("user", { id: z.string() });

  test("schemaless / schemafull / drop / comment return new defs", () => {
    expect(User.schemaless().config.schemafull).toBe(false);
    expect(User.schemaless().schemafull().config.schemafull).toBe(true);
    expect(User.drop().config.drop).toBe(true);
    expect(User.comment("x").config.comment).toBe("x");
    // original untouched
    expect(User.config.schemafull).toBe(true);
    expect(User.config.drop).toBeUndefined();
  });
});

describe("relation builder", () => {
  const User = defineTable("user", { id: z.string() });
  const Post = defineTable("post", { id: z.string() });
  const Tag = defineTable("tag", { id: z.string() });

  test("from().to() sets endpoints, in/out fields, and relation config", () => {
    const Liked = defineRelation("liked", { strength: s.number() })
      .from(User)
      .to(Post);
    expect(Liked.kind).toBe("relation");
    expect(Liked.config.relation).toEqual({ from: ["user"], to: ["post"] });
    expect(Liked.fields.in).toBeInstanceOf(RecordIdField);
    expect(Liked.fields.out).toBeInstanceOf(RecordIdField);
    expect((Liked.fields.in as RecordIdField<"user">).tables).toEqual(["user"]);
    expect((Liked.fields.out as RecordIdField<"post">).tables).toEqual([
      "post",
    ]);
  });

  test("multi-endpoint relation collects all table names", () => {
    const Rel = defineRelation("rel").from([User, Tag]).to(Post);
    expect(Rel.config.relation).toEqual({
      from: ["user", "tag"],
      to: ["post"],
    });
  });

  test("from()/to() accept a name string, a Table instance, and a mixed array", () => {
    const byName = defineRelation("r1").from("user").to("post");
    expect(byName.config.relation).toEqual({ from: ["user"], to: ["post"] });

    const byTable = defineRelation("r2")
      .from(new Table("user"))
      .to(new Table("post"));
    expect(byTable.config.relation).toEqual({ from: ["user"], to: ["post"] });

    // a mixed array (TableDef + name + Table) emits a FROM-union; names + typed `in` link carry through.
    const mixed = defineRelation("r3")
      .from([User, "tag", new Table("post")])
      .to(Post);
    expect(mixed.config.relation).toEqual({
      from: ["user", "tag", "post"],
      to: ["post"],
    });
    expect(
      (mixed.fields.in as RecordIdField<"user" | "tag" | "post">).tables,
    ).toEqual(["user", "tag", "post"]);
  });

  test("a normal table has no relation config", () => {
    expect(User.kind).toBe("table");
    expect(User.config.relation).toBeUndefined();
  });
});

describe("field $unique / $index (DDL clauses are $-prefixed)", () => {
  test("$unique() emits a UNIQUE index; $index() a plain index", () => {
    const uq = emitTable(
      defineTable("u", { id: s.string(), email: s.string().$unique() }),
    );
    expect(uq).toContain(
      "DEFINE INDEX u_email_idx ON TABLE u FIELDS email UNIQUE;",
    );
    const ix = emitTable(
      defineTable("d", { id: s.string(), code: s.string().$index() }),
    );
    expect(ix).toContain("DEFINE INDEX d_code_idx ON TABLE d FIELDS code;");
    expect(ix).not.toContain("UNIQUE");
  });

  test("the deprecated .unique()/.index() aliases emit identically", () => {
    const canonical = emitTable(
      defineTable("a", { id: s.string(), x: s.string().$unique() }),
    );
    const alias = emitTable(
      defineTable("a", { id: s.string(), x: s.string().unique() }),
    );
    expect(alias).toBe(canonical);
    const ci = emitTable(
      defineTable("b", { id: s.string(), x: s.string().$index() }),
    );
    const ai = emitTable(
      defineTable("b", { id: s.string(), x: s.string().index() }),
    );
    expect(ai).toBe(ci);
  });

  test("a custom index name overrides the derived `<table>_<field>_idx`", () => {
    const ddl = emitTable(
      defineTable("u", {
        id: s.string(),
        email: s.string().$unique("email_uq"),
        code: s.string().$index("code_ix"),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX email_uq ON TABLE u FIELDS email UNIQUE;",
    );
    expect(ddl).toContain("DEFINE INDEX code_ix ON TABLE u FIELDS code;");
    expect(ddl).not.toContain("u_email_idx");
    // No name -> still the derived default.
    expect(
      emitTable(defineTable("d", { id: s.string(), x: s.string().$unique() })),
    ).toContain("DEFINE INDEX d_x_idx ON TABLE d FIELDS x UNIQUE;");
  });
});

describe("field $fulltext / $hnsw / $diskann (single-field special indexes)", () => {
  test("$fulltext({…}) emits FULLTEXT; bm25:true is a bare BM25", () => {
    const ddl = emitTable(
      defineTable("doc", {
        id: s.string(),
        body: s
          .string()
          .$fulltext({ analyzer: "eng", bm25: true, highlights: true }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX doc_body_idx ON TABLE doc FIELDS body FULLTEXT ANALYZER eng BM25 HIGHLIGHTS;",
    );
  });

  test("$fulltext() overload: bare string, AnalyzerDef, and { analyzer } object are equivalent", () => {
    const eng = defineAnalyzer("eng", { tokenizers: ["blank"] });
    const fromString = emitTable(
      defineTable("o", { id: s.string(), body: s.string().$fulltext("eng") }),
    );
    const fromDef = emitTable(
      defineTable("o", { id: s.string(), body: s.string().$fulltext(eng) }),
    );
    const fromObject = emitTable(
      defineTable("o", {
        id: s.string(),
        body: s.string().$fulltext({ analyzer: eng }),
      }),
    );
    expect(fromString).toContain(
      "DEFINE INDEX o_body_idx ON TABLE o FIELDS body FULLTEXT ANALYZER eng;",
    );
    expect(fromDef).toBe(fromString);
    expect(fromObject).toBe(fromString);
  });

  test("$fulltext() analyzer is optional — bare FULLTEXT (SurrealDB injects `like`)", () => {
    const noArg = emitTable(
      defineTable("o", { id: s.string(), body: s.string().$fulltext() }),
    );
    expect(noArg).toContain(
      "DEFINE INDEX o_body_idx ON TABLE o FIELDS body FULLTEXT;",
    );
    expect(noArg).not.toContain("ANALYZER");
    // object without analyzer + table-level { fulltext: {} } emit the same bare FULLTEXT.
    const objNoAnalyzer = emitTable(
      defineTable("o", {
        id: s.string(),
        body: s.string().$fulltext({ highlights: true }),
      }),
    );
    expect(objNoAnalyzer).toContain(
      "DEFINE INDEX o_body_idx ON TABLE o FIELDS body FULLTEXT HIGHLIGHTS;",
    );
    const tableLevel = emitTable(
      defineTable("d2", { id: s.string(), body: s.string() }).index(
        "ft",
        ["body"],
        { fulltext: {} },
      ),
    );
    expect(tableLevel).toContain(
      "DEFINE INDEX ft ON TABLE d2 FIELDS body FULLTEXT;",
    );
  });

  test("$fulltext() bm25 as [k1,b] tunes the scoring; omitted bm25 drops it", () => {
    const tuned = emitTable(
      defineTable("d2", {
        id: s.string(),
        body: s.string().$fulltext({ analyzer: "eng", bm25: [1.5, 0.8] }),
      }),
    );
    expect(tuned).toContain(
      "DEFINE INDEX d2_body_idx ON TABLE d2 FIELDS body FULLTEXT ANALYZER eng BM25(1.5,0.8);",
    );
    const plain = emitTable(
      defineTable("d3", { id: s.string(), body: s.string().$fulltext("eng") }),
    );
    expect(plain).toContain(
      "DEFINE INDEX d3_body_idx ON TABLE d3 FIELDS body FULLTEXT ANALYZER eng;",
    );
    expect(plain).not.toContain("BM25");
  });

  test("$hnsw() / $diskann() emit vector indexes; a custom name overrides the derived one", () => {
    const hnsw = emitTable(
      defineTable("vh", {
        id: s.string(),
        emb: s.array(s.float()).$hnsw({ dimension: 4, dist: "cosine" }),
      }),
    );
    expect(hnsw).toContain(
      "DEFINE INDEX vh_emb_idx ON TABLE vh FIELDS emb HNSW DIMENSION 4 DIST COSINE;",
    );
    const diskann = emitTable(
      defineTable("vd", {
        id: s.string(),
        emb: s.array(s.float()).$diskann({ dimension: 8, name: "vec_dk" }),
      }),
    );
    expect(diskann).toContain(
      "DEFINE INDEX vec_dk ON TABLE vd FIELDS emb DISKANN DIMENSION 8;",
    );
    expect(diskann).not.toContain("vd_emb_idx");
  });
});

describe("table.index() renameable field-ref callback", () => {
  test('(t) => [t.a, t.b] emits identically to the ["a","b"] string array', () => {
    const cb = emitTable(
      defineTable("p", { id: s.string(), a: s.string(), b: s.string() })
        .index("ab", (t) => [t.a, t.b])
        .index("uq", (t) => [t.a], { unique: true }),
    );
    const str = emitTable(
      defineTable("p", { id: s.string(), a: s.string(), b: s.string() })
        .index("ab", ["a", "b"])
        .index("uq", ["a"], { unique: true }),
    );
    expect(cb).toBe(str);
    expect(cb).toContain("DEFINE INDEX ab ON TABLE p FIELDS a, b;");
    expect(cb).toContain("DEFINE INDEX uq ON TABLE p FIELDS a UNIQUE;");
  });

  test("the callback's t.<field> values are the field names", () => {
    // Same accessor the LSP renames; at runtime each ref resolves to its own name.
    defineTable("p", { id: s.string(), a: s.string(), b: s.string() }).index(
      "ab",
      (t) => {
        expect(t.a).toBe("a");
        expect(t.b).toBe("b");
        return [t.a, t.b];
      },
    );
  });
});

describe("defineView(name, shape?).as(query)", () => {
  test("a typed view's shape drives decode but emits NO DEFINE FIELD", () => {
    const V = defineView("v", {
      id: s.string(),
      name: s.string(),
      n: s.number(),
    }).as(surql`SELECT name, n FROM t`);
    // The shape is type-only: emit is just the AS SELECT head, no fields.
    expect(emitTable(V)).toBe(
      "DEFINE TABLE v TYPE ANY SCHEMALESS AS SELECT name, n FROM t;",
    );
    expect(emitTable(V)).not.toContain("DEFINE FIELD");
    // ...but the shape types + decodes the projected rows.
    const row = V.decode({ id: new RecordId("v", "x"), name: "Ada", n: 3 });
    expect(row.name).toBe("Ada");
    expect(row.n).toBe(3);
  });

  test("a shapeless view still emits AS SELECT and chains table config", () => {
    const V = defineView("raw")
      .as(surql`SELECT * FROM person`)
      .comment("all people");
    const head = emitTable(V).split("\n")[0];
    expect(head).toContain("TYPE ANY SCHEMALESS AS SELECT * FROM person");
    expect(head).toContain('COMMENT "all people"');
  });
});
