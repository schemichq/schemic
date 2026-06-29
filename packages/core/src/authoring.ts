// The NEUTRAL, dialect-agnostic AUTHORING BASE (docs/AUTHORING-SPLIT.md — "base builder in core").
// Each driver package builds its `s.*` on this: `class <D>Field extends SFieldBase<S, Flags, <D>Meta>`
// adds the dialect's native authoring (`$`-methods) and its `$<driver>(type, codec)` escape hatch for
// types not representable on the wire; the base provides the Zod codec, the Zod wrappers, the full
// `z.*` passthrough, and the `rebuild`/`blank` seam that carries native metadata through a chain.
//
// It references NOTHING dialect-specific — it's generic over the per-dialect native-metadata slot `N`.
// It is also Zod-CLEAN: app-side behaviour delegates to the inner Zod schema (`z.decode`/`z.encode`/
// the wrappers) via Zod's public API, with side-channel metadata kept on WeakMaps — never patching
// Zod internals.

import * as z from "zod";

// `SFieldBase` is INVARIANT in its native-metadata slot `N` (the protected `rebuild(native: N)` makes
// N contravariant while `native`/`blank` make it covariant). So a dialect field — `SField` with
// `N = SurrealMeta` — is NOT assignable to a fixed `N = unknown`, which would make `AnyField` reject
// real dialect fields (e.g. `.or(s.int())`). At THIS cross-dialect boundary `N` is honestly "any
// dialect's metadata": erase it to `any` (bivariant) so every driver's field is an `AnyField`. The
// concrete `N` is preserved everywhere it matters — each driver's own field type keeps `N = <D>Meta`.

/** Any field of ANY dialect — the base type the helpers + wrappers accept. */
// biome-ignore lint/suspicious/noExplicitAny: cross-dialect erasure of the invariant native slot N.
export type AnyField = SFieldBase<z.ZodType, string, any>;

/** The Zod schema a field (or a raw Zod schema) carries. */
export type SchemaOf<F> =
  // biome-ignore lint/suspicious/noExplicitAny: match a field of any dialect (N is invariant).
  F extends SFieldBase<infer S, string, any>
    ? S
    : F extends z.ZodType
      ? F
      : never;

/** The `Flags` channel a field carries (driver `$`-methods brand it; widens to `string` for `Shape`). */
export type FlagsOf<F> =
  // biome-ignore lint/suspicious/noExplicitAny: match a field of any dialect (N is invariant).
  F extends SFieldBase<z.ZodType, infer Fl, any> ? Fl : never;

/** The schema one wrapper down — what `unwrap()` returns. */
export type InnerOf<S extends z.ZodType> =
  S extends z.ZodOptional<infer I extends z.ZodType>
    ? I
    : S extends z.ZodNullable<infer I extends z.ZodType>
      ? I
      : S extends z.ZodDefault<infer I extends z.ZodType>
        ? I
        : S extends z.ZodPrefault<infer I extends z.ZodType>
          ? I
          : S extends z.ZodCatch<infer I extends z.ZodType>
            ? I
            : S extends z.ZodReadonly<infer I extends z.ZodType>
              ? I
              : S extends z.ZodArray<infer I extends z.ZodType>
                ? I
                : S;

/**
 * Maps an object schema (built via a driver's `s.object`) to its original field shape, so nested
 * fields keep their authoring metadata through generation. Kept on the schema, not the field, so it
 * composes through `array()`/`optional()`/nesting.
 */
export const objectFieldsRegistry = new WeakMap<
  z.ZodType,
  Record<string, AnyField>
>();

/**
 * The PORTABLE, dialect-agnostic field base. Holds the Zod schema, an opaque per-dialect `native`
 * metadata slot, the field-level codecs, and the app-land Zod wrappers (which carry `native` forward
 * via the `rebuild` hook so a chain keeps its concrete dialect type). Each dialect subclasses it to
 * add native authoring (`$`-methods) and re-type the wrappers so a chain stays its own field type.
 */
export abstract class SFieldBase<
  S extends z.ZodType = z.ZodType,
  Flags extends string = never,
  N = unknown,
> {
  constructor(
    readonly schema: S,
    readonly native: N,
  ) {}

  /**
   * Standard Schema interface (https://standardschema.dev), forwarded from the wrapped Zod schema so a
   * Schemic field IS a drop-in Standard Schema — it slots straight into any consumer (tRPC, TanStack
   * Form/Router, …) without unwrapping. `validate` runs the DECODE direction (wire -> app), matching
   * `decode`/`parse`. We wrap Zod by composition (not subclassing), so this getter is what carries the
   * `~standard` contract across the wrapper; without it only `field.schema` would be compliant.
   */
  get ["~standard"](): S["~standard"] {
    return this.schema["~standard"];
  }

  /** Rebuild a sibling field of the SAME dialect with a new schema/flags. Each dialect overrides it. */
  protected abstract rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: N,
  ): SFieldBase<S2, F2, N>;
  /** A fresh, empty native-metadata bag (for wrappers like `or`/`and` that reset it). */
  protected abstract blank(): N;

  // --- Field-level codec (raw, on `this.schema`): `decode` reads (wire -> app), `encode` writes
  // (app -> wire). Create-shaping is a table concept, so these are NOT create-shaped. ---
  /** Decode a DB value to its app type (wire -> app). */
  decode(value: unknown): z.output<S> {
    return z.decode(this.schema, value as never);
  }
  /** Encode an app value to its DB wire type (app -> wire). */
  encode(value: z.output<S>): z.input<S> {
    return z.encode(this.schema, value);
  }
  decodeAsync(value: unknown): Promise<z.output<S>> {
    return z.decodeAsync(this.schema, value as never);
  }
  encodeAsync(value: z.output<S>): Promise<z.input<S>> {
    return z.encodeAsync(this.schema, value);
  }
  safeDecode(value: unknown) {
    return z.safeDecode(this.schema, value as never);
  }
  safeEncode(value: z.output<S>) {
    return z.safeEncode(this.schema, value);
  }
  safeDecodeAsync(value: unknown) {
    return z.safeDecodeAsync(this.schema, value as never);
  }
  safeEncodeAsync(value: z.output<S>) {
    return z.safeEncodeAsync(this.schema, value);
  }
  // Deprecated Zod-style aliases — `parse` runs the DECODE direction (wire -> app).
  /** @deprecated `parse` decodes a value (wire -> app). Use {@link decode}. */
  parse(value: unknown): z.output<S> {
    return this.decode(value);
  }
  /** @deprecated Use {@link safeDecode}. */
  safeParse(value: unknown) {
    return this.safeDecode(value);
  }
  /** @deprecated Use {@link decodeAsync}. */
  parseAsync(value: unknown): Promise<z.output<S>> {
    return this.decodeAsync(value);
  }
  /** @deprecated Use {@link safeDecodeAsync}. */
  safeParseAsync(value: unknown) {
    return this.safeDecodeAsync(value);
  }
  /** Zod's `.spa` alias for {@link safeParseAsync} (drop-in). */
  spa(value: unknown) {
    return this.safeParseAsync(value);
  }

  // --- Zod reflection + interop (drop-in for `z.*`), delegated to the inner schema ---
  /** Does this field accept `undefined`? (Zod reflection.) */
  isOptional(): boolean {
    return this.schema.isOptional();
  }
  /** Does this field accept `null`? (Zod reflection.) */
  isNullable(): boolean {
    return this.schema.isNullable();
  }
  /** Read back the description set via {@link describe} / {@link meta}. */
  get description(): string | undefined {
    return this.schema.description;
  }
  /** JSON Schema for this field's wire shape (delegates to `z.toJSONSchema`). */
  toJSONSchema() {
    return z.toJSONSchema(this.schema);
  }
  /** Register the wrapped schema in a Zod registry for metadata interop; returns the field. */
  register(...args: Parameters<S["register"]>): this {
    Reflect.apply(this.schema.register, this.schema, args);
    return this;
  }

  // Zod wrappers — delegate to the inner schema, carry native metadata + flags forward.
  optional(): SFieldBase<z.ZodOptional<S>, Flags, N> {
    return this.rebuild(this.schema.optional(), this.native);
  }
  nullable(): SFieldBase<z.ZodNullable<S>, Flags, N> {
    return this.rebuild(this.schema.nullable(), this.native);
  }
  default(value: z.input<S>): SFieldBase<z.ZodDefault<S>, Flags, N> {
    return this.rebuild(this.schema.default(value as never), this.native);
  }
  /** Zod prefault: fill an absent value with `value`, then validate it (unlike `.default`). */
  prefault(value: z.input<S>): SFieldBase<z.ZodPrefault<S>, Flags, N> {
    return this.rebuild(z.prefault(this.schema, value as never), this.native);
  }
  /** Zod catch: fall back to `value` when parsing fails. */
  catch(value: z.output<S>): SFieldBase<z.ZodCatch<S>, Flags, N> {
    return this.rebuild(this.schema.catch(value as never), this.native);
  }
  array(): SFieldBase<z.ZodArray<S>, Flags, N> {
    return this.rebuild(z.array(this.schema), this.native);
  }
  nullish(): SFieldBase<z.ZodOptional<z.ZodNullable<S>>, Flags, N> {
    return this.rebuild(this.schema.nullish(), this.native);
  }
  /** Zod `.nonoptional()` — require a value (strips an `.optional()`). */
  nonoptional(): SFieldBase<z.ZodNonOptional<S>, Flags, N> {
    return this.rebuild(this.schema.nonoptional(), this.native);
  }
  /** Zod `.exactOptional()` — optional that rejects an explicit `undefined`. */
  exactOptional(): SFieldBase<z.ZodExactOptional<S>, Flags, N> {
    return this.rebuild(this.schema.exactOptional(), this.native);
  }
  /** Zod union — `a.or(b)` accepts either. Mirrors Zod's `.or()`. */
  or<F extends AnyField | z.ZodType>(
    other: F,
  ): SFieldBase<z.ZodUnion<[S, SchemaOf<F>]>, never, N> {
    return this.rebuild<z.ZodUnion<[S, SchemaOf<F>]>, never>(
      z.union([this.schema, toZod(other)]) as z.ZodUnion<[S, SchemaOf<F>]>,
      this.blank(),
    );
  }
  /** Zod intersection — `a.and(b)`. Mirrors Zod's `.and()`. */
  and<F extends AnyField | z.ZodType>(
    other: F,
  ): SFieldBase<z.ZodIntersection<S, SchemaOf<F>>, never, N> {
    return this.rebuild<z.ZodIntersection<S, SchemaOf<F>>, never>(
      z.intersection(this.schema, toZod(other) as SchemaOf<F>),
      this.blank(),
    );
  }

  // --- Native Zod passthrough (drop-in for `z.*`): app-side validation / transform / metadata,
  // delegated to the inner schema. The dialect-DDL side stays under the driver's `$`-methods. ---
  refine(
    check: (arg: z.output<S>) => unknown,
    params?: string | z.core.$ZodCustomParams,
  ): this {
    return this.rebuild(
      this.schema.refine(check, params) as S,
      this.native,
    ) as unknown as this;
  }
  superRefine(
    refinement: (
      arg: z.output<S>,
      ctx: z.core.$RefinementCtx<z.output<S>>,
    ) => void,
  ): this {
    return this.rebuild(
      this.schema.superRefine(refinement) as S,
      this.native,
    ) as unknown as this;
  }
  check(
    ...checks: (z.core.CheckFn<z.output<S>> | z.core.$ZodCheck<z.output<S>>)[]
  ): this {
    return this.rebuild(
      this.schema.check(...checks) as S,
      this.native,
    ) as unknown as this;
  }
  overwrite(fn: (x: z.output<S>) => z.output<S>): this {
    return this.rebuild(
      this.schema.overwrite(fn) as S,
      this.native,
    ) as unknown as this;
  }
  brand<B extends PropertyKey = PropertyKey>(value?: B): this {
    return this.rebuild(
      this.schema.brand(value) as unknown as S,
      this.native,
    ) as unknown as this;
  }
  /** Zod's app-side metadata (JSON-schema/docs) — distinct from a driver's `$comment()`. */
  describe(description: string): this {
    return this.rebuild(
      this.schema.describe(description) as S,
      this.native,
    ) as unknown as this;
  }
  meta(data: z.core.GlobalMeta): this {
    return this.rebuild(
      this.schema.meta(data) as S,
      this.native,
    ) as unknown as this;
  }
  /** Zod's app-side readonly (TS-immutable output) — distinct from a driver's `$readonly()`. */
  readonly(): SFieldBase<z.ZodReadonly<S>, Flags, N> {
    return this.rebuild(this.schema.readonly(), this.native);
  }
  /** Zod transform — changes the decoded `App<>` value; the stored (wire) type is unchanged. */
  transform<NewOut>(
    fn: (arg: z.output<S>, ctx: z.core.$RefinementCtx<z.output<S>>) => NewOut,
  ): SFieldBase<
    z.ZodPipe<S, z.ZodTransform<Awaited<NewOut>, z.output<S>>>,
    Flags,
    N
  > {
    return this.rebuild(this.schema.transform(fn), this.native);
  }
  /** Zod pipe — feed this field's output into `target`; the stored (wire) type stays `this`. */
  pipe<T extends z.core.$ZodType<unknown, z.output<S>>>(
    target: T,
  ): SFieldBase<z.ZodPipe<S, T>, Flags, N> {
    return this.rebuild(
      this.schema.pipe(target) as z.ZodPipe<S, T>,
      this.native,
    );
  }
  /** Peel one wrapper (optional/nullable/default/prefault/catch/readonly/array) off the field. */
  unwrap(): SFieldBase<InnerOf<S>, Flags, N> {
    const def = this.schema._zod.def as {
      innerType?: z.ZodType;
      element?: z.ZodType;
    };
    const inner = def.innerType ?? def.element ?? this.schema;
    return this.rebuild(inner, this.native) as unknown as SFieldBase<
      InnerOf<S>,
      Flags,
      N
    >;
  }

  /** Object-only: allow arbitrary extra keys — `FLEXIBLE` in DDL. Mirrors Zod's `.loose()`. */
  loose(): this {
    return this.objectMode("loose");
  }
  /** Object-only: reject unknown keys — the default. Mirrors Zod's `.strict()`. */
  strict(): this {
    return this.objectMode("strict");
  }
  /** Alias for {@link loose} — a `FLEXIBLE` object accepting arbitrary keys. */
  flexible(): this {
    return this.loose();
  }
  private objectMode(mode: "loose" | "strict"): this {
    const obj = this.schema as unknown as {
      loose?: () => z.ZodType;
      strict?: () => z.ZodType;
    };
    if (typeof obj.loose !== "function" || typeof obj.strict !== "function") {
      return this; // not an object schema — no-op
    }
    const next = (mode === "loose"
      ? obj.loose()
      : obj.strict()) as unknown as S;
    // Carry the nested-field registry forward so DDL/create-shaping still see the subfields.
    const fields = objectFieldsRegistry.get(this.schema);
    if (fields) objectFieldsRegistry.set(next, fields);
    return this.rebuild(next, this.native) as unknown as this;
  }
}

/** Unwrap a field to its Zod schema (raw Zod schemas pass through). */
export const toZod = (v: AnyField | z.ZodType): z.ZodType =>
  v instanceof SFieldBase ? v.schema : v;

// Secret-ref authoring helpers (env/secret) live here on the SIDE-EFFECT-FREE authoring subpath, so a
// driver's authoring index can re-export them without dragging the engine. (Also on the main index.)
export {
  env,
  isSecretRef,
  type SecretProvider,
  type SecretRef,
  secret,
} from "./secrets";
