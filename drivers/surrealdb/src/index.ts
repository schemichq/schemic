/**
 * @schemic/surrealdb — author SurrealDB schemas with Zod.
 *
 * The **authoring** surface and nothing else: define tables/relations with `s.*` (a drop-in for `z.*`)
 * and map JS <-> DB across Zod's two channels via codecs (`decode`/`encode`). This entry is
 * **side-effect-free** — importing it registers no driver and pulls in neither the DDL emit engine nor
 * the diff/migration engine, so `s.*` is safe in app bundles. The engine surfaces live in subpaths:
 *   - `@schemic/surrealdb/driver`     — the `Driver` impl + `emit*` + the `registerDriver` side-effect.
 *   - `@schemic/surrealdb/connection` — the `surrealConnection` factory + connection config types.
 *   - `@schemic/surrealdb/query`      — the opt-in typed query builder.
 */

import {
  type BoundQuery,
  escapeIdent,
  surql as sdkSurql,
  Table,
} from "surrealdb";
import { FunctionDef, RecordIdField, TableDef } from "./pure";

// --- the surql tag: EAGER marker resolution + fragment helpers ----------------------------------
// (Design: docs/proposals/typed-fragments.md. Schema references resolve to TEXT at template
// construction, so the output is always a PLAIN BoundQuery — it runs identically through db.query,
// the raw SDK, and the DDL emitter. No marker ever reaches the wire.)

/** A `$param.path` reference built via {@link surql.$} — splices as text (`$after.email`), never
 *  binds. This is what disambiguates a PARAM REF from a string LITERAL in helper arg positions. */
class ParamRef {
  constructor(readonly path: readonly string[]) {}
  /** The spliced text: `$after.email` (segments after the param name are escaped). */
  toText(): string {
    const [param, ...rest] = this.path;
    return `$${param}${rest.map((p) => `.${escapeIdent(p)}`).join("")}`;
  }
}

/** Resolve a known schema reference to its spliced TEXT, or `undefined` to bind it as a value. */
function markerText(v: unknown): string | undefined {
  if (v instanceof TableDef) return escapeIdent(v.name);
  if (v instanceof Table) return escapeIdent(v.name);
  if (v instanceof FunctionDef) return `fn::${v.name}`;
  if (v instanceof ParamRef) return v.toText();
  if (v instanceof RecordIdField && v.tables.length === 1)
    return escapeIdent(v.tables[0] as string);
  return undefined;
}

function surqlTag<R extends unknown[] = unknown[]>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BoundQuery<R> {
  // Fold marker values into the string parts; everything else binds via the SDK tag as before
  // (a nested BoundQuery composes natively).
  const parts: string[] = [strings[0] as string];
  const rest: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const text = markerText(values[i]);
    if (text !== undefined)
      parts[parts.length - 1] += text + (strings[i + 1] as string);
    else {
      rest.push(values[i]);
      parts.push(strings[i + 1] as string);
    }
  }
  const tsa = Object.assign(parts.slice(), {
    raw: parts.slice(),
  }) as unknown as TemplateStringsArray;
  return sdkSurql(tsa, ...rest) as BoundQuery<R>;
}

/** Build the `surql.$` proxy: each property access extends the path (`surql.$.after.email`). */
function paramProxy(path: readonly string[]): ParamRef {
  return new Proxy(new ParamRef(path), {
    get(target, key) {
      if (typeof key === "string" && !(key in target) && key !== "then")
        return paramProxy([...path, key]);
      return (target as unknown as Record<string | symbol, unknown>)[key];
    },
  });
}

/**
 * Author SurrealQL — the `s.*` authoring API takes these `BoundQuery` values everywhere a dynamic
 * expression is allowed (`$default`/`$value`/`$computed`/`$assert`, event `when`/`then`, function
 * bodies, permissions), and `db.query` runs them. The GENERIC types the RESULT — one tuple entry
 * per statement: `db.query(surql<[string[]]>\`RETURN ['a','b','c']\`)`.
 *
 * Schema references interpolate as typed, rename-safe TEXT (eager resolution — the output is a
 * plain BoundQuery): a `TableDef`/`Table` splices its escaped name, a `FunctionDef` splices
 * `fn::<name>`, `surql.$.<path>` splices a `$param.path` reference. Everything else binds as a
 * `$param` value; a nested `BoundQuery` composes.
 *
 * Helpers on the tag:
 *  - `surql.expr<T>\`…\`` — a TYPED fragment: an expression of type `T` is a one-statement query
 *    `[T]` (the `[T]` rule), so sinks like `where` can require `BoundQuery<[boolean]>`.
 *  - `surql.record(Table, idFrag)` — `type::record(<table>, <id>)` with a typed table ref.
 *  - `surql.table(Table)` — the escaped table name as a fragment.
 *  - `surql.$` — the param-path proxy (`surql.$.after.email` -> `$after.email`). UNTYPED here;
 *    typed variants come from slot callbacks (see the typed-fragments proposal).
 */
export const surql: typeof surqlTag & {
  /** A TYPED expression fragment — sugar for `surql<[T]>` (an expression of type `T` IS a
   *  one-statement query of type `[T]`). */
  expr: <T>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => BoundQuery<[T]>;
  /** `type::record(<table>, <id>)` — a record id built from a typed table ref + an id fragment. */
  record: (table: { name: string }, id: BoundQuery) => BoundQuery<[unknown]>;
  /** The escaped table name as a fragment. */
  table: (table: { name: string }) => BoundQuery<[unknown]>;
  /** The param-path proxy: `surql.$.after.email` splices `$after.email`. */
  $: Record<string, ParamRef & Record<string, ParamRef>>;
} = Object.assign(surqlTag, {
  expr: surqlTag as <T>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => BoundQuery<[T]>,
  record: (table: { name: string }, id: BoundQuery): BoundQuery<[unknown]> =>
    surqlTag`type::record(${new Table(table.name)}, ${id})`,
  table: (table: { name: string }): BoundQuery<[unknown]> =>
    surqlTag`${new Table(table.name)}`,
  $: paramProxy([]) as unknown as Record<
    string,
    ParamRef & Record<string, ParamRef>
  >,
});
// Secret references for `DEFINE ACCESS` keys — `.jwt({ key: env("JWT_SECRET") })`. Re-exported from
// core's SIDE-EFFECT-FREE authoring subpath (so this index stays side-effect-free); the value resolves
// at apply via a SecretProvider and is never in source or migration files.
export {
  env,
  isSecretRef,
  type SecretRef,
  secret,
} from "@schemic/core/authoring";
export type { BoundQuery } from "surrealdb";
export type {
  AnalyzerConfig,
  App,
  AsymmetricJwtAlgorithm,
  CallArgs,
  Create,
  DiskannOptions,
  EventAsync,
  Expr,
  FieldRefs,
  Filter,
  FilterBuilder,
  FulltextFieldOptions,
  FulltextOptions,
  HnswOptions,
  JwtAlgorithm,
  JwtConfig,
  PresetColumnConflict,
  PresetEvent,
  PresetIndex,
  Shape,
  SnowballLanguage,
  StandaloneDef,
  SurrealMeta,
  SymmetricJwtAlgorithm,
  TableConfig,
  TableEvent,
  TableIndex,
  TablePreset,
  Tokenizer,
  Update,
  Wire,
} from "./pure";
export {
  AccessDef,
  AnalyzerDef,
  BearerAccessDef,
  DatabaseAccessDef,
  defineAccess,
  defineAnalyzer,
  defineEvent,
  defineFunction,
  defineRelation,
  defineTable,
  defineView,
  EventDef,
  FunctionDef,
  formatForAssert,
  JwtAccessDef,
  NamespaceAccessDef,
  objectFieldsRegistry,
  RecordAccessDef,
  RecordIdField,
  RelationDef,
  SField,
  SystemView,
  s,
  surrealTypeRegistry,
  TableDef,
  UnscopedAccessDef,
  ViewBuilder,
} from "./pure";
/** Type a `database/seed/*.ts` default export: `export default defineSeed(async (db, ctx) => { … })`. */
export { defineSeed, type SeedFn } from "./seed";
