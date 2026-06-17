// kind-registry.poc.ts — STANDALONE compiling spike (stubs the Schemic surface).
// Thesis: core can be a GENERIC "kinded-definable engine". Each driver registers KINDS via `createKind`
// — every kind brings its OWN authoring builder (any shape/chain, fully typed) + its engine behavior
// (lower/diff/emit). Core orchestrates generically over the registry — it never names "table"/"function".
// The shared FIELD/TYPE vocabulary (s.* / Field / PortableType) stays in core: the substrate every kind
// builds on (this is what keeps the Zod drop-in + cross-driver field model working).
//
// Proves the crux: two kinds with DIFFERENT ergonomics —
//   defineTable("user", { … })                    (shape-based, chainable modifiers)
//   defineFunction("greet", { … }).returns(…).body(…)   (multi-stage chain)
// — both via ONE `createKind`, both fully type-inferred on the authoring side, both driven by one
// generic `plan()` that has zero knowledge of either kind.
//
// Typecheck: bunx tsc --noEmit --strict --target esnext --moduleResolution bundler --skipLibCheck \
//   packages/core/docs/poc/kind-registry.poc.ts

/* ===== shared substrate (core) — the field/type vocabulary that stays NEUTRAL ===== */
declare const APP: unique symbol;
interface Field<A> {
  readonly [APP]: A;
}
type App<F> = F extends Field<infer A> ? A : never;
type PortableType =
  | { t: "string" }
  | { t: "int" }
  | { t: "bool" }
  | { t: "record"; table: string }
  | { t: "native"; driver: string; node: unknown };
declare class RecordId<T extends string> {
  private readonly __t: T;
}
declare const s: {
  string(): Field<string>;
  int(): Field<number>;
  bool(): Field<boolean>;
  record<T extends string>(t: T): Field<RecordId<T>>;
};
/** core: a field's portable type (the shared vocabulary kinds use for structured parts). */
declare function fieldType(f: Field<unknown>): PortableType;

/* ===== the KIND REGISTRY (core) ===== */

/** Every authored definable is tagged with its kind + name. Core dispatches by `kind`, nothing else. */
interface Authored {
  readonly kind: string;
  readonly name: string;
}
/** A kind's portable object — structured (uses PortableType) or opaque (native): the KIND's choice. */
interface PortableObject {
  readonly kind: string;
  readonly name: string;
}

/** What core needs to orchestrate a kind generically — it never inspects the specifics. */
interface KindEngine<A extends Authored, P extends PortableObject> {
  lower(authored: A): P;
  diff(prev: P | undefined, next: P | undefined): string[]; // this kind's diff → DDL
  emit(portable: P): string[]; // create DDL
  dependsOn?(portable: P): string[]; // names this object depends on (cross-kind ordering)
}

// biome-ignore lint/suspicious/noExplicitAny: the registry erases per-kind types (engine is structural).
const REGISTRY = new Map<string, KindEngine<any, any>>();

/**
 * Register a KIND. `build` is the driver's OWN authoring entry — ANY shape/chain — and its type flows
 * through unchanged, so type-safety + DX are the driver's to design. The engine fns give core the
 * generic behavior. Returns `build`, so a driver writes `export const defineX = createKind({ … })`.
 */
function createKind<
  Build extends (...args: never[]) => unknown,
  A extends Authored,
  P extends PortableObject,
>(spec: { name: string; build: Build } & KindEngine<A, P>): Build {
  REGISTRY.set(spec.name, spec);
  return spec.build;
}

/* ===== core orchestration — GENERIC over registered kinds (no "table"/"function" here) ===== */

function plan(prev: Authored[], next: Authored[]): string[] {
  const ddl: string[] = [];
  for (const [kind, engine] of REGISTRY) {
    const lower = (ds: Authored[]) =>
      ds.filter((d) => d.kind === kind).map((d) => engine.lower(d));
    const prevByName = new Map(lower(prev).map((p) => [p.name, p]));
    for (const n of lower(next)) ddl.push(...engine.diff(prevByName.get(n.name), n));
  }
  return ddl;
}

/* ===== DRIVER: kind #1 — `defineTable` (shape-based authoring, chainable modifier) ===== */

interface TableDef<Name extends string, S extends Record<string, Field<unknown>>>
  extends Authored {
  kind: "table";
  name: Name;
  fields: S;
  permissions(p: string): TableDef<Name, S>; // a chainable modifier
}
function tableBuild<Name extends string, S extends Record<string, Field<unknown>>>(
  name: Name,
  fields: S,
): TableDef<Name, S> {
  return {
    kind: "table",
    name,
    fields,
    permissions() {
      return this;
    },
  };
}
interface PortableTable extends PortableObject {
  kind: "table";
  cols: { name: string; type: PortableType }[];
}
export const defineTable = createKind({
  name: "table",
  build: tableBuild,
  lower: (t: TableDef<string, Record<string, Field<unknown>>>): PortableTable => ({
    kind: "table",
    name: t.name,
    cols: Object.entries(t.fields).map(([n, f]) => ({ name: n, type: fieldType(f) })),
  }),
  diff: (prev, next) =>
    next ? [`DEFINE TABLE ${next.name} (${next.cols.length} cols)`] : [],
  emit: (p) => [`DEFINE TABLE ${p.name}`],
});

/* ===== DRIVER: kind #2 — `defineFunction` (multi-stage CHAIN, totally different shape) ===== */

interface Surql {
  readonly __surql: unique symbol;
}
declare function surql(s: TemplateStringsArray, ...v: unknown[]): Surql;
type ArgRefs<A extends Record<string, Field<unknown>>> = {
  [K in keyof A]: App<A[K]>;
};
interface FnDef<A extends Record<string, Field<unknown>>, R extends Field<unknown>>
  extends Authored {
  kind: "function";
  name: string;
  __a?: A;
  __r?: R;
}
interface FnReturns<A extends Record<string, Field<unknown>>, R extends Field<unknown>> {
  body(make: (a: ArgRefs<A>) => Surql): FnDef<A, R>;
}
interface FnArgs<A extends Record<string, Field<unknown>>> {
  returns<R extends Field<unknown>>(r: R): FnReturns<A, R>;
}
function fnBuild<A extends Record<string, Field<unknown>>>(
  name: string,
  _args: A,
): FnArgs<A> {
  return {
    returns: <R extends Field<unknown>>(_r: R): FnReturns<A, R> => ({
      body: (_make) => ({ kind: "function", name }),
    }),
  };
}
interface PortableFn extends PortableObject {
  kind: "function";
}
export const defineFunction = createKind({
  name: "function",
  build: fnBuild,
  lower: (f: FnDef<Record<string, Field<unknown>>, Field<unknown>>): PortableFn => ({
    kind: "function",
    name: f.name,
  }),
  diff: (prev, next) => (next ? [`DEFINE FUNCTION fn::${next.name}`] : []),
  emit: (p) => [`DEFINE FUNCTION fn::${p.name}`],
});

/* ===== USAGE — both kinds, full inference, one generic engine ===== */

const User = defineTable("user", {
  id: s.record("user"),
  name: s.string(),
  age: s.int(),
}).permissions("full");
//    ^? TableDef<"user", { id: Field<RecordId<"user">>; name: Field<string>; age: Field<number> }>
const _name: App<(typeof User.fields)["name"]> = "ada"; // typed field access proves inference

const greet = defineFunction("greet", { who: s.string(), times: s.int() })
  .returns(s.string())
  .body(({ who, times }) => surql`RETURN string::repeat("hi " + ${who}, ${times})`);
//    ^? FnDef<{ who: Field<string>; times: Field<number> }, Field<string>>
//    the body callback args are typed: who: string, times: number

// core plans generically — it has NO idea what "table"/"function" are:
export const ddl = plan([], [User, greet]);
//    → ["DEFINE TABLE user (3 cols)", "DEFINE FUNCTION fn::greet"]

export { User, greet, _name };
