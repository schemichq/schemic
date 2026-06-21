// The Struct-IR lowering for the OFFLINE side: turn an in-memory @schemic/core `TableDef`/`RelationDef`
// (and standalone `defineFunction`/`defineAccess`/`defineEvent`) into the `Struct` IR, so it can be
// `normalize`d and structurally diffed against the live DB's `fromInfo` (introspectStructured). This
// is the inverse of `pull` and the keystone of the Struct-IR effort. See docs/STRUCT-IR.md.
//
// It reads the `TableDef`/`SField` directly (no DDL round-trip) and reuses the emitter's
// `inferField()` so the type strings and dotted field paths are identical by construction; clauses
// come straight off `SField.surreal` and `TableConfig`. The output is RAW (unsorted, defaults not
// stripped, `option<>` not folded, `x.*` elements present) — `normalizeTable` closes those gaps.

import { BoundQuery, escapeIdent } from "surrealdb";
import {
  assertExpr,
  braceBody,
  eventClause,
  type FieldInfo,
  fieldType,
  inferField,
  inline,
} from "../ddl";
import type {
  AccessDef,
  AnalyzerDef,
  FieldPermissions,
  FunctionDef,
  PermOp,
  SField,
  Shape,
  StandaloneDef,
  SurrealMeta,
  TableDef,
  TableEvent,
  TablePermissions,
} from "../pure";
import { normalizeDb } from "./struct";
import type {
  DbStructured,
  StructAccess,
  StructAnalyzer,
  StructEvent,
  StructField,
  StructFunction,
  StructIndex,
  StructPerm,
  StructPermissions,
  StructTable,
  StructTableKind,
} from "./structure";

const FIELD_PERM_OPS = ["select", "create", "update"] as const;
const TABLE_PERM_OPS = ["select", "create", "update", "delete"] as const;

/**
 * Lower a permissions spec to `StructPermissions` (per-op `true`/`false`/WHERE-expr string). A
 * blanket `true`/`false`/`BoundQuery` materializes every op; an object resolves each present op,
 * following `same as X` references (with cycle detection, mirroring `renderPermissions`) and
 * inlining a `BoundQuery` to its WHERE expression. Omitted ops are left unset — `normalize` reads
 * them as the kind default, so an unspecified op compares equal to the materialized default.
 */
function lowerPermissions(
  spec: TablePermissions | FieldPermissions,
  ops: readonly PermOp[],
): StructPermissions {
  const out: StructPermissions = {};
  if (spec === true) {
    for (const op of ops) out[op] = true;
    return out;
  }
  if (spec === false) {
    for (const op of ops) out[op] = false;
    return out;
  }
  if (spec instanceof BoundQuery) {
    const where = inline(spec);
    for (const op of ops) out[op] = where;
    return out;
  }

  const rules = spec as Partial<Record<PermOp, boolean | BoundQuery | string>>;
  const resolved = new Map<PermOp, StructPerm>();
  const resolve = (op: PermOp, chain: PermOp[]): StructPerm => {
    const cached = resolved.get(op);
    if (cached !== undefined) return cached;
    const rule = rules[op];
    if (rule === undefined) {
      throw new Error(
        `PERMISSIONS: "same as ${op}" references op "${op}", which is not in the spec`,
      );
    }
    if (chain.includes(op)) {
      throw new Error(
        `PERMISSIONS: "same as" reference cycle: ${[...chain, op].join(" -> ")}`,
      );
    }
    let value: StructPerm;
    if (typeof rule === "string") {
      value = resolve(rule.slice("same as ".length).trim() as PermOp, [
        ...chain,
        op,
      ]);
    } else if (rule instanceof BoundQuery) {
      value = inline(rule);
    } else {
      value = rule;
    }
    resolved.set(op, value);
    return value;
  };

  for (const op of ops) {
    if (rules[op] === undefined) continue;
    out[op] = resolve(op, []);
  }
  return out;
}

/** Lower a field `REFERENCE` to the IR's structured form: `{}` (bare) or `{ on_delete: <action> }`. */
function lowerReference(ref: NonNullable<SurrealMeta["reference"]>): {
  on_delete?: string;
} {
  if (ref === true || ref.onDelete === undefined) return {};
  const onDelete = ref.onDelete;
  return {
    on_delete:
      onDelete instanceof BoundQuery
        ? inline(onDelete)
        : onDelete.toUpperCase(),
  };
}

/**
 * Walk an `inferField` node into flattened dotted `StructField`s — exactly the paths the emitter
 * produces (`address`, `address.city`, `tags.*`). Unlike the emitter this keeps `option<>` (it does
 * NOT strip it for defaulted/valued/computed fields), and it EMITS the `x.*` element node (rather
 * than folding it) — `normalizeTable` does both folds. Single-field indexes (`.index()`/`.unique()`)
 * are collected into `indexes`.
 */
function lowerField(
  path: string,
  table: string,
  info: FieldInfo,
  surreal: SurrealMeta | undefined,
  fields: StructField[],
  indexes: StructIndex[],
): void {
  const sf: StructField = { name: path, kind: info.type, table };
  if (info.flexible) sf.flexible = true;
  if (surreal) {
    if (surreal.reference) sf.reference = lowerReference(surreal.reference);
    if (surreal.default) {
      sf.default = inline(surreal.default);
      if (surreal.defaultAlways) sf.default_always = true;
    }
    if (surreal.value) sf.value = inline(surreal.value);
    if (surreal.computed) sf.computed = inline(surreal.computed);
    const assert = assertExpr(surreal.asserts);
    if (assert) sf.assert = assert;
    if (surreal.readonly) sf.readonly = true;
    if (surreal.comment !== undefined) sf.comment = surreal.comment;
    // An internal field grants no record-user access (PERMISSIONS NONE) — it wins over `$permissions`.
    if (surreal.internal) {
      sf.permissions = { select: false, create: false, update: false };
    } else if (surreal.permissions !== undefined) {
      sf.permissions = lowerPermissions(surreal.permissions, FIELD_PERM_OPS);
    }
    if (surreal.index) {
      // Custom name if given, else the derived `<table>_<sanitized-path>_idx`.
      const idxName =
        surreal.index.name ??
        `${table}_${path.replace(/[`]/g, "").replace(/[^a-zA-Z0-9]+/g, "_")}_idx`;
      indexes.push({
        name: idxName,
        cols: [path],
        // FULLTEXT/HNSW/DISKANN spec (`.$fulltext()`/`.$hnsw()`/`.$diskann()`) or UNIQUE/plain.
        index: surreal.index.spec ?? (surreal.index.unique ? "UNIQUE" : ""),
      });
    }
  }
  fields.push(sf);

  for (const child of info.children) {
    lowerField(
      `${path}${child.suffix}`,
      table,
      child.info,
      child.surreal,
      fields,
      indexes,
    );
  }
}

/** Lower a table/relation event to a `StructEvent` (one or several `THEN` exprs, bare). */
function lowerEvent(table: string, ev: TableEvent): StructEvent {
  const thens = (Array.isArray(ev.then) ? ev.then : [ev.then]).map(eventClause);
  // biome-ignore lint/suspicious/noThenProperty: `then` mirrors SurrealQL's event THEN clause.
  const out: StructEvent = { name: ev.name, what: table, then: thens };
  if (ev.when !== undefined) out.when = eventClause(ev.when);
  return out;
}

/**
 * Lower an in-memory `TableDef`/`RelationDef` to the `Struct` IR. The result is raw — feed it
 * through `normalizeTable` before comparing. Skips the implicit `id` field (and `in`/`out` on a
 * relation); they are managed by SurrealDB and never emitted.
 */
export function fromTableDef(t: TableDef<string, Shape>): StructTable {
  const cfg = t.config;
  const rel = cfg.relation;
  const implicit = rel ? new Set(["id", "in", "out"]) : new Set(["id"]);

  const fields: StructField[] = [];
  const indexes: StructIndex[] = [];
  for (const [name, field] of Object.entries(t.fields)) {
    if (implicit.has(name)) continue;
    const f = field as SField;
    lowerField(
      escapeIdent(name),
      t.name,
      inferField(f.schema),
      f.surreal,
      fields,
      indexes,
    );
  }
  // Composite (multi-field) indexes — and the row-count index (no FIELDS).
  for (const idx of cfg.indexes ?? []) {
    indexes.push({
      name: idx.name,
      cols: idx.count ? [] : idx.fields.map(escapeIdent),
      index: idx.count ? "COUNT" : (idx.spec ?? (idx.unique ? "UNIQUE" : "")), // HNSW/DISKANN/FULLTEXT or UNIQUE/plain
      ...(idx.comment !== undefined ? { comment: idx.comment } : {}),
    });
  }

  let kind: StructTableKind;
  if (rel) {
    kind = { kind: "RELATION" };
    if (rel.from.length) kind.in = [...rel.from];
    if (rel.to.length) kind.out = [...rel.to];
    if (rel.enforced) kind.enforced = true;
  } else if (cfg.type === "any") {
    kind = { kind: "ANY" };
  } else {
    kind = { kind: "NORMAL" };
  }

  const out: StructTable = {
    name: t.name,
    kind,
    schemafull: cfg.schemafull,
    fields,
    indexes,
    events: (cfg.events ?? []).map((ev) => lowerEvent(t.name, ev)),
  };
  if (cfg.drop) out.drop = true;
  if (cfg.comment !== undefined) out.comment = cfg.comment;
  if (cfg.changefeed) {
    out.changefeed = {
      expiry: cfg.changefeed.expiry,
      original: !!cfg.changefeed.includeOriginal,
    };
  }
  if (cfg.permissions !== undefined) {
    out.permissions = lowerPermissions(cfg.permissions, TABLE_PERM_OPS);
  }
  // A pre-computed VIEW — the inlined `SELECT …` (without the `AS ` keyword; canonical adds it).
  if (cfg.view !== undefined) out.view = eventClause(cfg.view);
  return out;
}

/** Lower a `defineFunction` to a `StructFunction` (block wrapped as `{ … }` to match INFO). */
function lowerFunction(fn: FunctionDef): StructFunction {
  const args: [string, string][] = Object.entries(fn.args).map(([n, f]) => [
    n,
    fieldType(f),
  ]);
  const out: StructFunction = {
    name: fn.name,
    args,
    block: fn.config.body !== undefined ? braceBody(fn.config.body) : "{}",
  };
  if (fn.config.returns) out.returns = fieldType(fn.config.returns);
  const p = fn.config.permissions;
  if (p !== undefined)
    out.permissions = typeof p === "boolean" ? p : eventClause(p);
  if (fn.config.comment !== undefined) out.comment = fn.config.comment;
  return out;
}

/** Lower a `defineAccess` to a `StructAccess`. Signing keys are NOT carried (SurrealDB redacts them). */
function lowerAccess(a: AccessDef): StructAccess {
  const cfg = a.config;
  const k = cfg.kind;
  let kind: StructAccess["kind"];
  if (k.type === "bearer") {
    kind = {
      kind: "BEARER",
      subject: k.subject === "user" ? "USER" : "RECORD",
    };
  } else if (k.type === "jwt") {
    kind = {
      kind: "JWT",
      jwt: { verify: k.url ? { url: k.url } : { alg: k.alg ?? "HS512" } },
    };
  } else {
    kind = { kind: "RECORD" };
    if (cfg.signup) kind.signup = braceBody(cfg.signup);
    if (cfg.signin) kind.signin = braceBody(cfg.signin);
    if (cfg.authenticate) kind.authenticate = braceBody(cfg.authenticate);
  }

  const out: StructAccess = { name: a.name, kind };
  const d = cfg.duration;
  if (d && (d.grant || d.token || d.session)) {
    out.duration = {};
    if (d.grant) out.duration.grant = d.grant;
    if (d.token) out.duration.token = d.token;
    if (d.session) out.duration.session = d.session;
  }
  return out;
}

/** Lower a `defineAnalyzer` to a `StructAnalyzer` (tokenizers/filters uppercased to match INFO). */
function lowerAnalyzer(a: AnalyzerDef): StructAnalyzer {
  const out: StructAnalyzer = {
    name: a.name,
    tokenizers: a.config.tokenizers.map((t) => t.toUpperCase()),
  };
  if (a.config.filters?.length)
    out.filters = a.config.filters.map((f) => f.toUpperCase());
  return out;
}

/** Lower a standalone def (`defineFunction`/`defineAccess`/`defineEvent`/`defineAnalyzer`) to its `Struct` IR. */
export function fromStandalone(
  def: StandaloneDef,
): StructFunction | StructAccess | StructEvent | StructAnalyzer {
  // An `EventDef` already carries `name`/`when`/`then` — the `TableEvent` shape `lowerEvent` reads.
  if (def.kind === "event") return lowerEvent(def.table, def);
  if (def.kind === "function") return lowerFunction(def);
  if (def.kind === "analyzer") return lowerAnalyzer(def);
  return lowerAccess(def);
}

/**
 * The NORMALIZED Struct-IR for a whole loaded schema — the offline counterpart of `fromInfo`
 * (introspectStructured). Standalone events are attached to their owning table. Used to render the
 * schema as TypeScript (`diff --ts`) and stored in the snapshot.
 */
export function schemaStruct(
  tables: TableDef<string, Shape>[],
  defs: StandaloneDef[],
): DbStructured {
  const structTables = tables.map(fromTableDef);
  const byName = new Map(structTables.map((t) => [t.name, t]));
  const functions: StructFunction[] = [];
  const accesses: StructAccess[] = [];
  const analyzers: StructAnalyzer[] = [];
  for (const d of defs) {
    if (d.kind === "function")
      functions.push(fromStandalone(d) as StructFunction);
    else if (d.kind === "access")
      accesses.push(fromStandalone(d) as StructAccess);
    else if (d.kind === "analyzer")
      analyzers.push(fromStandalone(d) as StructAnalyzer);
    else if (d.kind === "event")
      byName.get(d.table)?.events.push(fromStandalone(d) as StructEvent);
  }
  return normalizeDb({ tables: structTables, functions, accesses, analyzers });
}
