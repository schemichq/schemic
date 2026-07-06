/**
 * The SurrealDB builtin-function CATALOG — one source for both typed surfaces:
 *
 *  - `surql.fn.<ns>.<name>(...)` — the context-free call tree (`surql.fn.string.len(x)`,
 *    `surql.fn.crypto.bcrypt.compare(a, b)`), every call a typed fragment (`Frag<R>` — the
 *    `[T]` rule: an expression of type `R` IS a one-statement query `[R]`).
 *  - `refMethods` — the per-kind stdlib families the query layer grafts onto field refs
 *    (`u.name.length()` -> `string::len(name)`, chainable because the result is a ref again).
 *
 * Arguments accept literals (BOUND as `$r<n>` params), field refs (spliced, `$parent`-aware),
 * `$param` refs (spliced as text), and fragments/builders (spliced with bindings merged).
 * Side-effect-free; imports only the render primitives — safe from the authoring index.
 */

import type { FieldRefBase } from "@schemic/core/query";
import type { BoundQuery } from "surrealdb";
import { Surql } from "./frag";
import type { ParamDef, ParamRef } from "./pure";
import { argRenderer, type Ctx, type RefKind } from "./query/render";

/** A typed expression fragment — the `[T]` rule (`Frag<T>` = a one-statement query of `T`).
 *  Catalog results are `Surql`, so every call carries `.as<T2>()` — retype where the true shape
 *  is caller-known: `surql.fn.http.post(...).as<{ id?: string }>()`. */
export type Frag<T> = Surql<[T]>;

/** What a builtin-call argument accepts: a literal `T` (bound as a param), a typed field ref
 *  (spliced), a `$param` ref (spliced as text), or a fragment/builder (spliced, binds merged). */
export type FnArg<T> =
  | T
  | ParamRef<T>
  | ParamDef<T>
  | FieldRefBase<T>
  | BoundQuery
  | { toQuery(): BoundQuery };

// --- the call lowering ----------------------------------------------------------------------------

function call(name: string, args: readonly unknown[]): Surql<[unknown]> {
  const ctx: Ctx = { vars: {} };
  const parts = args
    .filter((a) => a !== undefined)
    .map((a) => argRenderer(a)(ctx));
  return new Surql(`${name}(${parts.join(", ")})`, ctx.vars);
}

// Arity helpers — the catalog below stays one line per function. `o` = trailing optionals,
// `v` = variadic tail. All lower identically; arity lives in the signature.
const f0 =
  <R>(name: string) =>
  (): Frag<R> =>
    call(name, []) as Frag<R>;
const f1 =
  <A, R>(name: string) =>
  (a: FnArg<A>): Frag<R> =>
    call(name, [a]) as Frag<R>;
const f2 =
  <A, B, R>(name: string) =>
  (a: FnArg<A>, b: FnArg<B>): Frag<R> =>
    call(name, [a, b]) as Frag<R>;
const f3 =
  <A, B, C, R>(name: string) =>
  (a: FnArg<A>, b: FnArg<B>, c: FnArg<C>): Frag<R> =>
    call(name, [a, b, c]) as Frag<R>;
const f0o =
  <A, R>(name: string) =>
  (a?: FnArg<A>): Frag<R> =>
    call(name, [a]) as Frag<R>;
const f0oo =
  <A, B, R>(name: string) =>
  (a?: FnArg<A>, b?: FnArg<B>): Frag<R> =>
    call(name, [a, b]) as Frag<R>;
const f1o =
  <A, B, R>(name: string) =>
  (a: FnArg<A>, b?: FnArg<B>): Frag<R> =>
    call(name, [a, b]) as Frag<R>;
const f2o =
  <A, B, C, R>(name: string) =>
  (a: FnArg<A>, b: FnArg<B>, c?: FnArg<C>): Frag<R> =>
    call(name, [a, b, c]) as Frag<R>;
const fv =
  <T, R>(name: string) =>
  (...xs: FnArg<T>[]): Frag<R> =>
    call(name, xs) as Frag<R>;

type Json = unknown;
/** HTTP headers: a plain object whose VALUES may be fragments/refs (each splices), or a whole
 *  fragment/ref for the object itself. */
type HeadersArg = FnArg<Record<string, FnArg<string>>>;

// --- the catalog -----------------------------------------------------------------------------------

/**
 * The typed builtin tree behind `surql.fn` — SurrealDB's function library, one property path per
 * builtin (live-verified against 3.x in the test suite). Every call returns a typed fragment, so
 * results interpolate into `surql` templates, builder slots, and each other.
 */
export const fn = {
  /** `array::*` — list operations. */
  array: {
    append: f2<unknown[], unknown, unknown[]>("array::append"),
    at: f2<unknown[], number, unknown>("array::at"),
    combine: f2<unknown[], unknown[], unknown[]>("array::combine"),
    complement: f2<unknown[], unknown[], unknown[]>("array::complement"),
    concat: fv<unknown[], unknown[]>("array::concat"),
    difference: f2<unknown[], unknown[], unknown[]>("array::difference"),
    distinct: f1<unknown[], unknown[]>("array::distinct"),
    find_index: f2<unknown[], unknown, number>("array::find_index"),
    first: f1<unknown[], unknown>("array::first"),
    flatten: f1<unknown[], unknown[]>("array::flatten"),
    group: f1<unknown[], unknown[]>("array::group"),
    insert: f3<unknown[], unknown, number, unknown[]>("array::insert"),
    intersect: f2<unknown[], unknown[], unknown[]>("array::intersect"),
    is_empty: f1<unknown[], boolean>("array::is_empty"),
    join: f2<unknown[], string, string>("array::join"),
    last: f1<unknown[], unknown>("array::last"),
    len: f1<unknown[], number>("array::len"),
    max: f1<unknown[], unknown>("array::max"),
    min: f1<unknown[], unknown>("array::min"),
    pop: f1<unknown[], unknown>("array::pop"),
    prepend: f2<unknown[], unknown, unknown[]>("array::prepend"),
    push: f2<unknown[], unknown, unknown[]>("array::push"),
    range: f2<number, number, number[]>("array::range"),
    remove: f2<unknown[], number, unknown[]>("array::remove"),
    repeat: f2<unknown, number, unknown[]>("array::repeat"),
    reverse: f1<unknown[], unknown[]>("array::reverse"),
    shuffle: f1<unknown[], unknown[]>("array::shuffle"),
    slice: f2o<unknown[], number, number, unknown[]>("array::slice"),
    sort: {
      asc: f1<unknown[], unknown[]>("array::sort::asc"),
      desc: f1<unknown[], unknown[]>("array::sort::desc"),
    },
    union: f2<unknown[], unknown[], unknown[]>("array::union"),
  },
  /** `count(...)` — record/group counting. */
  count: f0o<unknown, number>("count"),
  /** `crypto::*` — hashes + password KDFs. */
  crypto: {
    md5: f1<string, string>("crypto::md5"),
    sha1: f1<string, string>("crypto::sha1"),
    sha256: f1<string, string>("crypto::sha256"),
    sha512: f1<string, string>("crypto::sha512"),
    argon2: {
      compare: f2<string, string, boolean>("crypto::argon2::compare"),
      generate: f1<string, string>("crypto::argon2::generate"),
    },
    bcrypt: {
      compare: f2<string, string, boolean>("crypto::bcrypt::compare"),
      generate: f1<string, string>("crypto::bcrypt::generate"),
    },
    pbkdf2: {
      compare: f2<string, string, boolean>("crypto::pbkdf2::compare"),
      generate: f1<string, string>("crypto::pbkdf2::generate"),
    },
    scrypt: {
      compare: f2<string, string, boolean>("crypto::scrypt::compare"),
      generate: f1<string, string>("crypto::scrypt::generate"),
    },
  },
  /** `duration::*` — duration decomposition + construction. */
  duration: {
    days: f1<unknown, number>("duration::days"),
    hours: f1<unknown, number>("duration::hours"),
    micros: f1<unknown, number>("duration::micros"),
    millis: f1<unknown, number>("duration::millis"),
    mins: f1<unknown, number>("duration::mins"),
    nanos: f1<unknown, number>("duration::nanos"),
    secs: f1<unknown, number>("duration::secs"),
    weeks: f1<unknown, number>("duration::weeks"),
    years: f1<unknown, number>("duration::years"),
    from_days: f1<number, unknown>("duration::from_days"),
    from_hours: f1<number, unknown>("duration::from_hours"),
    from_micros: f1<number, unknown>("duration::from_micros"),
    from_millis: f1<number, unknown>("duration::from_millis"),
    from_mins: f1<number, unknown>("duration::from_mins"),
    from_nanos: f1<number, unknown>("duration::from_nanos"),
    from_secs: f1<number, unknown>("duration::from_secs"),
    from_weeks: f1<number, unknown>("duration::from_weeks"),
  },
  /** `encoding::base64::*` — encode takes BYTES (`Uint8Array` binds as bytes). */
  encoding: {
    base64: {
      encode: f1<Uint8Array, string>("encoding::base64::encode"),
      decode: f1<string, Uint8Array>("encoding::base64::decode"),
    },
  },
  /** `geo::*` — geometry math. */
  geo: {
    area: f1<unknown, number>("geo::area"),
    bearing: f2<unknown, unknown, number>("geo::bearing"),
    centroid: f1<unknown, unknown>("geo::centroid"),
    distance: f2<unknown, unknown, number>("geo::distance"),
  },
  /** `http::*` — server-side HTTP (events/functions; needs the server's http capability).
   *  The generic is the RESPONSE shape (caller-known): `surql.fn.http.post<{ id?: string }>(…)`
   *  — shorthand for `.as<{ id?: string }>()`. Header values take fragments/refs. */
  http: {
    head: <R = Json>(url: FnArg<string>, headers?: HeadersArg): Frag<R> =>
      call("http::head", [url, headers]) as Frag<R>,
    get: <R = Json>(url: FnArg<string>, headers?: HeadersArg): Frag<R> =>
      call("http::get", [url, headers]) as Frag<R>,
    put: <R = Json>(
      url: FnArg<string>,
      body?: FnArg<Json>,
      headers?: HeadersArg,
    ): Frag<R> => call("http::put", [url, body, headers]) as Frag<R>,
    post: <R = Json>(
      url: FnArg<string>,
      body?: FnArg<Json>,
      headers?: HeadersArg,
    ): Frag<R> => call("http::post", [url, body, headers]) as Frag<R>,
    patch: <R = Json>(
      url: FnArg<string>,
      body?: FnArg<Json>,
      headers?: HeadersArg,
    ): Frag<R> => call("http::patch", [url, body, headers]) as Frag<R>,
    delete: <R = Json>(url: FnArg<string>, headers?: HeadersArg): Frag<R> =>
      call("http::delete", [url, headers]) as Frag<R>,
  },
  /** `math::*` — numeric + statistical. */
  math: {
    abs: f1<number, number>("math::abs"),
    bottom: f2<number[], number, number[]>("math::bottom"),
    ceil: f1<number, number>("math::ceil"),
    fixed: f2<number, number, number>("math::fixed"),
    floor: f1<number, number>("math::floor"),
    interquartile: f1<number[], number>("math::interquartile"),
    ln: f1<number, number>("math::ln"),
    log: f2<number, number, number>("math::log"),
    log10: f1<number, number>("math::log10"),
    log2: f1<number, number>("math::log2"),
    max: f1<number[], number>("math::max"),
    mean: f1<number[], number>("math::mean"),
    median: f1<number[], number>("math::median"),
    min: f1<number[], number>("math::min"),
    mode: f1<number[], number>("math::mode"),
    percentile: f2<number[], number, number>("math::percentile"),
    pow: f2<number, number, number>("math::pow"),
    product: f1<number[], number>("math::product"),
    round: f1<number, number>("math::round"),
    sign: f1<number, number>("math::sign"),
    sqrt: f1<number, number>("math::sqrt"),
    stddev: f1<number[], number>("math::stddev"),
    sum: f1<number[], number>("math::sum"),
    top: f2<number[], number, number[]>("math::top"),
    variance: f1<number[], number>("math::variance"),
  },
  /** `object::*`. */
  object: {
    entries: f1<object, [string, unknown][]>("object::entries"),
    from_entries: f1<[string, unknown][], object>("object::from_entries"),
    keys: f1<object, string[]>("object::keys"),
    len: f1<object, number>("object::len"),
    values: f1<object, unknown[]>("object::values"),
  },
  /** `parse::*` — email/url part extraction. */
  parse: {
    email: {
      host: f1<string, string>("parse::email::host"),
      user: f1<string, string>("parse::email::user"),
    },
    url: {
      domain: f1<string, string>("parse::url::domain"),
      fragment: f1<string, string>("parse::url::fragment"),
      host: f1<string, string>("parse::url::host"),
      path: f1<string, string>("parse::url::path"),
      port: f1<string, number>("parse::url::port"),
      query: f1<string, string>("parse::url::query"),
      scheme: f1<string, string>("parse::url::scheme"),
    },
  },
  /** `rand()` / `rand::*` — random values. */
  rand: Object.assign(f0<number>("rand"), {
    bool: f0<boolean>("rand::bool"),
    enum: fv<unknown, unknown>("rand::enum"),
    float: f0oo<number, number, number>("rand::float"),
    id: f0o<number, string>("rand::id"),
    int: f0oo<number, number, number>("rand::int"),
    string: f0o<number, string>("rand::string"),
    time: f0oo<unknown, unknown, Date>("rand::time"),
    ulid: f0<string>("rand::ulid"),
    uuid: Object.assign(f0<string>("rand::uuid"), {
      v4: f0<string>("rand::uuid::v4"),
      v7: f0<string>("rand::uuid::v7"),
    }),
  }),
  /** `record::*` — record-id introspection. */
  record: {
    exists: f1<unknown, boolean>("record::exists"),
    id: f1<unknown, unknown>("record::id"),
    table: f1<unknown, string>("record::tb"),
  },
  /** `search::*` — fulltext scoring (valid only in a fulltext `SELECT`). */
  search: {
    score: f1<number, number>("search::score"),
    highlight: f3<string, string, number, string>("search::highlight"),
    offsets: f1<number, unknown>("search::offsets"),
  },
  /** `session::*` — the current session's context. */
  session: {
    db: f0<string>("session::db"),
    id: f0<string>("session::id"),
    ip: f0<string>("session::ip"),
    ns: f0<string>("session::ns"),
    origin: f0<string>("session::origin"),
    token: f0<unknown>("session::token"),
  },
  /** `sleep(duration)`. */
  sleep: f1<unknown, void>("sleep"),
  /** `string::*` — text operations + validators. */
  string: {
    concat: fv<string, string>("string::concat"),
    contains: f2<string, string, boolean>("string::contains"),
    ends_with: f2<string, string, boolean>("string::ends_with"),
    join: fv<string, string>("string::join"),
    len: f1<string, number>("string::len"),
    lowercase: f1<string, string>("string::lowercase"),
    matches: f2<string, string, boolean>("string::matches"),
    repeat: f2<string, number, string>("string::repeat"),
    replace: f3<string, string, string, string>("string::replace"),
    reverse: f1<string, string>("string::reverse"),
    slice: f2o<string, number, number, string>("string::slice"),
    slug: f1<string, string>("string::slug"),
    split: f2<string, string, string[]>("string::split"),
    starts_with: f2<string, string, boolean>("string::starts_with"),
    trim: f1<string, string>("string::trim"),
    uppercase: f1<string, string>("string::uppercase"),
    words: f1<string, string[]>("string::words"),
    is_alphanum: f1<string, boolean>("string::is_alphanum"),
    is_alpha: f1<string, boolean>("string::is_alpha"),
    is_ascii: f1<string, boolean>("string::is_ascii"),
    is_datetime: f2<string, string, boolean>("string::is_datetime"),
    is_domain: f1<string, boolean>("string::is_domain"),
    is_email: f1<string, boolean>("string::is_email"),
    is_hexadecimal: f1<string, boolean>("string::is_hexadecimal"),
    is_ip: f1<string, boolean>("string::is_ip"),
    is_ipv4: f1<string, boolean>("string::is_ipv4"),
    is_ipv6: f1<string, boolean>("string::is_ipv6"),
    is_latitude: f1<string, boolean>("string::is_latitude"),
    is_longitude: f1<string, boolean>("string::is_longitude"),
    is_numeric: f1<string, boolean>("string::is_numeric"),
    is_semver: f1<string, boolean>("string::is_semver"),
    is_url: f1<string, boolean>("string::is_url"),
    is_uuid: f1<string, boolean>("string::is_uuid"),
  },
  /** `time::*` — datetime decomposition + construction. */
  time: {
    day: f0o<Date, number>("time::day"),
    floor: f2<Date, unknown, Date>("time::floor"),
    format: f2<Date, string, string>("time::format"),
    group: f2<Date, string, Date>("time::group"),
    hour: f0o<Date, number>("time::hour"),
    max: f1<Date[], Date>("time::max"),
    min: f1<Date[], Date>("time::min"),
    minute: f0o<Date, number>("time::minute"),
    month: f0o<Date, number>("time::month"),
    nano: f0o<Date, number>("time::nano"),
    now: f0<Date>("time::now"),
    round: f2<Date, unknown, Date>("time::round"),
    second: f0o<Date, number>("time::second"),
    timezone: f0<string>("time::timezone"),
    unix: f0o<Date, number>("time::unix"),
    wday: f0o<Date, number>("time::wday"),
    week: f0o<Date, number>("time::week"),
    yday: f0o<Date, number>("time::yday"),
    year: f0o<Date, number>("time::year"),
    from_micros: f1<number, Date>("time::from_micros"),
    from_millis: f1<number, Date>("time::from_millis"),
    from_nanos: f1<number, Date>("time::from_nanos"),
    from_secs: f1<number, Date>("time::from_secs"),
    from_unix: f1<number, Date>("time::from_unix"),
  },
  /** `type::*` — casts/constructors. */
  type: {
    bool: f1<unknown, boolean>("type::bool"),
    datetime: f1<unknown, Date>("type::datetime"),
    decimal: f1<unknown, unknown>("type::decimal"),
    duration: f1<unknown, unknown>("type::duration"),
    field: f1<string, unknown>("type::field"),
    fields: f1<string[], unknown[]>("type::fields"),
    float: f1<unknown, number>("type::float"),
    int: f1<unknown, number>("type::int"),
    number: f1<unknown, number>("type::number"),
    point: f1<unknown, unknown>("type::point"),
    record: f1o<string, string, unknown>("type::record"),
    string: f1<unknown, string>("type::string"),
    table: f1<unknown, unknown>("type::table"),
    uuid: f1<unknown, unknown>("type::uuid"),
    is_array: f1<unknown, boolean>("type::is_array"),
    is_bool: f1<unknown, boolean>("type::is_bool"),
    is_datetime: f1<unknown, boolean>("type::is_datetime"),
    is_decimal: f1<unknown, boolean>("type::is_decimal"),
    is_duration: f1<unknown, boolean>("type::is_duration"),
    is_float: f1<unknown, boolean>("type::is_float"),
    is_int: f1<unknown, boolean>("type::is_int"),
    is_none: f1<unknown, boolean>("type::is_none"),
    is_null: f1<unknown, boolean>("type::is_null"),
    is_number: f1<unknown, boolean>("type::is_number"),
    is_object: f1<unknown, boolean>("type::is_object"),
    is_record: f1o<unknown, string, boolean>("type::is_record"),
    is_string: f1<unknown, boolean>("type::is_string"),
    is_uuid: f1<unknown, boolean>("type::is_uuid"),
  },
  /** `vector::*` — vector math (embeddings). */
  vector: {
    add: f2<number[], number[], number[]>("vector::add"),
    angle: f2<number[], number[], number>("vector::angle"),
    cross: f2<number[], number[], number[]>("vector::cross"),
    divide: f2<number[], number[], number[]>("vector::divide"),
    dot: f2<number[], number[], number>("vector::dot"),
    magnitude: f1<number[], number>("vector::magnitude"),
    multiply: f2<number[], number[], number[]>("vector::multiply"),
    normalize: f1<number[], number[]>("vector::normalize"),
    subtract: f2<number[], number[], number[]>("vector::subtract"),
    distance: {
      chebyshev: f2<number[], number[], number>("vector::distance::chebyshev"),
      euclidean: f2<number[], number[], number>("vector::distance::euclidean"),
      hamming: f2<number[], number[], number>("vector::distance::hamming"),
      manhattan: f2<number[], number[], number>("vector::distance::manhattan"),
    },
    similarity: {
      cosine: f2<number[], number[], number>("vector::similarity::cosine"),
      jaccard: f2<number[], number[], number>("vector::similarity::jaccard"),
      pearson: f2<number[], number[], number>("vector::similarity::pearson"),
    },
  },
} as const;

// --- the ref stdlib (per-kind method families the query layer grafts onto field refs) ------------

/** One derived-ref method: the builtin it lowers to (or an operator, spelled `op:<sym>`) and the
 *  KIND of ref it returns (so chaining picks the right next family). `"element"` = the source
 *  array's element kind; `elem` seeds the element kind of an `array` result. */
export interface RefMethodSpec {
  readonly fn: string;
  readonly returns: RefKind | "element";
  readonly elem?: RefKind;
}

/** The per-kind stdlib families (runtime source; the typed facades live in the query layer). */
export const refMethods: Record<
  Exclude<RefKind, "other">,
  Record<string, RefMethodSpec>
> = {
  string: {
    length: { fn: "string::len", returns: "number" },
    lowercase: { fn: "string::lowercase", returns: "string" },
    uppercase: { fn: "string::uppercase", returns: "string" },
    trim: { fn: "string::trim", returns: "string" },
    slug: { fn: "string::slug", returns: "string" },
    reverse: { fn: "string::reverse", returns: "string" },
    repeat: { fn: "string::repeat", returns: "string" },
    replace: { fn: "string::replace", returns: "string" },
    slice: { fn: "string::slice", returns: "string" },
    split: { fn: "string::split", returns: "array", elem: "string" },
    words: { fn: "string::words", returns: "array", elem: "string" },
  },
  number: {
    abs: { fn: "math::abs", returns: "number" },
    ceil: { fn: "math::ceil", returns: "number" },
    floor: { fn: "math::floor", returns: "number" },
    round: { fn: "math::round", returns: "number" },
    sqrt: { fn: "math::sqrt", returns: "number" },
    pow: { fn: "math::pow", returns: "number" },
    fixed: { fn: "math::fixed", returns: "number" },
    plus: { fn: "op:+", returns: "number" },
    minus: { fn: "op:-", returns: "number" },
    times: { fn: "op:*", returns: "number" },
    div: { fn: "op:/", returns: "number" },
  },
  array: {
    length: { fn: "array::len", returns: "number" },
    at: { fn: "array::at", returns: "element" },
    first: { fn: "array::first", returns: "element" },
    last: { fn: "array::last", returns: "element" },
    distinct: { fn: "array::distinct", returns: "array" },
    sort: { fn: "array::sort", returns: "array" },
    reverse: { fn: "array::reverse", returns: "array" },
    slice: { fn: "array::slice", returns: "array" },
    flatten: { fn: "array::flatten", returns: "array" },
    join: { fn: "array::join", returns: "string" },
  },
  date: {
    year: { fn: "time::year", returns: "number" },
    month: { fn: "time::month", returns: "number" },
    day: { fn: "time::day", returns: "number" },
    hour: { fn: "time::hour", returns: "number" },
    minute: { fn: "time::minute", returns: "number" },
    second: { fn: "time::second", returns: "number" },
    wday: { fn: "time::wday", returns: "number" },
    week: { fn: "time::week", returns: "number" },
    yday: { fn: "time::yday", returns: "number" },
    unix: { fn: "time::unix", returns: "number" },
    format: { fn: "time::format", returns: "string" },
  },
};
