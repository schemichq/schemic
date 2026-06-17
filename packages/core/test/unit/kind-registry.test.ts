// Slice 1 of core-v2 (docs/kind-registry.md): prove the generic kind registry + spine reproduce the
// fixed-slot engine's behavior, with NO driver dependency. A throwaway in-test "driver" registers
// THREE kinds against one KindRegistry — `table` (structured, field-level diff), `index` (owned,
// clustered after its table), and `function` (opaque/native) — and we assert:
//   - the builder passthrough keeps each kind's own DX (shape-based table, chained function);
//   - planKinds produces exactly the hand-written up/down DDL for add / change / remove (parity);
//   - field-level diff happens INSIDE the table kind's overwrite;
//   - cross-kind ordering is the dependency graph: an index follows its table, an FK child follows its
//     parent, and a function emits BEFORE the table whose event calls it (the case an ordinal gets
//     wrong) — exactly the ordering POC's proven output, now through the real planKinds;
//   - drops reverse the order; down recreates parent-first;
//   - introspect fans out across kinds off one connection.

import { describe, expect, test } from "bun:test";
import {
  buildKindDiff,
  emitKinds,
  introspectKinds,
  type KindEngine,
  KindRegistry,
  lowerSchema,
  orderObjects,
  planKinds,
  type PortableObject,
  type Ref,
  snapshotKinds,
  snapshotObjects,
} from "../../src/kind";

// --- a throwaway driver: three kinds on one registry --------------------------------------------

interface PField {
  name: string;
  type: string;
}
interface PTable {
  kind: "table";
  name: string;
  fields: PField[];
  deps: Ref[]; // FK parents / functions an event calls
}
interface PIndex {
  kind: "index";
  name: string;
  table: string;
  cols: string[];
}
interface PFunction {
  kind: "function";
  name: string;
  body: string;
}

const registry = new KindRegistry();

// kind 1 (ordinal 0): table — shape-based authoring, field-level diff in `overwrite`.
const tableEngine: KindEngine<PTable, PTable> = {
  lower: (t) => t,
  emit: (t) => [
    `DEFINE TABLE ${t.name}`,
    ...t.fields.map(
      (f) => `DEFINE FIELD ${f.name} ON ${t.name} TYPE ${f.type}`,
    ),
  ],
  remove: (t) => [`REMOVE TABLE ${t.name}`],
  overwrite: (prev, next) => {
    const before = new Map(prev.fields.map((f) => [f.name, f.type]));
    const after = new Map(next.fields.map((f) => [f.name, f.type]));
    const lines: string[] = [];
    for (const [n, t] of after)
      if (!before.has(n))
        lines.push(`DEFINE FIELD ${n} ON ${next.name} TYPE ${t}`);
      else if (before.get(n) !== t)
        lines.push(`ALTER FIELD ${n} ON ${next.name} TYPE ${t}`);
    for (const [n] of before)
      if (!after.has(n)) lines.push(`REMOVE FIELD ${n} ON ${next.name}`);
    return lines;
  },
  deps: (t) => t.deps,
};
const defineTable = registry.define({
  name: "table",
  build: (name: string, fields: PField[], opts?: { deps?: Ref[] }): PTable => ({
    kind: "table",
    name,
    fields,
    deps: opts?.deps ?? [],
  }),
  ...tableEngine,
});

// kind 2 (ordinal 1): index — owned by its table (clusters after it), depends on it.
const indexEngine: KindEngine<PIndex, PIndex> = {
  lower: (i) => i,
  emit: (i) => [
    `DEFINE INDEX ${i.name} ON ${i.table} FIELDS ${i.cols.join(", ")}`,
  ],
  remove: (i) => [`REMOVE INDEX ${i.name} ON ${i.table}`],
  deps: (i) => [{ kind: "table", name: i.table }],
  owner: (i) => ({ kind: "table", name: i.table }),
};
const defineIndex = registry.define({
  name: "index",
  build: (name: string, table: string, cols: string[]): PIndex => ({
    kind: "index",
    name,
    table,
    cols,
  }),
  ...indexEngine,
});

// kind 3 (ordinal 2): function — opaque/native, multi-stage chained authoring.
const functionEngine: KindEngine<PFunction, PFunction> = {
  lower: (f) => f,
  emit: (f) => [`DEFINE FUNCTION fn::${f.name} { ${f.body} }`],
  remove: (f) => [`REMOVE FUNCTION fn::${f.name}`],
  // no `overwrite` -> the spine recreates (remove + emit), the opaque-kind default.
};
const defineFunction = registry.define({
  name: "function",
  build: (name: string) => ({
    body: (sql: string): PFunction => ({ kind: "function", name, body: sql }),
  }),
  ...functionEngine,
});

// --- builder DX (the passthrough keeps each kind's own authoring shape) --------------------------

describe("createKind preserves each kind's authoring DX", () => {
  test("shape-based table builder returns a typed table def", () => {
    const user = defineTable("user", [{ name: "name", type: "string" }]);
    expect(user.kind).toBe("table");
    expect(user.name).toBe("user");
    expect(user.fields).toEqual([{ name: "name", type: "string" }]);
  });

  test("chained function builder threads through `.body(...)`", () => {
    const fmt = defineFunction("fmt").body("RETURN $v");
    expect(fmt).toEqual({ kind: "function", name: "fmt", body: "RETURN $v" });
  });
});

// --- parity: planKinds reproduces hand-written fixed-slot DDL ------------------------------------

describe("planKinds parity (add / change / remove)", () => {
  test("adding a field -> DEFINE up, REMOVE down (field-level diff in the table kind)", () => {
    const prev = [defineTable("user", [{ name: "name", type: "string" }])];
    const next = [
      defineTable("user", [
        { name: "name", type: "string" },
        { name: "age", type: "int" },
      ]),
    ];
    const { up, down } = planKinds(registry, prev, next);
    expect(up).toEqual(["DEFINE FIELD age ON user TYPE int"]);
    expect(down).toEqual(["REMOVE FIELD age ON user"]);
  });

  test("changing a field type -> ALTER both ways", () => {
    const prev = [defineTable("user", [{ name: "age", type: "int" }])];
    const next = [defineTable("user", [{ name: "age", type: "float" }])];
    const { up, down } = planKinds(registry, prev, next);
    expect(up).toEqual(["ALTER FIELD age ON user TYPE float"]);
    expect(down).toEqual(["ALTER FIELD age ON user TYPE int"]);
  });

  test("removing a table -> REMOVE up, full recreate down (table before its fields)", () => {
    const prev = [
      defineTable("user", [{ name: "name", type: "string" }]),
      defineTable("post", [{ name: "title", type: "string" }]),
    ];
    const next = [defineTable("user", [{ name: "name", type: "string" }])];
    const { up, down } = planKinds(registry, prev, next);
    expect(up).toEqual(["REMOVE TABLE post"]);
    expect(down).toEqual([
      "DEFINE TABLE post",
      "DEFINE FIELD title ON post TYPE string",
    ]);
  });

  test("an opaque function change recreates (remove + emit), no overwrite", () => {
    const prev = [defineFunction("fmt").body("RETURN 1")];
    const next = [defineFunction("fmt").body("RETURN 2")];
    const { up, down } = planKinds(registry, prev, next);
    expect(up).toEqual([
      "REMOVE FUNCTION fn::fmt",
      "DEFINE FUNCTION fn::fmt { RETURN 2 }",
    ]);
    expect(down).toEqual([
      "REMOVE FUNCTION fn::fmt",
      "DEFINE FUNCTION fn::fmt { RETURN 1 }",
    ]);
  });

  test("identical schemas plan to nothing", () => {
    const db = [
      defineTable("user", [{ name: "name", type: "string" }]),
      defineFunction("fmt").body("RETURN 1"),
    ];
    expect(planKinds(registry, db, db)).toEqual({ up: [], down: [] });
  });
});

// --- cross-kind ordering: the graph, not an ordinal ---------------------------------------------

const headers = (ddl: string[]) =>
  ddl.filter((l) => /^DEFINE (TABLE|INDEX|FUNCTION)/.test(l));

describe("cross-kind dependency ordering", () => {
  // The ordering POC's scenario, now driven through the real planKinds:
  //   user, user_email(idx), post(FK->user), post_author(idx), fmt(fn), audit(event calls fn::fmt)
  const schema = () => [
    defineTable("user", [{ name: "name", type: "string" }]),
    defineIndex("user_email", "user", ["name"]),
    defineTable("post", [{ name: "title", type: "string" }], {
      deps: [{ kind: "table", name: "user" }],
    }),
    defineIndex("post_author", "post", ["title"]),
    defineFunction("fmt").body("RETURN $v"),
    defineTable("audit", [{ name: "at", type: "string" }], {
      deps: [{ kind: "function", name: "fmt" }],
    }),
  ];

  test("emit order matches the proven layout (index after table, FK order, fn before its table)", () => {
    const up = emitKinds(registry, schema());
    expect(headers(up)).toEqual([
      "DEFINE TABLE user",
      "DEFINE INDEX user_email ON user FIELDS name",
      "DEFINE TABLE post",
      "DEFINE INDEX post_author ON post FIELDS title",
      "DEFINE FUNCTION fn::fmt { RETURN $v }",
      "DEFINE TABLE audit",
    ]);
  });

  test("dropping the whole schema reverses the order (children/FKs first, fn after its table)", () => {
    const { up } = planKinds(registry, schema(), []);
    expect(up.filter((l) => /^REMOVE (TABLE|INDEX|FUNCTION)/.test(l))).toEqual([
      "REMOVE TABLE audit",
      "REMOVE FUNCTION fn::fmt",
      "REMOVE INDEX post_author ON post",
      "REMOVE TABLE post",
      "REMOVE INDEX user_email ON user",
      "REMOVE TABLE user",
    ]);
  });

  test("a dependency cycle is a named error", () => {
    const a = defineTable("a", [], { deps: [{ kind: "table", name: "b" }] });
    const b = defineTable("b", [], { deps: [{ kind: "table", name: "a" }] });
    expect(() => planKinds(registry, [], [a, b])).toThrow(/cycle/);
  });
});

describe("orderObjects (the graph primitive in isolation)", () => {
  test("an external dep (object not in the set) is not a constraint", () => {
    const nodes = [
      { kind: "index", name: "i", deps: [{ kind: "table", name: "gone" }] },
    ];
    expect(orderObjects(nodes, () => 0).map((n) => n.name)).toEqual(["i"]);
  });
});

// --- introspect fan-out -------------------------------------------------------------------------

describe("introspectKinds fans out across kinds off one connection", () => {
  test("each introspectable kind contributes its objects; others are skipped", async () => {
    const reg = new KindRegistry();
    reg.define({
      name: "table",
      build: (name: string): PTable => ({
        kind: "table",
        name,
        fields: [],
        deps: [],
      }),
      lower: (t: PTable) => t,
      emit: () => [],
      remove: () => [],
      introspect: async () => [
        { kind: "table", name: "user", fields: [], deps: [] } as PTable,
      ],
    });
    reg.define({
      name: "function",
      build: (name: string): PFunction => ({
        kind: "function",
        name,
        body: "",
      }),
      lower: (f: PFunction) => f,
      emit: () => [],
      remove: () => [],
      // no `introspect` -> contributes nothing.
    });
    const found = await introspectKinds(reg, /* conn */ {});
    expect(found.map((o) => `${o.kind}:${o.name}`)).toEqual(["table:user"]);
  });
});

// --- lowering + snapshot round-trip -------------------------------------------------------------

describe("lowerSchema + snapshot", () => {
  test("lowerSchema runs each definable through its kind's engine", () => {
    const portable = lowerSchema(registry, [
      defineTable("user", [{ name: "name", type: "string" }]),
      defineFunction("fmt").body("RETURN 1"),
    ]);
    expect(portable.map((o) => `${o.kind}:${o.name}`)).toEqual([
      "table:user",
      "function:fmt",
    ]);
  });

  test("snapshot groups by kind and round-trips through JSON to a zero diff", () => {
    const portable = lowerSchema(registry, [
      defineTable("user", [{ name: "name", type: "string" }]),
      defineIndex("user_name", "user", ["name"]),
      defineFunction("fmt").body("RETURN 1"),
    ]);
    const snap = snapshotKinds(portable);
    expect(Object.keys(snap.kinds).sort()).toEqual([
      "function",
      "index",
      "table",
    ]);
    // Serialize -> parse -> flatten back; diffing the restored snapshot vs the live schema is empty.
    const restored = snapshotObjects(JSON.parse(JSON.stringify(snap)));
    expect(planKinds(registry, restored, portable)).toEqual({
      up: [],
      down: [],
    });
  });
});

// --- buildKindDiff (the full Diff the CLI consumes) ---------------------------------------------

describe("buildKindDiff produces up/down + display items + full", () => {
  const prev = lowerSchema(registry, [
    defineTable("user", [{ name: "name", type: "string" }]),
  ]);
  const next = lowerSchema(registry, [
    defineTable("user", [
      { name: "name", type: "string" },
      { name: "age", type: "int" },
    ]),
    defineFunction("fmt").body("RETURN 1"),
  ]);

  test("up/down match planKinds; a change item + an add item are reported", () => {
    const diff = buildKindDiff(registry, prev, next);
    expect({ up: diff.up, down: diff.down }).toEqual(
      planKinds(registry, prev, next),
    );
    // user changed (field added); fmt added.
    const items = diff.items ?? [];
    expect(items.find((i) => i.key === "table::user")?.op).toBe("change");
    expect(items.find((i) => i.key === "function::fmt")?.op).toBe("add");
  });

  test("`full` lists every desired object's DDL, ordered across kinds", () => {
    const full = buildKindDiff(registry, prev, next).full ?? [];
    expect(full.map((s) => s.key)).toEqual(["table::user", "function::fmt"]);
    expect(full[0].ddl).toContain("DEFINE TABLE user");
    expect(full[0].ddl).toContain("DEFINE FIELD age ON user TYPE int");
  });
});

// --- canonical change-detection hook (emit faithful, equality normalized) ------------------------

describe("KindEngine.canonical separates change-detection from faithful emit", () => {
  // A kind whose emit is FAITHFUL (carries a COMMENT the DB never introspects), but whose canonical
  // EXCLUDES it — so a comment-only delta, or a faithful-vs-introspected (comment-less) pair, is NOT a
  // phantom change. Mirrors postgres: DEFAULT/CHECK/COMMENT emit-faithful but dropped from equality.
  interface PDoc extends PortableObject {
    kind: "doc";
    name: string;
    body: string;
    comment?: string;
  }
  const reg = new KindRegistry();
  const defineDoc = reg.define({
    name: "doc",
    build: (name: string, body: string, comment?: string): PDoc => ({
      kind: "doc",
      name,
      body,
      ...(comment !== undefined ? { comment } : {}),
    }),
    lower: (d: PDoc) => d,
    // emit is FAITHFUL — includes the comment (create-time).
    emit: (d: PDoc) => [
      `DEFINE DOC ${d.name} BODY ${d.body}`,
      ...(d.comment !== undefined
        ? [`COMMENT ON DOC ${d.name} ${d.comment}`]
        : []),
    ],
    remove: (d: PDoc) => [`REMOVE DOC ${d.name}`],
    overwrite: (_p: PDoc, n: PDoc) => [`REDEFINE DOC ${n.name} BODY ${n.body}`],
    // canonical EXCLUDES the comment — it's create-time-only, never a change.
    canonical: (d: PDoc) => `DEFINE DOC ${d.name} BODY ${d.body}`,
  });

  test("a comment-only delta is NOT a change (faithful emit, normalized equality)", () => {
    const prev = [defineDoc("a", "x")];
    const next = [defineDoc("a", "x", "a note")];
    expect(planKinds(reg, prev, next)).toEqual({ up: [], down: [] });
  });

  test("introspected (comment-less) vs authored (commented) does not phantom-diff", () => {
    const authored = [defineDoc("a", "x", "a note")];
    const introspected = [defineDoc("a", "x")]; // DB never read the comment back
    expect(planKinds(reg, introspected, authored)).toEqual({
      up: [],
      down: [],
    });
  });

  test("a real body change IS detected (and emit stays faithful for a fresh apply)", () => {
    const prev = [defineDoc("a", "x", "a note")];
    const next = [defineDoc("a", "y", "a note")];
    expect(planKinds(reg, prev, next).up).toEqual(["REDEFINE DOC a BODY y"]);
    // fresh apply emits the comment (faithful), even though canonical ignores it.
    expect(emitKinds(reg, [defineDoc("a", "x", "a note")])).toEqual([
      "DEFINE DOC a BODY x",
      "COMMENT ON DOC a a note",
    ]);
  });
});

// --- displayItems: per-field display granularity (grouped under the table) -----------------------

describe("KindEngine.displayItems decomposes a change into per-field items", () => {
  interface PTbl extends PortableObject {
    kind: "tbl";
    name: string;
    cols: { name: string; type: string }[];
  }
  const reg = new KindRegistry();
  const defineTbl = reg.define({
    name: "tbl",
    build: (name: string, cols: { name: string; type: string }[]): PTbl => ({
      kind: "tbl",
      name,
      cols,
    }),
    lower: (t: PTbl) => t,
    emit: (t: PTbl) => [
      `DEFINE TABLE ${t.name}`,
      ...t.cols.map(
        (c) => `DEFINE FIELD ${c.name} ON ${t.name} TYPE ${c.type}`,
      ),
    ],
    remove: (t: PTbl) => [`REMOVE TABLE ${t.name}`],
    overwrite: (_p: PTbl, n: PTbl) => [`ALTER TABLE ${n.name}`],
    // per-FIELD display items, each carrying its owning table for hierarchical grouping.
    displayItems: (prev: PTbl | undefined, next: PTbl | undefined) => {
      const before = new Map((prev?.cols ?? []).map((c) => [c.name, c.type]));
      const after = new Map((next?.cols ?? []).map((c) => [c.name, c.type]));
      const table = (next ?? prev)?.name ?? "";
      const out: DiffItemLike[] = [];
      for (const [n, t] of after) {
        const b = before.get(n);
        const key = `field:${table}:${n}`;
        const ddl = `DEFINE FIELD ${n} ON ${table} TYPE ${t}`;
        if (b === undefined)
          out.push({ key, table, kind: "field", op: "add", ddl });
        else if (b !== t)
          out.push({
            key,
            table,
            kind: "field",
            op: "change",
            before: `DEFINE FIELD ${n} ON ${table} TYPE ${b}`,
            after: ddl,
          });
      }
      for (const [n, t] of before)
        if (!after.has(n))
          out.push({
            key: `field:${table}:${n}`,
            table,
            kind: "field",
            op: "remove",
            ddl: `REMOVE FIELD ${n} ON ${table}`,
            old: `DEFINE FIELD ${n} ON ${table} TYPE ${t}`,
          });
      return out;
    },
  });

  test("a field change yields a per-field item (grouped by table), not a whole-table item", () => {
    const prev = [defineTbl("user", [{ name: "name", type: "string" }])];
    const next = [defineTbl("user", [{ name: "name", type: "int" }])];
    const diff = buildKindDiff(reg, prev, next);
    expect(diff.items).toHaveLength(1);
    const it = (diff.items ?? [])[0];
    expect(it.key).toBe("field:user:name");
    expect(it.table).toBe("user"); // hierarchy: the field is grouped under its table
    expect(it.op).toBe("change");
    // up/down stay whole-object (the kind's overwrite), unaffected by display granularity.
    expect(diff.up).toEqual(["ALTER TABLE user"]);
  });

  test("`full` is per-field too (the displayItems(undefined, p) projection)", () => {
    const next = [
      defineTbl("user", [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
      ]),
    ];
    const full = buildKindDiff(reg, [], next).full ?? [];
    expect(full.map((s) => s.key)).toEqual([
      "field:user:id",
      "field:user:name",
    ]);
    expect(full[1].ddl).toBe("DEFINE FIELD name ON user TYPE string");
  });
});

// A loose shape mirroring core's DiffItem for the test's displayItems return (kept local + minimal).
type DiffItemLike = {
  key: string;
  table: string;
  kind: string;
} & (
  | { op: "add"; ddl: string }
  | { op: "remove"; ddl: string; old: string }
  | { op: "change"; before: string; after: string }
);
