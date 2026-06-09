import type { DefineStatement } from "surreal-zod";
import { escapeIdent, type Surreal } from "surrealdb";
import type { Snapshot } from "./meta";

/**
 * Typed views of `INFO FOR … STRUCTURE` (SurrealDB 3.x). Unlike plain `INFO FOR …` (which
 * returns DDL strings that have to be regex-parsed), STRUCTURE returns the schema as data — so
 * names, clauses, flags, and permissions arrive pre-separated. Only `kind` stays a type
 * expression (`object | none`, `array<record<user>>`, `'a' | 'b'`), parsed by `szType`.
 */

/** A permission op's rule: `true` (FULL) / `false` (NONE) / a WHERE expression string. */
export type StructPerm = boolean | string;

export interface StructPermissions {
  select?: StructPerm;
  create?: StructPerm;
  update?: StructPerm;
  delete?: StructPerm;
}

export interface StructField {
  /** Field path, e.g. `email`, `address.city`, `tags.*` — bare (no backtick escaping). */
  name: string;
  /** The SurrealQL type expression (kind), e.g. `string`, `option<int>`, `array<string>`. */
  kind: string;
  flexible?: boolean;
  readonly?: boolean;
  default?: string;
  default_always?: boolean;
  value?: string;
  /** `COMPUTED <expr>` — a derived, read-only column. */
  computed?: string;
  assert?: string;
  comment?: string;
  reference?: unknown;
  permissions?: StructPermissions;
  table: string;
}

export interface StructIndex {
  name: string;
  /** Indexed columns/fields. */
  cols: string[];
  /** `"UNIQUE"`, `""` (plain), or a `SEARCH …`/`MTREE …`/`HNSW …` spec. */
  index: string;
}

export interface StructEvent {
  name: string;
  /** Owning table (STRUCTURE calls it `what`). */
  what: string;
  /** The `WHEN` condition. SurrealDB stores an omitted `WHEN` as the literal `"true"`. */
  when?: string;
  /** One or more `THEN` expressions (parens/`;` already stripped). */
  then: string[];
}

export interface StructFunction {
  name: string;
  /** Ordered `[argName, surqlType]` pairs. */
  args: [string, string][];
  /** The body block, e.g. `{ RETURN $a + $b }`. */
  block: string;
  /** Declared return type, if any. */
  returns?: string;
  /** Execute permission: `true` (FULL, the default) / `false` (NONE) / a WHERE expression. */
  permissions?: boolean | string;
  comment?: string;
}

export interface StructAccess {
  name: string;
  kind: {
    kind: string; // "RECORD" | "JWT" | "BEARER"
    /** BEARER: `"RECORD"` | `"USER"`. */
    subject?: string;
    /** RECORD bodies. */
    signup?: string;
    signin?: string;
    authenticate?: string;
    /** JWT/BEARER token config. The `key` is REDACTED by SurrealDB; `alg`/`url` are not. */
    jwt?: {
      issuer?: { alg?: string; key?: string };
      verify?: { alg?: string; key?: string; url?: string };
    };
  };
  duration?: { grant?: string; token?: string; session?: string };
}

export interface StructTableKind {
  kind: "NORMAL" | "ANY" | "RELATION";
  in?: string[];
  out?: string[];
  enforced?: boolean;
}

export interface StructTable {
  name: string;
  kind: StructTableKind;
  schemafull: boolean;
  drop?: boolean;
  comment?: string;
  /** `CHANGEFEED <expiry> [INCLUDE ORIGINAL]`. */
  changefeed?: { expiry: string; original: boolean };
  permissions?: StructPermissions;
  fields: StructField[];
  indexes: StructIndex[];
  events: StructEvent[];
}

interface DbStructure {
  tables?: (Omit<StructTable, "fields" | "indexes" | "kind"> & {
    kind: { kind: StructTableKind["kind"]; in?: unknown[]; out?: unknown[] };
    id?: number;
  })[];
  functions?: StructFunction[];
  accesses?: StructAccess[];
}

/** The structured database: tables (with their fields/indexes/events) and db-level functions/access. */
export interface DbStructured {
  tables: StructTable[];
  functions: StructFunction[];
  accesses: StructAccess[];
}
interface TableStructure {
  fields?: StructField[];
  indexes?: StructIndex[];
  events?: StructEvent[];
}

/** The unescaped name of a relation endpoint — the SDK deserializes `in`/`out` as `Table` objects. */
function endpointName(v: unknown): string {
  if (typeof v === "string") return v;
  const name = (v as { name?: unknown })?.name;
  return typeof name === "string" ? name : String(v);
}

// --- Canonical DDL ----------------------------------------------------------------------------
// Build a deterministic DDL string per object from the structured data, so two semantically-equal
// schemas compare equal regardless of how SurrealDB happened to format/order them. Both sides of
// `diff --live` (the live DB and the shadow-applied schema) go through this same builder.

/** Split a type expression on its top-level `|` (ignoring `|` inside `<…>`). */
function splitTopUnion(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of expr) {
    if (c === "<") depth++;
    else if (c === ">") depth--;
    if (c === "|" && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Canonical form of a type `kind`: fold a top-level `none` member into `option<…>` and sort the
 * remaining union members, so `object | none` / `none | object` / `option<object>` all collapse
 * to the same string (the union-ordering false-diff fix, done structurally).
 */
function canonicalKind(kind: string): string {
  const parts = splitTopUnion(kind).map((p) => p.trim());
  if (parts.length <= 1) return kind.trim();
  const hasNone = parts.includes("none");
  const rest = parts.filter((p) => p !== "none");
  if (hasNone) {
    if (!rest.length) return "none";
    const inner = rest.length === 1 ? rest[0] : [...rest].sort().join(" | ");
    return `option<${inner}>`;
  }
  return [...parts].sort().join(" | ");
}

/** Canonical `PERMISSIONS …` clause from structured perms (`""` when none apply). */
function canonicalPerms(
  perms: StructPermissions | undefined,
  ops: (keyof StructPermissions)[],
): string {
  if (!perms) return "";
  const vals = ops.map((op) => perms[op]);
  if (vals.every((v) => v === true)) return "PERMISSIONS FULL";
  if (vals.every((v) => v === false || v === undefined))
    return "PERMISSIONS NONE";
  const clauses = ops.map((op) => {
    const v = perms[op];
    if (v === true) return `FOR ${op} FULL`;
    if (v === false || v === undefined) return `FOR ${op} NONE`;
    return `FOR ${op} WHERE ${v}`;
  });
  return `PERMISSIONS ${clauses.join(" ")}`;
}

/** Canonical `DEFINE FIELD …`. The name is taken as-is (STRUCTURE already escapes reserved words). */
function canonicalField(f: StructField): string {
  const parts = [
    `DEFINE FIELD ${f.name} ON ${f.table} TYPE ${canonicalKind(f.kind)}`,
  ];
  if (f.flexible) parts.push("FLEXIBLE");
  if (f.default !== undefined)
    parts.push(`DEFAULT ${f.default_always ? "ALWAYS " : ""}${f.default}`);
  if (f.value !== undefined) parts.push(`VALUE ${f.value}`);
  if (f.computed !== undefined) parts.push(`COMPUTED ${f.computed}`);
  if (f.assert !== undefined) parts.push(`ASSERT ${f.assert}`);
  if (f.readonly) parts.push("READONLY");
  if (f.comment !== undefined)
    parts.push(`COMMENT ${JSON.stringify(f.comment)}`);
  const perms = canonicalPerms(f.permissions, ["select", "create", "update"]);
  if (perms) parts.push(perms);
  return `${parts.join(" ")};`;
}

/** Canonical `DEFINE TABLE …` head. */
function canonicalTableHead(t: StructTable): string {
  const k = t.kind;
  let type: string;
  if (k.kind === "RELATION") {
    // Endpoints optional — omit IN/OUT when unrestricted (matches `emit`).
    type = "RELATION";
    if (k.in?.length) type += ` IN ${k.in.join(" | ")}`;
    if (k.out?.length) type += ` OUT ${k.out.join(" | ")}`;
  } else {
    type = k.kind;
  }
  const parts = [
    `DEFINE TABLE ${t.name} TYPE ${type}`,
    t.schemafull ? "SCHEMAFULL" : "SCHEMALESS",
  ];
  if (t.drop) parts.push("DROP");
  if (t.changefeed) {
    parts.push(`CHANGEFEED ${t.changefeed.expiry}`);
    if (t.changefeed.original) parts.push("INCLUDE ORIGINAL");
  }
  if (t.comment !== undefined)
    parts.push(`COMMENT ${JSON.stringify(t.comment)}`);
  const perms = canonicalPerms(t.permissions, [
    "select",
    "create",
    "update",
    "delete",
  ]);
  if (perms) parts.push(perms);
  return `${parts.join(" ")};`;
}

/** Canonical `DEFINE INDEX …` (`index` is `"UNIQUE"`, `""`, or a `SEARCH …`/`MTREE …` spec). */
function canonicalIndex(t: StructTable, idx: StructIndex): string {
  // A COUNT index has no columns → no `FIELDS` clause (`idx.index` carries `COUNT`).
  const fields = idx.cols.length ? ` FIELDS ${idx.cols.join(", ")}` : "";
  const spec = idx.index ? ` ${idx.index}` : "";
  return `DEFINE INDEX ${idx.name} ON ${t.name}${fields}${spec};`;
}

/**
 * Canonical `DEFINE EVENT …`. An omitted `WHEN` (stored by SurrealDB as `"true"`) is dropped, and
 * the `then` expressions are comma-joined — so an event authored with/without a `WHEN true` and any
 * `THEN` formatting compares equal across the live DB and the shadow-applied schema.
 */
function canonicalEvent(t: StructTable, ev: StructEvent): string {
  const parts = [`DEFINE EVENT ${ev.name} ON ${t.name}`];
  if (ev.when !== undefined && ev.when !== "true")
    parts.push(`WHEN ${ev.when}`);
  parts.push(`THEN ${ev.then.join(", ")}`);
  return `${parts.join(" ")};`;
}

/**
 * Canonical `DEFINE FUNCTION …`. The `block` is taken verbatim (already `{ … }`); a `true`
 * (FULL — SurrealDB's default) permission is dropped so an unspecified `PERMISSIONS` compares equal
 * across the live DB and the shadow-applied schema.
 */
function canonicalFunction(fn: StructFunction): string {
  const args = fn.args.map(([n, t]) => `$${n}: ${t}`).join(", ");
  const parts = [`DEFINE FUNCTION fn::${fn.name}(${args})`];
  if (fn.returns !== undefined) parts.push(`-> ${fn.returns}`);
  parts.push(fn.block);
  if (fn.permissions === false) parts.push("PERMISSIONS NONE");
  else if (typeof fn.permissions === "string")
    parts.push(`PERMISSIONS ${fn.permissions}`);
  if (fn.comment !== undefined)
    parts.push(`COMMENT ${JSON.stringify(fn.comment)}`);
  return `${parts.join(" ")};`;
}

/**
 * Canonical `DEFINE ACCESS …`. The signing KEY is INTENTIONALLY ignored — SurrealDB redacts it
 * identically on both diff sides, so comparing it is meaningless (key changes go undetected by
 * `diff --live`; documented). The JWT `alg`/`url` are kept (not redacted). Always `ON DATABASE`.
 */
function canonicalAccess(a: StructAccess): string {
  const k = a.kind;
  let typeClause: string;
  if (k.kind === "BEARER") {
    typeClause = `TYPE BEARER FOR ${k.subject}`;
  } else if (k.kind === "JWT") {
    const v = k.jwt?.verify;
    typeClause = v?.url
      ? `TYPE JWT URL ${JSON.stringify(v.url)}`
      : `TYPE JWT ALGORITHM ${v?.alg ?? ""}`; // KEY omitted (redacted)
  } else {
    typeClause = "TYPE RECORD";
  }
  const parts = [`DEFINE ACCESS ${a.name} ON DATABASE ${typeClause}`];
  if (k.kind === "RECORD") {
    if (k.signup) parts.push(`SIGNUP ${k.signup}`);
    if (k.signin) parts.push(`SIGNIN ${k.signin}`);
    if (k.authenticate) parts.push(`AUTHENTICATE ${k.authenticate}`);
  }
  const d = a.duration;
  if (d?.grant || d?.token || d?.session) {
    const fors: string[] = [];
    if (d.grant) fors.push(`FOR GRANT ${d.grant}`);
    if (d.token) fors.push(`FOR TOKEN ${d.token}`);
    if (d.session) fors.push(`FOR SESSION ${d.session}`);
    parts.push(`DURATION ${fors.join(", ")}`);
  }
  return `${parts.join(" ")};`;
}

/**
 * Fold an array element type into a BARE `array`/`set` kind, so a field stored as `array` with an
 * `array.* TYPE object` element compares equal to `array<object>` (the typed form surreal-zod
 * emits). Typed kinds (`array<X>`) and the `.*` itself are left alone — the element is in the type.
 */
function foldArrayElement(kind: string, elementKind: string): string {
  const elem = canonicalKind(elementKind);
  // Replace a bare `array`/`set` (not already followed by `<…>`) — handles `option<array>` too.
  return kind.replace(/\b(array|set)\b(?!<)/, (kw) => `${kw}<${elem}>`);
}

/** True if every listed permission op is FULL (`true`) or unset — i.e. the default. */
function isFullPerms(
  perms: StructPermissions | undefined,
  ops: (keyof StructPermissions)[],
): boolean {
  if (!perms) return true;
  return ops.every((op) => perms[op] === undefined || perms[op] === true);
}

/**
 * An array element (`x.*`) is "trivial" when it's exactly the form SurrealDB auto-creates from
 * `array<…>` — a plain element with default permissions and no other clause. Trivial elements are
 * folded into the parent type and not emitted; a CUSTOMIZED element (FLEXIBLE / permissions /
 * readonly / default / value / assert / comment) is kept so its config isn't silently lost.
 */
function isTrivialElement(f: StructField): boolean {
  return (
    !f.flexible &&
    !f.readonly &&
    f.default === undefined &&
    f.value === undefined &&
    f.assert === undefined &&
    f.comment === undefined &&
    isFullPerms(f.permissions, ["select", "create", "update"])
  );
}

const keyOf = (s: Pick<DefineStatement, "kind" | "name" | "table">) =>
  `${s.kind}:${s.table ?? ""}:${s.name}`;

/**
 * Build a canonical-DDL {@link Snapshot} from the structured database (tables + db-level functions).
 * Skips implicit `id` (and `in`/`out` on relations) and childless `*` array-element fields —
 * surreal-zod's emit doesn't produce them, so the snapshot must not either (else diff would
 * try to drop/add them).
 */
export function structuredSnapshot({
  tables,
  functions,
  accesses,
}: DbStructured): Snapshot {
  const statements: Record<string, DefineStatement> = {};
  for (const t of tables) {
    const tableStmt: DefineStatement = {
      kind: "table",
      name: t.name,
      ddl: canonicalTableHead(t),
    };
    statements[keyOf(tableStmt)] = tableStmt;

    const implicit =
      t.kind.kind === "RELATION"
        ? new Set(["id", "in", "out"])
        : new Set(["id"]);
    // A trivial array element (`x.*`) is folded into the parent's `array<…>` type and not emitted
    // (so bare `array` + `x.* object` == typed `array<object>`). A CUSTOMIZED element (FLEXIBLE /
    // permissions / …) is kept so its config isn't lost. Map/record `.*` values are kept too.
    const byName = new Map(t.fields.map((f) => [f.name, f]));
    const elementOf = new Map<string, StructField>();
    for (const f of t.fields)
      if (f.name.endsWith(".*")) elementOf.set(f.name.slice(0, -2), f);

    for (const f of t.fields) {
      if (implicit.has(f.name)) continue;
      if (f.name.endsWith(".*")) {
        const parent = byName.get(f.name.slice(0, -2));
        const parentIsArray = parent
          ? /\b(?:array|set)\b/.test(parent.kind)
          : false;
        if (parentIsArray && isTrivialElement(f)) continue; // auto-created form → folded
      }
      const elem = elementOf.get(f.name);
      const field = elem
        ? { ...f, kind: foldArrayElement(f.kind, elem.kind) }
        : f;
      const s: DefineStatement = {
        kind: "field",
        name: f.name,
        table: t.name,
        ddl: canonicalField(field),
      };
      statements[keyOf(s)] = s;
    }
    for (const idx of t.indexes) {
      const s: DefineStatement = {
        kind: "index",
        name: idx.name,
        table: t.name,
        ddl: canonicalIndex(t, idx),
      };
      statements[keyOf(s)] = s;
    }
    for (const ev of t.events) {
      const s: DefineStatement = {
        kind: "event",
        name: ev.name,
        table: t.name,
        ddl: canonicalEvent(t, ev),
      };
      statements[keyOf(s)] = s;
    }
  }
  for (const fn of functions) {
    const s: DefineStatement = {
      kind: "function",
      name: fn.name,
      ddl: canonicalFunction(fn),
    };
    statements[keyOf(s)] = s;
  }
  for (const a of accesses) {
    const s: DefineStatement = {
      kind: "access",
      name: a.name,
      ddl: canonicalAccess(a),
    };
    statements[keyOf(s)] = s;
  }
  return { version: 1, statements };
}

/**
 * Read the live database structure via `INFO FOR DB STRUCTURE` (table heads + db-level functions)
 * plus one `INFO FOR TABLE … STRUCTURE` per table (its fields/indexes/events), skipping `exclude`d
 * tables. Functions are db-level and not excludable.
 */
export async function introspectStructured(
  db: Surreal,
  exclude: Set<string> = new Set(),
): Promise<DbStructured> {
  const [dbInfo] = await db.query<[DbStructure]>("INFO FOR DB STRUCTURE");
  const tables: StructTable[] = [];
  for (const t of dbInfo.tables ?? []) {
    if (exclude.has(t.name)) continue;
    const [tinfo] = await db.query<[TableStructure]>(
      `INFO FOR TABLE ${escapeIdent(t.name)} STRUCTURE`,
    );
    tables.push({
      name: t.name,
      kind: {
        kind: t.kind.kind,
        in: t.kind.in?.map(endpointName),
        out: t.kind.out?.map(endpointName),
      },
      schemafull: t.schemafull,
      drop: t.drop,
      comment: t.comment,
      changefeed: t.changefeed,
      permissions: t.permissions,
      fields: tinfo.fields ?? [],
      indexes: tinfo.indexes ?? [],
      events: tinfo.events ?? [],
    });
  }
  return {
    tables,
    functions: dbInfo.functions ?? [],
    accesses: dbInfo.accesses ?? [],
  };
}
