import {
  BoundQuery,
  DateTime,
  Duration,
  escapeIdent,
  RecordId,
  StringRecordId,
  surql,
  Uuid,
  Table,
  type RecordIdValue,
  RecordIdRange,
  type Bound,
  BoundExcluded,
  BoundIncluded,
  Range,
} from "surrealdb";
import * as core from "zod/v4/core";
import * as classic from "zod/v4";
import {
  inferSurrealType,
  inlineQueryParameters,
  tableToSurql,
  type DefineTableOptions,
  type RemoveTableOptions,
  type TableInfo,
  type TableStructure,
} from "../surql.js";
import * as _core_ from "./core.js";
import {
  assignParsingMethods,
  type ParseDbContext,
  type ParseDbContextInternal,
  type ParsingEncodingDecodingMethodNames,
  type ParsingEncodingDecodingMethods,
} from "./parse.js";
import { allProcessors } from "./json-schema.js";
import type { UnionToTuple } from "./utils.js";

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealType      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealTypeDef extends _core_.$ZodSurrealTypeDef {
  surreal: _core_.$ZodSurrealTypeDefInternals;
}

export interface ZodSurrealTypeInternals<
  out O = unknown,
  out I = unknown,
  out DBO = O,
  out DBI = I,
> extends _core_.$ZodSurrealTypeInternals<O, I, DBO, DBI> {
  def: ZodSurrealTypeDef;
}

export interface ZodSurrealType<
  out O = unknown,
  out I = unknown,
  out DBO = O,
  out DBI = I,
  out Internals extends ZodSurrealTypeInternals<
    O,
    I,
    DBO,
    DBI
  > = ZodSurrealTypeInternals<O, I, DBO, DBI>,
> {
  _zod: Internals;
  "~standard": core.ZodStandardSchemaWithJSON<this>;

  /** Converts this schema to a JSON Schema representation. */
  toJSONSchema(
    params?: core.ToJSONSchemaParams,
  ): core.ZodStandardJSONSchemaPayload<this>;

  // base methods
  check(
    ...checks: (
      | core.CheckFn<core.output<this>>
      | core.$ZodCheck<core.output<this>>
    )[]
  ): this;
  with(
    ...checks: (
      | core.CheckFn<core.output<this>>
      | core.$ZodCheck<core.output<this>>
    )[]
  ): this;
  clone(def?: Internals["def"], params?: { parent: boolean }): this;
  register<R extends core.$ZodRegistry>(
    registry: R,
    ...meta: this extends R["_schema"]
      ? undefined extends R["_meta"]
      ? [core.$replace<R["_meta"], this>?]
      : [core.$replace<R["_meta"], this>]
      : ["Incompatible schema"]
  ): this;

  brand<
    T extends PropertyKey = PropertyKey,
    Dir extends "in" | "out" | "inout" = "out",
  >(value?: T): PropertyKey extends T ? this : _core_.$ZodBranded<this, T, Dir>;

  // parsing/encoding/decoding
  parse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>;
  encode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>;
  decode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>;
  parseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  encodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Promise<Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>>;
  decodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Promise<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeParse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeEncode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>
  >;
  safeDecode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeParseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;
  spa<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;
  safeEncodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>
    >
  >;
  safeDecodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;


  // refinements
  refine<Ch extends (arg: core.output<this>) => unknown | Promise<unknown>>(
    check: Ch,
    params?: string | core.$ZodCustomParams
  ): Ch extends (arg: any) => arg is infer R ? this & ZodSurrealType<R, core.input<this>> : this;
  superRefine(
    refinement: (arg: core.output<this>, ctx: core.$RefinementCtx<core.output<this>>) => void | Promise<void>
  ): this;
  overwrite(fn: (x: core.output<this>) => core.output<this>): this;

  // wrappers
  optional(): ZodSurrealOptional<this>;
  exactOptional(): ZodSurrealExactOptional<this>;
  nonoptional(
    params?: string | core.$ZodNonOptionalParams,
  ): ZodSurrealNonOptional<this>;
  nullable(): ZodSurrealNullable<this>;
  nullish(): ZodSurrealOptional<ZodSurrealNullable<this>>;
  default(
    def: core.util.NoUndefined<core.output<this>>,
  ): ZodSurrealDefault<this>;
  default(
    def: () => core.util.NoUndefined<core.output<this>>,
  ): ZodSurrealDefault<this>;
  prefault(def: () => core.input<this>): ZodSurrealPrefault<this>;
  prefault(def: core.input<this>): ZodSurrealPrefault<this>;
  array(): ZodSurrealArray<this>;
  or<T extends _core_.$SomeSurrealType>(option: T): ZodSurrealUnion<[this, T]>;
  and<T extends _core_.$SomeSurrealType>(
    incoming: T,
  ): ZodSurrealIntersection<this, T>;
  transform<NewOut>(
    transform: (
      arg: core.output<this>,
      ctx: core.$RefinementCtx<core.output<this>>,
    ) => NewOut | Promise<NewOut>,
  ): ZodSurrealPipe<
    this,
    ZodSurrealTransform<Awaited<NewOut>, core.output<this>>
  >;
  catch(def: core.output<this>): ZodSurrealCatch<this>;
  catch(
    def: (ctx: core.$ZodCatchCtx) => core.output<this>,
  ): ZodSurrealCatch<this>;
  pipe<T extends _core_.$ZodSurrealType<any, core.output<this>>>(
    target: T | _core_.$ZodSurrealType<any, core.output<this>>,
  ): ZodSurrealPipe<this, T>;
  readonly(): ZodSurrealReadonly<this>;
}

export interface _ZodSurrealType<
  Internals extends ZodSurrealTypeInternals = ZodSurrealTypeInternals,
> extends ZodSurrealType<any, any, any, any, Internals> { }

export const ZodSurrealType: core.$constructor<ZodSurrealType> =
  core.$constructor("ZodSurrealType", (inst, def) => {
    // @ts-expect-error
    core.$ZodType.init(inst, def);

    inst._zod.def.surreal ??= {};

    Object.assign(inst["~standard"], {
      jsonSchema: {
        input: core.createStandardJSONSchemaMethod(
          // Not overriding json schema stuff
          inst as any,
          "input",
        ),
        output: core.createStandardJSONSchemaMethod(
          // Not overriding json schema stuff
          inst as any,
          "output",
        ),
      },
    });
    inst.toJSONSchema = core.createToJSONSchemaMethod(inst as any, {}) as any;

    // base methods
    inst.check = (...checks) => {
      return inst.clone(
        core.util.mergeDefs(def, {
          checks: [
            ...(def.checks ?? []),
            ...checks.map((ch) =>
              typeof ch === "function"
                ? {
                  _zod: { check: ch, def: { check: "custom" }, onattach: [] },
                }
                : ch,
            ),
          ],
        }),
        {
          parent: true,
        },
      );
    };
    inst.with = inst.check;
    inst.clone = (def, params) => core.clone(inst as any, def, params);
    inst.brand = () => inst as any;
    inst.register = ((reg: any, meta: any) => {
      reg.add(inst, meta);
      return inst;
    }) as any;

    assignParsingMethods(inst as any);


    // refinements
    inst.refine = (check, params) => inst.check(refine(check, params)) as never;
    inst.superRefine = (refinement) => inst.check(superRefine(refinement));
    inst.overwrite = (fn) => inst.check(classic.overwrite(fn));


    // wrappers
    inst.optional = () => optional(inst);
    inst.exactOptional = () => exactOptional(inst);
    inst.nullable = () => nullable(inst);
    inst.nullish = () => optional(nullable(inst));
    inst.nonoptional = (params) => nonoptional(inst, params);
    inst.array = () => array(inst);
    inst.or = (arg) => union([inst, arg]);
    inst.and = (arg) => intersection(inst, arg);
    inst.transform = (tx) => pipe(inst, transform(tx as any)) as never;
    inst.default = (def) => _default(inst, def);
    inst.prefault = (def) => prefault(inst, def);
    // inst.coalesce = (def, params) => coalesce(inst, def, params);
    inst.catch = (params) => _catch(inst, params);
    inst.pipe = (target) => pipe(inst as any, target as any);
    inst.readonly = () => readonly(inst);

    return inst;
  });

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealField      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

// ZodSurrealField is used when context is switched from schema definition to
// database field definition (calling any $-prefixed function)

export interface ZodSurrealFieldDef<O = unknown, I = unknown>
  extends ZodSurrealTypeDef {
  type: "field";
  innerType: _core_.$ZodSurrealType<O, I>;

  surreal: ZodSurrealTypeDef["surreal"] & {
    field: {
      default?: {
        value: BoundQuery;
        always?: boolean;
        parse?: boolean;
      };
      readonly?: boolean;
      comment?: string;
      assert?: BoundQuery;
      value?: BoundQuery;
    };
  };
}

export interface ZodSurrealFieldInternals<
  out O = unknown,
  out I = unknown,
  out DBO = O,
  out DBI = I,
> extends ZodSurrealTypeInternals<O, I, DBO, DBI> {
  def: ZodSurrealFieldDef<O, I>;
}

type UnwrapField<T> =
  T extends ZodSurrealField<infer I, any, any, any, any, any>
  ? UnwrapField<I>
  : T;

export interface ZodSurrealField<
  T extends _core_.$ZodSurrealType = _core_.$ZodSurrealType,
  O = core.output<T>,
  I = core.input<T>,
  DBO = _core_.dboutput<T>,
  DBI = _core_.dbinput<T>,
  Options extends string = "",
> extends _core_.$ZodSurrealType<
  O,
  I,
  DBO,
  DBI,
  | "$default"
  | "$prefault"
  | "$defaultAlways"
  | "$prefaultAlways" extends Options
  ? Omit<ZodSurrealFieldInternals<O, I, DBO, DBI>, "optin" | "optout"> & {
    optin: "optional";
    optout: "optional";
    dboptin: "optional";
  } & (T extends _core_.OptionalOutSchema
    ? {
      dboptout: "optional";
    }
    : {
      dboptout?: "optional" | undefined;
    })
  : ZodSurrealFieldInternals<O, I, DBO, DBI> &
  (T["_zod"] extends {
    optin?: any;
  }
    ? {
      dboptin?: T["_zod"]["optin"];
    }
    : { dboptin: T["_zod"]["optin"] }) &
  (T["_zod"] extends { optout?: any }
    ? {
      dboptout?: T["_zod"]["optout"];
    }
    : { dboptout: T["_zod"]["optout"] })
>,
  ZodSurrealFieldMethods<Options> {
  // parsing/encoding/decoding
  parse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>;
  encode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>;
  decode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>;
  parseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  encodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Promise<Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>>;
  decodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Promise<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeParse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeEncode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>
  >;
  safeDecode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
  >;
  safeParseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;
  spa<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;
  safeEncodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>
    >
  >;
  safeDecodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<this> : core.input<this>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<this> : core.output<this>
    >
  >;

  // unwrap
  unwrap(): UnwrapField<T>;
}

// Helper for tracking ZodSurrealField parameters
type _<T, Options extends string> = ZodSurrealField<
  T & ZodSurrealType,
  core.output<T>,
  core.input<T>,
  _core_.dboutput<T>,
  _core_.dbinput<T>,
  Options
>;

// Helper for tracking ZodSurrealField parameters
type __<T, O, I, DBO, DBI, Options extends string> = ZodSurrealField<
  T & ZodSurrealType,
  O,
  I,
  DBO,
  DBI,
  Options
>;

export interface ZodSurrealFieldMethods<Options extends string = never> {
  $default(
    value: core.util.NoUndefined<core.output<this>> | BoundQuery,
  ): __<
    this,
    core.output<this> | undefined,
    core.input<this> | undefined,
    _core_.dboutput<this>,
    _core_.dbinput<this> | undefined,
    Options | "$default" | "$prefault" | "$defaultAlways" | "$prefaultAlways"
  >;
  $prefault(
    value: core.util.NoUndefined<core.output<this>> | BoundQuery,
  ): __<
    this,
    core.output<this> | undefined,
    core.input<this> | undefined,
    _core_.dboutput<this>,
    _core_.dbinput<this> | undefined,
    Options | "$default" | "$prefault" | "$defaultAlways" | "$prefaultAlways"
  >;
  $defaultAlways(
    value: core.util.NoUndefined<core.output<this>> | BoundQuery,
  ): __<
    this,
    core.output<this> | undefined,
    core.input<this> | undefined,
    _core_.dboutput<this>,
    _core_.dbinput<this> | undefined,
    Options | "$default" | "$prefault" | "$defaultAlways" | "$prefaultAlways"
  >;
  $prefaultAlways(
    value: core.util.NoUndefined<core.output<this>> | BoundQuery,
  ): __<
    this,
    core.output<this> | undefined,
    core.input<this> | undefined,
    _core_.dboutput<this>,
    _core_.dbinput<this> | undefined,
    Options | "$default" | "$prefault" | "$defaultAlways" | "$prefaultAlways"
  >;
  $readonly(readonly?: boolean): _<this, Options | "$readonly">;
  $value(value: BoundQuery): _<this, Options | "$value">;
  $assert(assert: BoundQuery): _<this, Options | "$assert">;
  $comment(comment: string): _<this, Options | "$comment">;
}

export const ZodSurrealField: core.$constructor<ZodSurrealField> =
  core.$constructor("ZodSurrealField", (inst, def) => {
    // @ts-expect-error
    core.$ZodType.init(inst, def);
    def.surreal.field ??= {};
    const isField = inst._zod.traits.size === 2;

    if (def.surreal.field.default) {
      inst._zod.optin = "optional";
      inst._zod.optout = "optional";
      inst._zod.dboptin = "optional";
    }

    assignParsingMethods(inst as any);

    // ----------- Database Only Methods -----------
    inst.$default = (value) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            default: {
              value: value instanceof BoundQuery ? value : surql`${value}`,
              always: false,
              parse: false,
            },
          },
        },
      }) as any;
    };
    inst.$prefault = (value) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            default: {
              value: value instanceof BoundQuery ? value : surql`${value}`,
              always: false,
              parse: true,
            },
          },
        },
      }) as any;
    };
    inst.$defaultAlways = (value) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            default: {
              value: value instanceof BoundQuery ? value : surql`${value}`,
              always: true,
            },
          },
        },
      }) as any;
    };
    inst.$prefaultAlways = (value) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            default: {
              value: value instanceof BoundQuery ? value : surql`${value}`,
              always: true,
              parse: true,
            },
          },
        },
      }) as any;
    };

    inst.$readonly = (readonly = true) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...inst._zod.def.surreal.field,
            readonly,
          },
        },
      }) as any;
    };

    inst.$comment = (comment) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            comment,
          },
        },
      }) as any;
    };

    inst.$assert = (assert) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            assert,
          },
        },
      }) as any;
    };

    inst.$value = (value) => {
      return new ZodSurrealField({
        type: "field",
        ...(isField ? inst._zod.def : {}),
        innerType: isField ? inst._zod.def.innerType : inst,
        surreal: {
          ...(isField ? inst._zod.def.surreal : {}),
          field: {
            ...(isField ? inst._zod.def.surreal.field : {}),
            value,
          },
        },
      }) as any;
    };

    inst.unwrap = () => inst._zod.def.innerType as any;

    if (isField) {
      inst._zod.parse = (payload, ctx: ParseDbContextInternal) => {
        if (ctx.direction === "backward") {
          return def.innerType._zod.run(payload, ctx);
        }

        // .default/.prefault take precedence
        if (def.innerType._zod.optin === "optional") {
          const result = def.innerType._zod.run(payload, ctx);
          if (result instanceof Promise)
            return result.then((r) => {
              if (r.issues.length && payload.value === undefined) {
                return { issues: [], value: undefined };
              }
              return result;
            });
          if (result.issues.length && payload.value === undefined) {
            return { issues: [], value: undefined };
          }
          return result;
        }

        // If database default is to be resolved
        if (def.surreal.field.default && payload.value === undefined) {
          if (!ctx.db) {
            return payload;
          }

          return ctx.db
            .query<[unknown]>(
              `{ ${inlineQueryParameters(def.surreal.field.default.value)} }`,
            )
            .then(([result]) => {
              payload.value = result;

              // $prefault() does validation on the resolved value
              if (def.surreal.field.default?.parse) {
                return def.innerType._zod.run(payload, ctx);
              }

              /**
               * $default() returns the default value immediately in forward direction.
               * It doesn't pass the default value into the validator ("prefault").
               * There's no reason to pass the default value through validation.
               * The validity of the default is enforced by TypeScript statically.
               * Otherwise, it's the responsibility of the user to ensure the default is valid.
               * In the case of pipes with divergent in/out types, you can specify
               * the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.
               */
              return payload;
            });
        }

        return def.innerType._zod.run(payload, ctx);
      };
    }

    return inst;
  });

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealString      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealStringDef extends ZodSurrealTypeDef {
  type: "string";
  coerce?: boolean;
  checks?: core.$ZodCheck<string>[];
  surreal: {
    type: "string" | "uuid";
  };
}

export interface ZodSurrealStringInternals<Input, DBInput = Input>
  extends ZodSurrealTypeInternals<string, Input, string, DBInput> {
  def: ZodSurrealStringDef;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;

  /** @deprecated Internal API, use with caution (not deprecated) */
  isst: core.$ZodIssueInvalidType;
  bag: core.util.LoosePartial<{
    minimum: number;
    maximum: number;
    patterns: Set<RegExp>;
    format: string;
    contentEncoding: string;
  }>;
}

// Base String

export interface _ZodSurrealString<
  Internals extends
  ZodSurrealStringInternals<unknown> = ZodSurrealStringInternals<unknown>,
> extends _ZodSurrealType<Internals>,
  ZodSurrealFieldMethods {
  format: string | null;
  minLength: number | null;
  maxLength: number | null;

  // miscellaneous checks
  regex(regex: RegExp, params?: string | core.$ZodCheckRegexParams): this;
  includes(value: string, params?: string | core.$ZodCheckIncludesParams): this;
  startsWith(
    value: string,
    params?: string | core.$ZodCheckStartsWithParams,
  ): this;
  endsWith(value: string, params?: string | core.$ZodCheckEndsWithParams): this;
  min(minLength: number, params?: string | core.$ZodCheckMinLengthParams): this;
  max(maxLength: number, params?: string | core.$ZodCheckMaxLengthParams): this;
  length(len: number, params?: string | core.$ZodCheckLengthEqualsParams): this;
  nonempty(params?: string | core.$ZodCheckMinLengthParams): this;
  lowercase(params?: string | core.$ZodCheckLowerCaseParams): this;
  uppercase(params?: string | core.$ZodCheckUpperCaseParams): this;

  // transforms
  trim(): this;
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD" | (string & {})): this;
  toLowerCase(): this;
  toUpperCase(): this;
  slugify(): this;
}

export const _ZodSurrealString: core.$constructor<_ZodSurrealString> =
  core.$constructor("_ZodSurrealString", (inst, def) => {
    // @ts-expect-error
    core.$ZodString.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.string(inst as any, ctx, json, params);

    def.surreal.type ??= "string";
    const bag = inst._zod.bag;
    inst.format = bag.format ?? null;
    inst.minLength = bag.minimum ?? null;
    inst.maxLength = bag.maximum ?? null;

    // validations
    inst.regex = (...args) => inst.check(core._regex(...args));
    inst.includes = (...args) => inst.check(core._includes(...args));
    inst.startsWith = (...args) => inst.check(core._startsWith(...args));
    inst.endsWith = (...args) => inst.check(core._endsWith(...args));
    inst.min = (...args) => inst.check(core._minLength(...args));
    inst.max = (...args) => inst.check(core._maxLength(...args));
    inst.length = (...args) => inst.check(core._length(...args));
    inst.nonempty = (...args) => inst.check(core._minLength(1, ...args));
    inst.lowercase = (params) => inst.check(core._lowercase(params));
    inst.uppercase = (params) => inst.check(core._uppercase(params));

    // transforms
    inst.trim = () => inst.check(core._trim());
    inst.normalize = (...args) => inst.check(core._normalize(...args));
    inst.toLowerCase = () => inst.check(core._toLowerCase());
    inst.toUpperCase = () => inst.check(core._toUpperCase());
    inst.slugify = () => inst.check(core._slugify());

    return inst;
  });

// String w/ Formats

export interface ZodSurrealString
  extends _ZodSurrealString<ZodSurrealStringInternals<string>> {
  // string format checks
  /** @deprecated Use `z.email()` instead. */
  email(params?: string | core.$ZodCheckEmailParams): this;
  /** @deprecated Use `z.url()` instead. */
  url(params?: string | core.$ZodCheckURLParams): this;
  /** @deprecated Use `z.jwt()` instead. */
  jwt(params?: string | core.$ZodCheckJWTParams): this;
  /** @deprecated Use `z.emoji()` instead. */
  emoji(params?: string | core.$ZodCheckEmojiParams): this;
  /** @deprecated Use `z.guid()` instead. */
  guid(params?: string | core.$ZodCheckGUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuid(params?: string | core.$ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv4(params?: string | core.$ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv6(params?: string | core.$ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv7(params?: string | core.$ZodCheckUUIDParams): this;
  /** @deprecated Use `z.nanoid()` instead. */
  nanoid(params?: string | core.$ZodCheckNanoIDParams): this;
  /** @deprecated Use `z.guid()` instead. */
  guid(params?: string | core.$ZodCheckGUIDParams): this;
  /** @deprecated Use `z.cuid()` instead. */
  cuid(params?: string | core.$ZodCheckCUIDParams): this;
  /** @deprecated Use `z.cuid2()` instead. */
  cuid2(params?: string | core.$ZodCheckCUID2Params): this;
  /** @deprecated Use `z.ulid()` instead. */
  ulid(params?: string | core.$ZodCheckULIDParams): this;
  /** @deprecated Use `z.base64()` instead. */
  base64(params?: string | core.$ZodCheckBase64Params): this;
  /** @deprecated Use `z.base64url()` instead. */
  base64url(params?: string | core.$ZodCheckBase64URLParams): this;
  // /** @deprecated Use `z.jsonString()` instead. */
  // jsonString(params?: string | core.$ZodCheckJSONStringParams): this;
  /** @deprecated Use `z.xid()` instead. */
  xid(params?: string | core.$ZodCheckXIDParams): this;
  /** @deprecated Use `z.ksuid()` instead. */
  ksuid(params?: string | core.$ZodCheckKSUIDParams): this;
  // /** @deprecated Use `z.ipv4()` or `z.ipv6()` instead. */
  // ip(params?: string | (core.$ZodCheckIPv4Params & { version?: "v4" | "v6" })): ZodUnion<[this, this]>;
  /** @deprecated Use `z.ipv4()` instead. */
  ipv4(params?: string | core.$ZodCheckIPv4Params): this;
  /** @deprecated Use `z.ipv6()` instead. */
  ipv6(params?: string | core.$ZodCheckIPv6Params): this;
  /** @deprecated Use `z.cidrv4()` instead. */
  cidrv4(params?: string | core.$ZodCheckCIDRv4Params): this;
  /** @deprecated Use `z.cidrv6()` instead. */
  cidrv6(params?: string | core.$ZodCheckCIDRv6Params): this;
  /** @deprecated Use `z.e164()` instead. */
  e164(params?: string | core.$ZodCheckE164Params): this;
  // // ISO 8601 checks
  // /** @deprecated Use `z.iso.datetime()` instead. */
  // datetime(params?: string | core.$ZodCheckISODateTimeParams): this;
  // /** @deprecated Use `z.iso.date()` instead. */
  // date(params?: string | core.$ZodCheckISODateParams): this;
  // /** @deprecated Use `z.iso.time()` instead. */
  // time(
  //   params?:
  //     | string
  //     // | {
  //     //     message?: string | undefined;
  //     //     precision?: number | null;
  //     //   }
  //     | core.$ZodCheckISOTimeParams,
  // ): this;
  // /** @deprecated Use `z.iso.duration()` instead. */
  // duration(params?: string | core.$ZodCheckISODurationParams): this;
}

export const ZodSurrealString: core.$constructor<ZodSurrealString> =
  core.$constructor("ZodSurrealString", (inst, def) => {
    _ZodSurrealString.init(inst, def);

    inst.email = (params) =>
      inst.check(core._email(ZodSurrealEmail as any, params));
    inst.url = (params) => inst.check(url(params as any) as any);
    inst.jwt = (params) => inst.check(jwt(params as any));
    inst.emoji = (params) => inst.check(emoji(params as any));
    inst.guid = (params) => inst.check(guid(params as any) as any);
    inst.uuid = (params) => inst.check(uuid(params as any) as any);
    inst.uuidv4 = (params) => inst.check(uuidv4(params as any) as any);
    inst.uuidv6 = (params) => inst.check(uuidv6(params as any) as any);
    inst.uuidv7 = (params) => inst.check(uuidv7(params as any) as any);
    inst.nanoid = (params) => inst.check(nanoid(params as any));
    inst.guid = (params) => inst.check(guid(params as any) as any);
    inst.cuid = (params) => inst.check(cuid(params as any));
    inst.cuid2 = (params) => inst.check(cuid2(params as any));
    inst.ulid = (params) => inst.check(ulid(params as any));
    inst.base64 = (params) => inst.check(base64(params as any));
    inst.base64url = (params) => inst.check(base64url(params as any));
    inst.xid = (params) => inst.check(xid(params as any));
    inst.ksuid = (params) => inst.check(ksuid(params as any));
    inst.ipv4 = (params) => inst.check(ipv4(params as any));
    inst.ipv6 = (params) => inst.check(ipv6(params as any));
    inst.cidrv4 = (params) => inst.check(cidrv4(params as any));
    inst.cidrv6 = (params) => inst.check(cidrv6(params as any));
    inst.e164 = (params) => inst.check(e164(params as any));

    return inst;
  });

export function string(
  params?: string | core.$ZodStringParams,
): ZodSurrealString;
export function string<T extends string>(
  params?: string | core.$ZodStringParams,
): ZodSurrealType<T, T>;
export function string(
  params?: string | core.$ZodStringParams,
): ZodSurrealString {
  return new ZodSurrealString({
    type: "string",
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealStringFormat

export interface ZodSurrealStringFormatDef<Format extends string = string>
  extends ZodSurrealStringDef,
  core.$ZodCheckStringFormatDef<Format> { }

export interface ZodSurrealStringFormatInternals<Format extends string = string>
  extends ZodSurrealStringInternals<string>,
  core.$ZodCheckStringFormatInternals {
  def: ZodSurrealStringFormatDef<Format>;
}

export interface ZodSurrealStringFormat<Format extends string = string>
  extends _ZodSurrealString<ZodSurrealStringFormatInternals<Format>> { }
export const ZodSurrealStringFormat: core.$constructor<ZodSurrealStringFormat> =
  core.$constructor("ZodSurrealStringFormat", (inst, def) => {
    // @ts-expect-error
    core.$ZodStringFormat.init(inst, def);
    _ZodSurrealString.init(inst, def);
  });

// ZodSurrealEmail
export interface ZodSurrealEmail extends ZodSurrealStringFormat<"email"> { }
export const ZodSurrealEmail: core.$constructor<ZodSurrealEmail> =
  core.$constructor("ZodSurrealEmail", (inst, def) => {
    // @ts-expect-error
    core.$ZodEmail.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function email(params?: string | core.$ZodEmailParams): ZodSurrealEmail {
  return new ZodSurrealEmail({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealGUID
export interface ZodSurrealGUIDInternals
  extends ZodSurrealStringInternals<string | Uuid> {
  def: ZodSurrealStringFormatDef<"guid">;
}
export interface ZodSurrealGUID
  extends _ZodSurrealString<ZodSurrealGUIDInternals> { }
export const ZodSurrealGUID: core.$constructor<ZodSurrealGUID> =
  core.$constructor("ZodSurrealGUID", (inst, def) => {
    // @ts-expect-error
    core.$ZodGUID.init(inst, def);
    // @ts-expect-error
    ZodSurrealStringFormat.init(inst, def);

    const originalParse = inst._zod.parse;
    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof Uuid) {
        payload.value = payload.value.toString();
      }

      return originalParse(payload, ctx);
    };
  });

export function guid(params?: string | core.$ZodGUIDParams): ZodSurrealGUID {
  return new ZodSurrealGUID({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    // TODO: Use surreal uuid type instead
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealUUID
export interface ZodSurrealUUIDInternals
  extends ZodSurrealStringInternals<string | Uuid> {
  def: ZodSurrealStringFormatDef<"uuid">;
}
export interface ZodSurrealUUID
  extends _ZodSurrealString<ZodSurrealUUIDInternals> { }
export const ZodSurrealUUID: core.$constructor<ZodSurrealUUID> =
  core.$constructor("ZodSurrealUUID", (inst, def) => {
    // @ts-expect-error
    core.$ZodUUID.init(inst, def);
    // @ts-expect-error
    ZodSurrealStringFormat.init(inst, def);

    const originalParse = inst._zod.parse;
    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof Uuid) {
        payload.value = payload.value.toString();
      }

      return originalParse(payload, ctx);
    };
  });

export function uuid(params?: string | core.$ZodUUIDParams): ZodSurrealUUID {
  return new ZodSurrealUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    // TODO: Use surreal uuid type instead
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

export function uuidv4(
  params?: string | core.$ZodUUIDv4Params,
): ZodSurrealUUID {
  return new ZodSurrealUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    // TODO: Use surreal uuid type instead
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealUUIDv6
export function uuidv6(
  params?: string | core.$ZodUUIDv6Params,
): ZodSurrealUUID {
  return new ZodSurrealUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    // TODO: Use surreal uuid type instead
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealUUIDv7
export function uuidv7(
  params?: string | core.$ZodUUIDv7Params,
): ZodSurrealUUID {
  return new ZodSurrealUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    // TODO: Use surreal uuid type instead
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealURL
export interface ZodSurrealURLInternals
  extends ZodSurrealStringInternals<string | URL> {
  def: ZodSurrealStringFormatDef<"url">;
}
export interface ZodSurrealURL
  extends _ZodSurrealString<ZodSurrealURLInternals> { }
export const ZodSurrealURL: core.$constructor<ZodSurrealURL> =
  core.$constructor("ZodSurrealURL", (inst, def) => {
    // @ts-expect-error
    core.$ZodURL.init(inst, def);
    // @ts-expect-error
    ZodSurrealStringFormat.init(inst, def);

    const originalParse = inst._zod.parse;
    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof URL) {
        payload.value = payload.value.toString();
      }

      return originalParse(payload, ctx);
    };
  });

export function url(params?: string | core.$ZodURLParams): ZodSurrealURL {
  return new ZodSurrealURL({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealEmoji
export interface ZodSurrealEmoji extends ZodSurrealStringFormat<"emoji"> { }
export const ZodSurrealEmoji: core.$constructor<ZodSurrealEmoji> =
  core.$constructor("ZodSurrealEmoji", (inst, def) => {
    // @ts-expect-error
    core.$ZodEmoji.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function emoji(params?: string | core.$ZodEmojiParams): ZodSurrealEmoji {
  return new ZodSurrealEmoji({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealNanoID
export interface ZodSurrealNanoID extends ZodSurrealStringFormat<"nanoid"> { }
export const ZodSurrealNanoID: core.$constructor<ZodSurrealNanoID> =
  core.$constructor("ZodSurrealNanoID", (inst, def) => {
    // @ts-expect-error
    core.$ZodNanoID.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function nanoid(
  params?: string | core.$ZodNanoIDParams,
): ZodSurrealNanoID {
  return new ZodSurrealNanoID({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealCUID
export interface ZodSurrealCUID extends ZodSurrealStringFormat<"cuid"> { }
export const ZodSurrealCUID: core.$constructor<ZodSurrealCUID> =
  core.$constructor("ZodSurrealCUID", (inst, def) => {
    // @ts-expect-error
    core.$ZodCUID.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function cuid(params?: string | core.$ZodCUIDParams): ZodSurrealCUID {
  return new ZodSurrealCUID({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealCUID2
export interface ZodSurrealCUID2 extends ZodSurrealStringFormat<"cuid2"> { }
export const ZodSurrealCUID2: core.$constructor<ZodSurrealCUID2> =
  core.$constructor("ZodSurrealCUID2", (inst, def) => {
    // @ts-expect-error
    core.$ZodCUID2.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function cuid2(params?: string | core.$ZodCUID2Params): ZodSurrealCUID2 {
  return new ZodSurrealCUID2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealULID
export interface ZodSurrealULID extends ZodSurrealStringFormat<"ulid"> { }
export const ZodSurrealULID: core.$constructor<ZodSurrealULID> =
  core.$constructor("ZodSurrealULID", (inst, def) => {
    // @ts-expect-error
    core.$ZodULID.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function ulid(params?: string | core.$ZodULIDParams): ZodSurrealULID {
  return new ZodSurrealULID({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealXID
export interface ZodSurrealXID extends ZodSurrealStringFormat<"xid"> { }
export const ZodSurrealXID: core.$constructor<ZodSurrealXID> =
  core.$constructor("ZodSurrealXID", (inst, def) => {
    // @ts-expect-error
    core.$ZodXID.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function xid(params?: string | core.$ZodXIDParams): ZodSurrealXID {
  return new ZodSurrealXID({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealKSUID
export interface ZodSurrealKSUID extends ZodSurrealStringFormat<"ksuid"> { }
export const ZodSurrealKSUID: core.$constructor<ZodSurrealKSUID> =
  core.$constructor("ZodSurrealKSUID", (inst, def) => {
    // @ts-expect-error
    core.$ZodKSUID.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function ksuid(params?: string | core.$ZodKSUIDParams): ZodSurrealKSUID {
  return new ZodSurrealKSUID({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodIP
// export interface ZodIP extends ZodStringFormat<"ip"> {
//   _zod: core.$ZodIPInternals;
// }
// export const ZodIP: core.$constructor<ZodIP> = /*@__PURE__*/ core.$constructor("ZodIP", (inst, def) => {
//   // ZodStringFormat.init(inst, def);
//   core.$ZodIP.init(inst, def);
//   ZodStringFormat.init(inst, def);
// });

// export function ip(params?: string | core.$ZodIPParams): ZodIP {
//   return core._ip(ZodIP, params);
// }

// ZodSurrealIPv4
export interface ZodSurrealIPv4 extends ZodSurrealStringFormat<"ipv4"> { }
export const ZodSurrealIPv4: core.$constructor<ZodSurrealIPv4> =
  core.$constructor("ZodSurrealIPv4", (inst, def) => {
    // @ts-expect-error
    core.$ZodIPv4.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function ipv4(params?: string | core.$ZodIPv4Params): ZodSurrealIPv4 {
  return new ZodSurrealIPv4({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealMAC
export interface ZodSurrealMAC extends ZodSurrealStringFormat<"mac"> { }
export const ZodSurrealMAC: core.$constructor<ZodSurrealMAC> =
  core.$constructor("ZodSurrealMAC", (inst, def) => {
    // @ts-expect-error
    core.$ZodMAC.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });
export function mac(params?: string | core.$ZodMACParams): ZodSurrealMAC {
  return new ZodSurrealMAC({
    type: "string",
    format: "mac",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealIPv6
export interface ZodSurrealIPv6 extends ZodSurrealStringFormat<"ipv6"> { }
export const ZodSurrealIPv6: core.$constructor<ZodSurrealIPv6> =
  core.$constructor("ZodSurrealIPv6", (inst, def) => {
    // @ts-expect-error
    core.$ZodIPv6.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });
export function ipv6(params?: string | core.$ZodIPv6Params): ZodSurrealIPv6 {
  return new ZodSurrealIPv6({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealCIDRv4
export interface ZodSurrealCIDRv4 extends ZodSurrealStringFormat<"cidrv4"> { }
export const ZodSurrealCIDRv4: core.$constructor<ZodSurrealCIDRv4> =
  core.$constructor("ZodSurrealCIDRv4", (inst, def) => {
    // @ts-expect-error
    core.$ZodCIDRv4.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function cidrv4(
  params?: string | core.$ZodCIDRv4Params,
): ZodSurrealCIDRv4 {
  return new ZodSurrealCIDRv4({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealCIDRv6
export interface ZodSurrealCIDRv6 extends ZodSurrealStringFormat<"cidrv6"> { }
export const ZodSurrealCIDRv6: core.$constructor<ZodSurrealCIDRv6> =
  core.$constructor("ZodSurrealCIDRv6", (inst, def) => {
    // @ts-expect-error
    core.$ZodCIDRv6.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function cidrv6(
  params?: string | core.$ZodCIDRv6Params,
): ZodSurrealCIDRv6 {
  return new ZodSurrealCIDRv6({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealBase64
export interface ZodSurrealBase64 extends ZodSurrealStringFormat<"base64"> { }
export const ZodSurrealBase64: core.$constructor<ZodSurrealBase64> =
  core.$constructor("ZodSurrealBase64", (inst, def) => {
    // @ts-expect-error
    core.$ZodBase64.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });
export function base64(
  params?: string | core.$ZodBase64Params,
): ZodSurrealBase64 {
  return new ZodSurrealBase64({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealBase64URL
export interface ZodSurrealBase64URL
  extends ZodSurrealStringFormat<"base64url"> { }
export const ZodSurrealBase64URL: core.$constructor<ZodSurrealBase64URL> =
  core.$constructor("ZodSurrealBase64URL", (inst, def) => {
    // @ts-expect-error
    core.$ZodBase64URL.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });
export function base64url(
  params?: string | core.$ZodBase64URLParams,
): ZodSurrealBase64URL {
  return new ZodSurrealBase64URL({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealE164
export interface ZodSurrealE164 extends ZodSurrealStringFormat<"e164"> { }
export const ZodSurrealE164: core.$constructor<ZodSurrealE164> =
  core.$constructor("ZodSurrealE164", (inst, def) => {
    // @ts-expect-error
    core.$ZodE164.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function e164(params?: string | core.$ZodE164Params): ZodSurrealE164 {
  return new ZodSurrealE164({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealJWT
export interface ZodSurrealJWT extends ZodSurrealStringFormat<"jwt"> { }
export const ZodSurrealJWT: core.$constructor<ZodSurrealJWT> =
  core.$constructor("ZodSurrealJWT", (inst, def) => {
    // @ts-expect-error
    core.$ZodJWT.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });

export function jwt(params?: string | core.$ZodJWTParams): ZodSurrealJWT {
  return new ZodSurrealJWT({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: { type: "string" },
  });
}

// ZodSurrealCustomStringFormat
export interface ZodSurrealCustomStringFormatDef<Format extends string = string>
  extends ZodSurrealStringFormatDef<Format> {
  fn: (val: string) => unknown;
}
export interface ZodSurrealCustomStringFormatInternals<
  Format extends string = string,
> extends ZodSurrealStringFormatInternals<Format> {
  def: ZodSurrealCustomStringFormatDef<Format>;
}
export interface ZodSurrealCustomStringFormat<Format extends string = string>
  extends ZodSurrealStringFormat<Format> {
  _zod: ZodSurrealCustomStringFormatInternals<Format>;
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodSurrealCustomStringFormat: core.$constructor<ZodSurrealCustomStringFormat> =
  core.$constructor("ZodSurrealCustomStringFormat", (inst, def) => {
    // @ts-expect-error
    core.$ZodCustomStringFormat.init(inst, def);
    ZodSurrealStringFormat.init(inst, def);
  });
export function stringFormat<Format extends string>(
  format: Format,
  fnOrRegex: ((arg: string) => core.util.MaybeAsync<unknown>) | RegExp,
  _params: string | core.$ZodStringFormatParams = {},
): ZodSurrealCustomStringFormat<Format> {
  const params = _core_.normalizeParams(_params, { type: "string" });
  const def: ZodSurrealCustomStringFormatDef = {
    ..._core_.normalizeParams(_params, { type: "string" }),
    check: "string_format",
    type: "string",
    format,
    fn:
      typeof fnOrRegex === "function"
        ? fnOrRegex
        : (val) => fnOrRegex.test(val),
    ...params,
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }

  const inst = new ZodSurrealCustomStringFormat(def);
  return inst as any;
}

export function hostname(
  _params?: string | core.$ZodStringFormatParams,
): ZodSurrealCustomStringFormat<"hostname"> {
  return stringFormat("hostname", core.regexes.hostname, _params);
}

export function hex(
  _params?: string | core.$ZodStringFormatParams,
): ZodSurrealCustomStringFormat<"hex"> {
  return stringFormat("hex", core.regexes.hex, _params);
}

export function hash<
  Alg extends core.util.HashAlgorithm,
  Enc extends core.util.HashEncoding = "hex",
>(
  alg: Alg,
  params?: {
    enc?: Enc;
  } & core.$ZodStringFormatParams,
): ZodSurrealCustomStringFormat<`${Alg}_${Enc}`> {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}` as const;
  const regex = core.regexes[format as keyof typeof core.regexes] as RegExp;
  if (!regex) throw new Error(`Unrecognized hash format: ${format}`);
  return stringFormat(format, regex, params) as any;
}

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealNumber      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealNumberDef extends ZodSurrealTypeDef {
  type: "number";
  coerce?: boolean;
  // checks: checks.$ZodCheck<number>[];
  surreal: {
    type: "number" | "int" | "float";
  };
}

export interface ZodSurrealNumberInternals<Input = unknown, DBInput = Input>
  extends ZodSurrealTypeInternals<number, Input, number, DBInput> {
  def: ZodSurrealNumberDef;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;
  /** @deprecated Internal API, use with caution (not deprecated) */
  isst: core.$ZodIssueInvalidType;
  bag: core.util.LoosePartial<{
    minimum: number;
    maximum: number;
    exclusiveMinimum: number;
    exclusiveMaximum: number;
    format: string;
    pattern: RegExp;
  }>;
}

// Base Number

export interface _ZodSurrealNumber<
  Internals extends ZodSurrealNumberInternals = ZodSurrealNumberInternals,
> extends _ZodSurrealType<Internals> {
  gt(value: number, params?: string | core.$ZodCheckGreaterThanParams): this;
  gte(value: number, params?: string | core.$ZodCheckGreaterThanParams): this;
  /** Alias of `.gte()` */
  min(value: number, params?: string | core.$ZodCheckGreaterThanParams): this;
  lt(value: number, params?: string | core.$ZodCheckLessThanParams): this;
  lte(value: number, params?: string | core.$ZodCheckLessThanParams): this;
  /** Alias of `.lte()` */
  max(value: number, params?: string | core.$ZodCheckLessThanParams): this;
  /** Consider `z.int()` instead. This API is considered *legacy*; it will never be removed but a better alternative exists. */
  int(params?: string | core.$ZodCheckNumberFormatParams): this;
  /** @deprecated This is now identical to `.int()`. Only numbers in the safe integer range are accepted. */
  safe(params?: string | core.$ZodCheckNumberFormatParams): this;
  positive(params?: string | core.$ZodCheckGreaterThanParams): this;
  nonnegative(params?: string | core.$ZodCheckGreaterThanParams): this;
  negative(params?: string | core.$ZodCheckLessThanParams): this;
  nonpositive(params?: string | core.$ZodCheckLessThanParams): this;
  multipleOf(
    value: number,
    params?: string | core.$ZodCheckMultipleOfParams,
  ): this;
  /** @deprecated Use `.multipleOf()` instead. */
  step(value: number, params?: string | core.$ZodCheckMultipleOfParams): this;

  /** @deprecated In v4 and later, z.number() does not allow infinite values by default. This is a no-op. */
  finite(params?: unknown): this;

  minValue: number | null;
  maxValue: number | null;
  /** @deprecated Check the `format` property instead.  */
  isInt: boolean;
  /** @deprecated Number schemas no longer accept infinite values, so this always returns `true`. */
  isFinite: boolean;
  format: string | null;
}

export interface ZodSurrealNumber
  extends _ZodSurrealNumber<ZodSurrealNumberInternals<number>>,
  ZodSurrealFieldMethods { }

export const ZodSurrealNumber: core.$constructor<ZodSurrealNumber> =
  core.$constructor("ZodSurrealNumber", (inst, def) => {
    // @ts-expect-error
    core.$ZodNumber.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.number(inst as any, ctx, json, params);

    inst.gt = (value, params) => inst.check(core._gt(value, params));
    inst.gte = (value, params) => inst.check(core._gte(value, params));
    inst.min = (value, params) => inst.check(core._gte(value, params));
    inst.lt = (value, params) => inst.check(core._lt(value, params));
    inst.lte = (value, params) => inst.check(core._lte(value, params));
    inst.max = (value, params) => inst.check(core._lte(value, params));
    inst.int = (params) => inst.check(int(params));
    inst.safe = (params) => inst.check(int(params));
    inst.positive = (params) => inst.check(core._gt(0, params));
    inst.nonnegative = (params) => inst.check(core._gte(0, params));
    inst.negative = (params) => inst.check(core._lt(0, params));
    inst.nonpositive = (params) => inst.check(core._lte(0, params));
    inst.multipleOf = (value, params) =>
      inst.check(core._multipleOf(value, params));
    inst.step = (value, params) => inst.check(core._multipleOf(value, params));

    // inst.finite = (params) => inst.check(core.finite(params));
    inst.finite = () => inst;

    def.surreal.type ??= "number";

    const bag = inst._zod.bag;
    inst.minValue =
      Math.max(
        bag.minimum ?? Number.NEGATIVE_INFINITY,
        bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY,
      ) ?? null;
    inst.maxValue =
      Math.min(
        bag.maximum ?? Number.POSITIVE_INFINITY,
        bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY,
      ) ?? null;
    inst.isInt =
      (bag.format ?? "").includes("int") ||
      Number.isSafeInteger(bag.multipleOf ?? 0.5);
    inst.isFinite = true;
    inst.format = bag.format ?? null;
  });

export function number(
  params?: string | core.$ZodNumberParams,
): ZodSurrealNumber {
  return new ZodSurrealNumber({
    type: "number",
    checks: [],
    ...core.util.normalizeParams(params),
    surreal: { type: "number" },
  });
}

// ZodNumberFormat

export interface ZodSurrealNumberFormatDef
  extends ZodSurrealNumberDef,
  core.$ZodCheckNumberFormatDef { }

export interface ZodSurrealNumberFormatInternals
  extends ZodSurrealNumberInternals<number>,
  core.$ZodCheckNumberFormatInternals {
  def: ZodSurrealNumberFormatDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealNumberFormat extends ZodSurrealNumber {
  _zod: ZodSurrealNumberFormatInternals;
}
export const ZodSurrealNumberFormat: core.$constructor<ZodSurrealNumberFormat> =
  core.$constructor("ZodSurrealNumberFormat", (inst, def) => {
    // @ts-expect-error
    core.$ZodNumberFormat.init(inst, def);
    ZodSurrealNumber.init(inst, def);
  });

// int
export interface ZodSurrealInt extends ZodSurrealNumberFormat { }
export function int(
  params?: string | core.$ZodCheckNumberFormatParams,
): ZodSurrealInt {
  return new ZodSurrealNumberFormat({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

// float32
export interface ZodSurrealFloat32 extends ZodSurrealNumberFormat { }
export function float32(
  params?: string | core.$ZodCheckNumberFormatParams,
): ZodSurrealFloat32 {
  return new ZodSurrealNumberFormat({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...core.util.normalizeParams(params),
    surreal: { type: "float" },
  });
}

// float64
export interface ZodSurrealFloat64 extends ZodSurrealNumberFormat { }
export function float64(
  params?: string | core.$ZodCheckNumberFormatParams,
): ZodSurrealFloat64 {
  return new ZodSurrealNumberFormat({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...core.util.normalizeParams(params),
    surreal: { type: "float" },
  });
}

// int32
export interface ZodSurrealInt32 extends ZodSurrealNumberFormat { }
export function int32(
  params?: string | core.$ZodCheckNumberFormatParams,
): ZodSurrealInt32 {
  return new ZodSurrealNumberFormat({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

// uint32
export interface ZodSurrealUInt32 extends ZodSurrealNumberFormat { }
export function uint32(
  params?: string | core.$ZodCheckNumberFormatParams,
): ZodSurrealUInt32 {
  return new ZodSurrealNumberFormat({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealBoolean      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealBooleanDef extends ZodSurrealTypeDef {
  type: "boolean";
  coerce?: boolean;
  checks?: core.$ZodCheck<boolean>[];
  surreal: {
    type: "bool";
  };
}

export interface ZodSurrealBooleanInternals<Input = unknown, DBInput = Input>
  extends ZodSurrealTypeInternals<boolean, Input, boolean, DBInput> {
  pattern: RegExp;
  def: ZodSurrealBooleanDef;
  isst: core.$ZodIssueInvalidType;
}

export interface _ZodSurrealBoolean<
  T extends ZodSurrealBooleanInternals = ZodSurrealBooleanInternals,
> extends _ZodSurrealType<T> { }
export interface ZodSurrealBoolean
  extends _ZodSurrealBoolean<ZodSurrealBooleanInternals<boolean>>,
  ZodSurrealFieldMethods { }
export const ZodSurrealBoolean: core.$constructor<ZodSurrealBoolean> =
  core.$constructor("ZodBoolean", (inst, def) => {
    // @ts-expect-error
    core.$ZodBoolean.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.boolean(inst as any, ctx, json, params);

    def.surreal.type ??= "bool";
  });

export function boolean(
  params?: string | core.$ZodBooleanParams,
): ZodSurrealBoolean {
  return new ZodSurrealBoolean({
    type: "boolean",
    ...core.util.normalizeParams(params),
    surreal: { type: "bool" },
  });
}

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealBigInt      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealBigIntDef extends ZodSurrealTypeDef {
  type: "bigint";
  coerce?: boolean;
  // checks: checks.$ZodCheck<bigint>[];
  surreal: {
    type: "int";
  };
}

export interface ZodSurrealBigIntInternals<Input = unknown, DBInput = Input>
  extends ZodSurrealTypeInternals<bigint, Input, bigint, DBInput> {
  pattern: RegExp;
  /** @internal Internal API, use with caution */
  def: ZodSurrealBigIntDef;
  isst: core.$ZodIssueInvalidType;
  bag: core.util.LoosePartial<{
    minimum: bigint;
    maximum: bigint;
    format: string;
  }>;
}

export interface _ZodSurrealBigInt<
  Internals extends ZodSurrealBigIntInternals = ZodSurrealBigIntInternals,
> extends _ZodSurrealType<Internals> {
  gte(value: bigint, params?: string | core.$ZodCheckGreaterThanParams): this;
  /** Alias of `.gte()` */
  min(value: bigint, params?: string | core.$ZodCheckGreaterThanParams): this;
  gt(value: bigint, params?: string | core.$ZodCheckGreaterThanParams): this;
  lte(value: bigint, params?: string | core.$ZodCheckLessThanParams): this;
  /** Alias of `.lte()` */
  max(value: bigint, params?: string | core.$ZodCheckLessThanParams): this;
  lt(value: bigint, params?: string | core.$ZodCheckLessThanParams): this;
  positive(params?: string | core.$ZodCheckGreaterThanParams): this;
  negative(params?: string | core.$ZodCheckLessThanParams): this;
  nonpositive(params?: string | core.$ZodCheckLessThanParams): this;
  nonnegative(params?: string | core.$ZodCheckGreaterThanParams): this;
  multipleOf(
    value: bigint,
    params?: string | core.$ZodCheckMultipleOfParams,
  ): this;

  minValue: bigint | null;
  maxValue: bigint | null;
  format: string | null;
}

export interface ZodSurrealBigInt
  extends _ZodSurrealBigInt<ZodSurrealBigIntInternals<bigint>>,
  ZodSurrealFieldMethods { }
export const ZodSurrealBigInt: core.$constructor<ZodSurrealBigInt> =
  core.$constructor("ZodSurrealBigInt", (inst, def) => {
    // @ts-expect-error
    core.$ZodBigInt.init(inst, def);
    ZodSurrealType.init(inst, def);
    // @ts-expect-error
    ZodSurrealField.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.bigint(inst as any, ctx, json, params);

    inst.gte = (value, params) => inst.check(core._gte(value, params));
    inst.min = (value, params) => inst.check(core._gte(value, params));
    inst.gt = (value, params) => inst.check(core._gt(value, params));
    inst.gte = (value, params) => inst.check(core._gte(value, params));
    inst.min = (value, params) => inst.check(core._gte(value, params));
    inst.lt = (value, params) => inst.check(core._lt(value, params));
    inst.lte = (value, params) => inst.check(core._lte(value, params));
    inst.max = (value, params) => inst.check(core._lte(value, params));
    inst.positive = (params) => inst.check(core._gt(BigInt(0), params));
    inst.negative = (params) => inst.check(core._lt(BigInt(0), params));
    inst.nonpositive = (params) => inst.check(core._lte(BigInt(0), params));
    inst.nonnegative = (params) => inst.check(core._gte(BigInt(0), params));
    inst.multipleOf = (value, params) =>
      inst.check(core._multipleOf(value, params));

    def.surreal.type ??= "int";
    const bag = inst._zod.bag;
    inst.minValue = bag.minimum ?? null;
    inst.maxValue = bag.maximum ?? null;
    inst.format = bag.format ?? null;
  });

export function bigint(
  params?: string | core.$ZodBigIntParams,
): ZodSurrealBigInt {
  return new ZodSurrealBigInt({
    type: "bigint",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

// ZodBigIntFormat

interface ZodSurrealBigIntFormatDef
  extends ZodSurrealBigIntDef,
  core.$ZodCheckBigIntFormatDef {
  check: "bigint_format";
}

export interface ZodSurrealBigIntFormatInternals
  extends ZodSurrealBigIntInternals<bigint>,
  core.$ZodCheckBigIntFormatInternals {
  def: ZodSurrealBigIntFormatDef;
}
export interface ZodSurrealBigIntFormat extends ZodSurrealBigInt {
  _zod: ZodSurrealBigIntFormatInternals;
}
export const ZodSurrealBigIntFormat: core.$constructor<ZodSurrealBigIntFormat> =
  core.$constructor("ZodSurrealBigIntFormat", (inst, def) => {
    // @ts-expect-error
    core.$ZodBigIntFormat.init(inst, def);
    ZodSurrealBigInt.init(inst, def);
  });

// int64
export function int64(
  params?: string | core.$ZodBigIntFormatParams,
): ZodSurrealBigIntFormat {
  return new ZodSurrealBigIntFormat({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

// uint64
export function uint64(
  params?: string | core.$ZodBigIntFormatParams,
): ZodSurrealBigIntFormat {
  return new ZodSurrealBigIntFormat({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...core.util.normalizeParams(params),
    surreal: { type: "int" },
  });
}

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealSymbol      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealSymbolDef extends ZodSurrealTypeDef {
  type: "symbol";

  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealSymbolInternals
  extends ZodSurrealTypeInternals<symbol, symbol> {
  def: ZodSurrealSymbolDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealSymbol
  extends _ZodSurrealType<ZodSurrealSymbolInternals>,
  ZodSurrealFieldMethods { }
export const ZodSurrealSymbol: core.$constructor<ZodSurrealSymbol> =
  core.$constructor("ZodSurrealSymbol", (inst, def) => {
    // @ts-expect-error
    core.$ZodSymbol.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.symbol(inst as any, ctx, json, params);
  });

export function symbol(
  params?: string | core.$ZodSymbolParams,
): ZodSurrealSymbol {
  return new ZodSurrealSymbol({
    type: "symbol",
    ...core.util.normalizeParams(params),
    surreal: {},
  });
}

///////////////////////////////////////////////////
///////////////////////////////////////////////////
//////////                               //////////
//////////      ZodSurrealUndefined      //////////
//////////                               //////////
///////////////////////////////////////////////////
///////////////////////////////////////////////////

export interface ZodSurrealUndefinedDef extends ZodSurrealTypeDef {
  type: "undefined";

  surreal: {
    type: "none";
  };
}

export interface ZodSurrealUndefinedInternals
  extends ZodSurrealTypeInternals<undefined, undefined>,
  ZodSurrealFieldMethods {
  pattern: RegExp;
  def: ZodSurrealUndefinedDef;
  values: core.util.PrimitiveSet;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealUndefined
  extends _ZodSurrealType<ZodSurrealUndefinedInternals>,
  ZodSurrealFieldMethods { }
export const ZodSurrealUndefined: core.$constructor<ZodSurrealUndefined> =
  core.$constructor("ZodSurrealUndefined", (inst, def) => {
    // @ts-expect-error
    core.$ZodUndefined.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.undefined(inst as any, ctx, json, params);

    def.surreal.type ??= "none";
  });

function _undefined(
  params?: string | core.$ZodUndefinedParams,
): ZodSurrealUndefined {
  return new ZodSurrealUndefined({
    type: "undefined",
    ...core.util.normalizeParams(params),
    surreal: { type: "none" },
  });
}
export { _undefined as undefined };

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealNull      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealNullDef extends ZodSurrealTypeDef {
  type: "null";

  surreal: {
    type: "null";
  };
}

export interface ZodSurrealNullInternals
  extends ZodSurrealTypeInternals<null, null> {
  pattern: RegExp;
  def: ZodSurrealNullDef;
  values: core.util.PrimitiveSet;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealNull
  extends _ZodSurrealType<ZodSurrealNullInternals>,
  ZodSurrealFieldMethods { }
export const ZodSurrealNull: core.$constructor<ZodSurrealNull> =
  core.$constructor("ZodSurrealNull", (inst, def) => {
    // @ts-expect-error
    core.$ZodNull.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.null(inst as any, ctx, json, params);

    def.surreal.type ??= "null";
  });

function _null(params?: string | core.$ZodNullParams): ZodSurrealNull {
  return new ZodSurrealNull({
    type: "null",
    ...core.util.normalizeParams(params),
    surreal: { type: "null" },
  });
}
export { _null as null };

/////////////////////////////////////////////
/////////////////////////////////////////////
//////////                         //////////
//////////      ZodSurrealAny      //////////
//////////                         //////////
/////////////////////////////////////////////
/////////////////////////////////////////////

export interface ZodSurrealAnyDef extends ZodSurrealTypeDef {
  type: "any";
  surreal: {
    type: "any";
  };
}

export interface ZodSurrealAnyInternals
  extends ZodSurrealTypeInternals<any, any> {
  def: ZodSurrealAnyDef;
  isst: never;
}

export interface ZodSurrealAny
  extends _ZodSurrealType<ZodSurrealAnyInternals>,
  ZodSurrealFieldMethods { }

export const ZodSurrealAny: core.$constructor<ZodSurrealAny> =
  core.$constructor("ZodSurrealAny", (inst, def) => {
    // @ts-expect-error
    core.$ZodAny.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.any(inst as any, ctx, json, params);

    def.surreal.type ??= "any";
  });

export function any(): ZodSurrealAny {
  return new ZodSurrealAny({
    type: "any",
    surreal: { type: "any" },
  });
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealUnknown      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealUnknownDef extends ZodSurrealTypeDef {
  type: "unknown";

  surreal: {
    type: "any";
  };
}

export interface ZodSurrealUnknownInternals
  extends ZodSurrealTypeInternals<unknown, unknown> {
  def: ZodSurrealUnknownDef;
  isst: never;
}

export interface ZodSurrealUnknown
  extends _ZodSurrealType<ZodSurrealUnknownInternals>,
  ZodSurrealFieldMethods { }

export const ZodSurrealUnknown: core.$constructor<ZodSurrealUnknown> =
  core.$constructor("ZodSurrealUnknown", (inst, def) => {
    // @ts-expect-error
    core.$ZodUnknown.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.unknown(inst as any, ctx, json, params);

    def.surreal.type ??= "any";
  });

export function unknown(): ZodSurrealUnknown {
  return new ZodSurrealUnknown({
    type: "unknown",
    surreal: { type: "any" },
  });
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealNever      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealNeverDef extends ZodSurrealTypeDef {
  type: "never";

  surreal: {
    type: "none";
  };
}

export interface ZodSurrealNeverInternals
  extends ZodSurrealTypeInternals<unknown, unknown> {
  def: ZodSurrealNeverDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealNever
  extends _ZodSurrealType<ZodSurrealNeverInternals>,
  ZodSurrealFieldMethods { }

export const ZodSurrealNever: core.$constructor<ZodSurrealNever> =
  core.$constructor("ZodSurrealNever", (inst, def) => {
    // @ts-expect-error
    core.$ZodNever.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.never(inst as any, ctx, json, params);

    def.surreal.type = "none";
  });

export function never(params?: string | core.$ZodNeverParams): ZodSurrealNever {
  return new ZodSurrealNever({
    type: "never",
    ...core.util.normalizeParams(params),
    surreal: { type: "none" },
  });
}

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealVoid      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealVoidDef extends ZodSurrealTypeDef {
  type: "void";

  surreal: {
    type: "none";
  };
}

export interface ZodSurrealVoidInternals
  extends ZodSurrealTypeInternals<void, void> {
  def: ZodSurrealVoidDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealVoid
  extends _ZodSurrealType<ZodSurrealVoidInternals>,
  ZodSurrealFieldMethods { }

export const ZodSurrealVoid: core.$constructor<ZodSurrealVoid> =
  core.$constructor("ZodSurrealVoid", (inst, def) => {
    // @ts-expect-error
    core.$ZodVoid.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.void(inst as any, ctx, json, params);

    def.surreal.type ??= "none";
  });

function _void(params?: string | core.$ZodVoidParams): ZodSurrealVoid {
  return new ZodSurrealVoid({
    type: "void",
    ...core.util.normalizeParams(params),
    surreal: { type: "none" },
  });
}
export { _void as void };

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealDate      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

// export interface _ZodDate<T extends core.$ZodDateInternals = core.$ZodDateInternals> extends _ZodType<T> {
//   min(value: number | Date, params?: string | core.$ZodCheckGreaterThanParams): this;
//   max(value: number | Date, params?: string | core.$ZodCheckLessThanParams): this;

//   /** @deprecated Not recommended. */
//   minDate: Date | null;
//   /** @deprecated Not recommended. */
//   maxDate: Date | null;
// }

// export interface ZodDate extends _ZodDate<core.$ZodDateInternals<Date>> {}
// export const ZodDate: core.$constructor<ZodDate> = /*@__PURE__*/ core.$constructor("ZodDate", (inst, def) => {
//   core.$ZodDate.init(inst, def);
//   ZodType.init(inst, def);
//   inst._zod.processJSONSchema = (ctx, json, params) => processors.dateProcessor(inst, ctx, json, params);

//   inst.min = (value, params) => inst.check(checks.gte(value, params));
//   inst.max = (value, params) => inst.check(checks.lte(value, params));

//   const c = inst._zod.bag;
//   inst.minDate = c.minimum ? new Date(c.minimum) : null;
//   inst.maxDate = c.maximum ? new Date(c.maximum) : null;
// });

// export function date(params?: string | core.$ZodDateParams): ZodDate {
//   return core._date(ZodDate, params);
// }

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealDate      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealDateDef extends ZodSurrealTypeDef {
  type: "date";
  coerce?: boolean;

  surreal: {
    type: "datetime";
  };
}

export interface ZodSurrealDateInternals
  extends ZodSurrealTypeInternals<Date, Date | DateTime> {
  def: ZodSurrealDateDef;
  isst: core.$ZodIssueInvalidType; // | core.$ZodIssueInvalidDate;
  bag: core.util.LoosePartial<{
    minimum: Date;
    maximum: Date;
    format: string;
  }>;
}

export interface ZodSurrealDate
  extends _ZodSurrealType<ZodSurrealDateInternals>,
  ZodSurrealFieldMethods {
  min(
    value: number | Date | DateTime,
    params?: string | core.$ZodCheckGreaterThanParams,
  ): this;

  max(
    value: number | Date | DateTime,
    params?: string | core.$ZodCheckLessThanParams,
  ): this;

  /** @deprecated Not recommended. */
  minDate: Date | null;
  /** @deprecated Not recommended. */
  maxDate: Date | null;
}

export const ZodSurrealDate: core.$constructor<ZodSurrealDate> =
  core.$constructor("ZodSurrealDate", (inst, def) => {
    // @ts-expect-error
    core.$ZodDate.init(inst as any, def);
    ZodSurrealType.init(inst, def);
    // @ts-expect-error
    ZodSurrealField.init(inst, def);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.date(inst as any, ctx, json, params);

    inst.min = (value, params) =>
      inst.check(
        core._gte(value instanceof DateTime ? value.toDate() : value, params),
      );
    inst.max = (value, params) =>
      inst.check(
        core._lte(value instanceof DateTime ? value.toDate() : value, params),
      );

    def.surreal.type ??= "datetime";
    const c = inst._zod.bag;
    inst.minDate = c.minimum ? new Date(c.minimum) : null;
    inst.maxDate = c.maximum ? new Date(c.maximum) : null;

    const originalParse = inst._zod.parse;
    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof DateTime) {
        payload.value = payload.value.toDate();
      }

      return originalParse(payload, ctx);
    };
  });

function _date(params?: string | core.$ZodDateParams): ZodSurrealDate {
  return new ZodSurrealDate({
    type: "date",
    ...core.util.normalizeParams(params),
    surreal: { type: "datetime" },
  });
}

export { _date as date };

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealArray     //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealArrayDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "array";
  element: T;

  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealArrayInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<T>[],
  core.input<T>[],
  _core_.dboutput<T>[],
  _core_.dbinput<T>[]
> {
  def: ZodSurrealArrayDef<T>;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealArray<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealArrayInternals<T>>,
  ZodSurrealFieldMethods {
  element: T;
  min(minLength: number, params?: string | core.$ZodCheckMinLengthParams): this;
  nonempty(params?: string | core.$ZodCheckMinLengthParams): this;
  max(maxLength: number, params?: string | core.$ZodCheckMaxLengthParams): this;
  length(len: number, params?: string | core.$ZodCheckLengthEqualsParams): this;

  unwrap(): T;
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}

export const ZodSurrealArray: core.$constructor<ZodSurrealArray> =
  core.$constructor("ZodSurrealArray", (inst, def) => {
    // @ts-expect-error
    core.$ZodArray.init(inst as any, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.array(inst as any, ctx, json, params);

    inst.element = def.element;

    inst.min = (minLength, params) =>
      inst.check(core._minLength(minLength, params));
    inst.nonempty = (params) => inst.check(core._minLength(1, params));
    inst.max = (maxLength, params) =>
      inst.check(core._maxLength(maxLength, params));
    inst.length = (len, params) => inst.check(core._length(len, params));

    inst.unwrap = () => inst.element as any;
  });

export function array<T extends _core_.$ZodSurrealType>(
  element: T,
  params?: string | core.$ZodArrayParams,
): ZodSurrealArray<T> {
  return new ZodSurrealArray({
    type: "array",
    element,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealObject      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealObjectDef<
  Shape extends _core_.$ZodSurrealShape = _core_.$ZodSurrealShape,
> extends ZodSurrealTypeDef {
  type: "object";
  shape: Shape;
  catchall?: _core_.$ZodSurrealType | undefined;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealObjectInternals<
  // @ts-expect-error
  out Shape extends _core_.$ZodSurrealShape = _core_.$ZodSurrealShape,
  out Config extends core.$ZodObjectConfig = core.$ZodObjectConfig,
> extends ZodSurrealTypeInternals<
  core.$InferObjectOutput<Shape, Config["out"]>,
  core.$InferObjectInput<Shape, Config["in"]>,
  _core_.$InferObjectDbOutput<Shape, Config["out"]>,
  _core_.$InferObjectDbInput<Shape, Config["in"]>
> {
  def: ZodSurrealObjectDef<Shape>;
  config: Config;
  isst: core.$ZodIssueInvalidType | core.$ZodIssueUnrecognizedKeys;
  propValues: core.util.PropValues;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
  dboptin?: "optional" | undefined;
  dboptout?: "optional" | undefined;
}

// .keyof
export function keyof<T extends ZodSurrealObject>(
  schema: T,
): ZodSurrealEnum<core.util.KeysEnum<T["_zod"]["output"]>> {
  const shape = schema._zod.def.shape;
  return _enum(Object.keys(shape)) as any;
}

export type SafeExtendShape<
  Base extends _core_.$ZodSurrealShape,
  Ext extends core.$ZodLooseShape,
> = {
    [K in keyof Ext]: K extends keyof Base
    ? core.output<Ext[K]> extends core.output<Base[K]>
    ? core.input<Ext[K]> extends core.input<Base[K]>
    ? Ext[K]
    : never
    : never
    : Ext[K];
  };

export interface ZodSurrealObject<
  // @ts-expect-error Cast Variance
  out Shape extends _core_.$ZodSurrealShape = core.$ZodLooseShape,
  out Config extends core.$ZodObjectConfig = core.$strip,
> extends _ZodSurrealType<ZodSurrealObjectInternals<Shape, Config>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  shape: Shape;

  keyof(): ZodSurrealEnum<core.util.ToEnum<keyof Shape & string>>;
  /** Define a schema to validate all unrecognized keys. This overrides the existing strict/loose behavior. */
  catchall<T extends _core_.$SomeSurrealType>(
    schema: T,
  ): ZodSurrealObject<Shape, _core_.$catchall<T>>;

  /** @deprecated Use `z.looseObject()` or `.loose()` instead. */
  passthrough(): ZodSurrealObject<Shape, core.$loose>;
  /** Consider `z.looseObject(A.shape)` instead */
  loose(): ZodSurrealObject<Shape, core.$loose>;

  /** Consider `z.strictObject(A.shape)` instead */
  strict(): ZodSurrealObject<Shape, core.$strict>;

  /** This is the default behavior. This method call is likely unnecessary. */
  strip(): ZodSurrealObject<Shape, core.$strip>;

  extend<U extends core.$ZodLooseShape>(
    shape: U,
  ): ZodSurrealObject<core.util.Extend<Shape, U>, Config>;

  safeExtend<U extends core.$ZodLooseShape>(
    shape: SafeExtendShape<Shape, U> &
      Partial<Record<keyof Shape, core.SomeType>>,
  ): ZodSurrealObject<core.util.Extend<Shape, U>, Config>;

  /**
   * @deprecated Use [`A.extend(B.shape)`](https://zod.dev/api?id=extend) instead.
   */
  merge<U extends ZodSurrealObject>(
    other: U,
  ): ZodSurrealObject<core.util.Extend<Shape, U["shape"]>, U["_zod"]["config"]>;

  pick<M extends core.util.Mask<keyof Shape>>(
    mask: M & Record<Exclude<keyof M, keyof Shape>, never>,
  ): ZodSurrealObject<
    core.util.Flatten<Pick<Shape, Extract<keyof Shape, keyof M>>>,
    Config
  >;

  omit<M extends core.util.Mask<keyof Shape>>(
    mask: M & Record<Exclude<keyof M, keyof Shape>, never>,
  ): ZodSurrealObject<
    core.util.Flatten<Omit<Shape, Extract<keyof Shape, keyof M>>>,
    Config
  >;

  partial(): ZodSurrealObject<
    {
      [k in keyof Shape]: ZodSurrealOptional<Shape[k]>;
    },
    Config
  >;
  partial<M extends core.util.Mask<keyof Shape>>(
    mask: M & Record<Exclude<keyof M, keyof Shape>, never>,
  ): ZodSurrealObject<
    {
      [k in keyof Shape]: k extends keyof M
      ? // Shape[k] extends OptionalInSchema
      //   ? Shape[k]
      //   :
      ZodSurrealOptional<Shape[k]>
      : Shape[k];
    },
    Config
  >;

  // required
  required(): ZodSurrealObject<
    {
      [k in keyof Shape]: ZodSurrealNonOptional<Shape[k]>;
    },
    Config
  >;
  required<M extends core.util.Mask<keyof Shape>>(
    mask: M & Record<Exclude<keyof M, keyof Shape>, never>,
  ): ZodSurrealObject<
    {
      [k in keyof Shape]: k extends keyof M
      ? ZodSurrealNonOptional<Shape[k]>
      : Shape[k];
    },
    Config
  >;
}

export const ZodSurrealObject: core.$constructor<ZodSurrealObject> =
  core.$constructor("ZodSurrealObject", (inst, def) => {
    // @ts-expect-error
    core.$ZodObjectJIT.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.object(inst as any, ctx, json, params);

    core.util.defineLazy(inst, "shape", () => {
      return def.shape;
    });

    inst.keyof = () => _enum(Object.keys(inst._zod.def.shape)) as any;
    inst.catchall = (catchall) =>
      inst.clone({
        ...inst._zod.def,
        catchall: catchall as any as _core_.$ZodSurrealType,
      }) as any;
    inst.passthrough = () =>
      inst.clone({ ...inst._zod.def, catchall: unknown() });
    inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
    inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
    inst.strip = () => inst.clone({ ...inst._zod.def, catchall: undefined });

    inst.extend = (incoming: any) => {
      return core.util.extend(inst as any, incoming);
    };
    inst.safeExtend = (incoming: any) => {
      return core.util.safeExtend(inst as any, incoming);
    };
    inst.merge = (other) => core.util.merge(inst as any, other as any);
    inst.pick = (mask) => core.util.pick(inst as any, mask);
    inst.omit = (mask) => core.util.omit(inst as any, mask);
    inst.partial = (...args: any[]) =>
      core.util.partial(
        ZodSurrealOptional as any,
        inst as any,
        args[0] as object,
      );
    inst.required = (...args: any[]) =>
      core.util.required(
        ZodSurrealNonOptional as any,
        inst as any,
        args[0] as object,
      );
  });

export function object<
  T extends core.$ZodLooseShape = Partial<Record<never, core.SomeType>>,
>(
  shape?: T,
  params?: string | core.$ZodObjectParams,
): ZodSurrealObject<core.util.Writeable<T>, core.$strip> {
  const def: ZodSurrealObjectDef = {
    type: "object",
    shape: shape ?? {},
    ...core.util.normalizeParams(params),
    surreal: {},
  };
  return new ZodSurrealObject(def) as any;
}

// strictObject

export function strictObject<T extends core.$ZodLooseShape>(
  shape: T,
  params?: string | core.$ZodObjectParams,
): ZodSurrealObject<T, core.$strict> {
  return new ZodSurrealObject({
    type: "object",
    shape,
    catchall: never(),
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

// looseObject

export function looseObject<T extends core.$ZodLooseShape>(
  shape: T,
  params?: string | core.$ZodObjectParams,
): ZodSurrealObject<T, core.$loose> {
  return new ZodSurrealObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealUnion      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealUnionDef<
  Options extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
> extends ZodSurrealTypeDef {
  type: "union";
  options: Options;
  inclusive?: boolean;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealUnionInternals<
  T extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
> extends ZodSurrealTypeInternals<
  _core_.$InferUnionOutput<T[number]>,
  _core_.$InferUnionInput<T[number]>,
  _core_.$InferUnionDbOutput<T[number]>,
  _core_.$InferUnionDbInput<T[number]>
> {
  def: ZodSurrealUnionDef<T>;
  isst: core.$ZodIssueInvalidUnion;
  pattern: T[number]["_zod"]["pattern"];
  values: T[number]["_zod"]["values"]; //GetValues<T[number]>;
  // if any element in the union is optional, then the union is optional
  optin: _core_.IsOptionalIn<T[number]> extends false
  ? "optional" | undefined
  : "optional";
  optout: _core_.IsOptionalOut<T[number]> extends false
  ? "optional" | undefined
  : "optional";
  dboptin: _core_.IsOptionalDbIn<T[number]> extends false
  ? "optional" | undefined
  : "optional";
  dboptout: _core_.IsOptionalDbOut<T[number]> extends false
  ? "optional" | undefined
  : "optional";
}

export interface ZodSurrealUnion<
  T extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
> extends _ZodSurrealType<ZodSurrealUnionInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  options: T;
}
export const ZodSurrealUnion: core.$constructor<ZodSurrealUnion> =
  core.$constructor("ZodSurrealUnion", (inst, def) => {
    // @ts-expect-error
    core.$ZodUnion.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.union(inst as any, ctx, json, params);
    inst.options = def.options;
  });

export function union<const T extends readonly _core_.$SomeSurrealType[]>(
  options: T,
  params?: string | core.$ZodUnionParams,
): ZodSurrealUnion<T> {
  return new ZodSurrealUnion({
    type: "union",
    options: options as any as _core_.$ZodSurrealType[],
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////
/////////////////////////////////////////////
//////////                         //////////
//////////      ZodSurrealXor      //////////
//////////                         //////////
/////////////////////////////////////////////
/////////////////////////////////////////////

export interface ZodSurrealXorInternals<
  T extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
> extends ZodSurrealUnionInternals<T> { }

export interface ZodSurrealXor<
  T extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
> extends _ZodSurrealType<ZodSurrealXorInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  options: T;
}
export const ZodSurrealXor: core.$constructor<ZodSurrealXor> =
  /*@__PURE__*/ core.$constructor("ZodSurrealXor", (inst, def) => {
  ZodSurrealUnion.init(inst, def);
  // @ts-expect-error
  core.$ZodXor.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    allProcessors.union(inst as any, ctx, json, params);
  inst.options = def.options;
});

/** Creates an exclusive union (XOR) where exactly one option must match.
 * Unlike regular unions that succeed when any option matches, xor fails if
 * zero or more than one option matches the input. */
export function xor<const T extends readonly _core_.$SomeSurrealType[]>(
  options: T,
  params?: string | core.$ZodXorParams,
): ZodSurrealXor<T> {
  return new ZodSurrealXor({
    type: "union",
    options: options as any as _core_.$ZodSurrealType[],
    inclusive: false,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
//////////                                        //////////
//////////      ZodSurrealDiscriminatedUnion      //////////
//////////                                        //////////
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////

export interface ZodSurrealDiscriminatedUnionDef<
  Options extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
  Disc extends string = string,
> extends ZodSurrealUnionDef<Options> {
  discriminator: Disc;
  unionFallback?: boolean;
}

export interface ZodSurrealDiscriminatedUnionInternals<
  Options extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
  Disc extends string = string,
> extends ZodSurrealUnionInternals<Options> {
  def: ZodSurrealDiscriminatedUnionDef<Options, Disc>;
  propValues: core.util.PropValues;
}

export interface ZodSurrealDiscriminatedUnion<
  Options extends
  readonly _core_.$SomeSurrealType[] = readonly _core_.$ZodSurrealType[],
  Disc extends string = string,
> extends ZodSurrealUnion<Options>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  _zod: ZodSurrealDiscriminatedUnionInternals<Options, Disc>;
  def: ZodSurrealDiscriminatedUnionDef<Options, Disc>;
}
export const ZodSurrealDiscriminatedUnion: core.$constructor<ZodSurrealDiscriminatedUnion> =
  core.$constructor("ZodSurrealDiscriminatedUnion", (inst, def) => {
    ZodSurrealUnion.init(inst, def);
    // @ts-expect-error
    core.$ZodDiscriminatedUnion.init(inst, def);
  });

export function discriminatedUnion<
  Types extends readonly [
    _core_.$ZodSurrealTypeDiscriminable,
    ..._core_.$ZodSurrealTypeDiscriminable[],
  ],
  Disc extends string,
>(
  discriminator: Disc,
  options: Types,
  params?: string | core.$ZodDiscriminatedUnionParams,
): ZodSurrealDiscriminatedUnion<Types, Disc> {
  // const [options, params] = args;
  return new ZodSurrealDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////////
//////////////////////////////////////////////////////
//////////                                  //////////
//////////      ZodSurrealIntersection      //////////
//////////                                  //////////
//////////////////////////////////////////////////////
//////////////////////////////////////////////////////

export interface ZodSurrealIntersectionDef<
  Left extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  Right extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "intersection";
  left: Left;
  right: Right;

  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealIntersectionInternals<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<A> & core.output<B>,
  core.input<A> & core.input<B>,
  _core_.dboutput<A> & _core_.dboutput<B>,
  _core_.dbinput<A> & _core_.dbinput<B>
> {
  // $ZodTypeInternals<core.output<A> & core.output<B>, core.input<A> & core.input<B>>
  def: ZodSurrealIntersectionDef<A, B>;
  isst: never;
  optin: A["_zod"]["optin"] | B["_zod"]["optin"];
  optout: A["_zod"]["optout"] | B["_zod"]["optout"];
  dboptin: A["_zod"]["dboptin"] | B["_zod"]["dboptin"];
  dboptout: A["_zod"]["dboptout"] | B["_zod"]["dboptout"];
}

export interface ZodSurrealIntersection<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealIntersectionInternals<A, B>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodIntersection: core.$constructor<ZodSurrealIntersection> =
  /*@__PURE__*/ core.$constructor("ZodIntersection", (inst, def) => {
  // @ts-expect-error
  core.$ZodIntersection.init(inst, def);
  ZodSurrealType.init(inst, def);
  ZodSurrealField.init(inst as any, def as any);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    allProcessors.intersection(inst as any, ctx, json, params);
});

export function intersection<
  T extends _core_.$SomeSurrealType,
  U extends _core_.$SomeSurrealType,
>(left: T, right: U): ZodSurrealIntersection<T, U> {
  return new ZodIntersection({
    type: "intersection",
    left: left as any as _core_.$ZodSurrealType,
    right: right as any as _core_.$ZodSurrealType,
    surreal: {},
  }) as any;
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealTuple      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealTupleDef<
  T extends _core_.TupleItems = readonly _core_.$ZodSurrealType[],
  Rest extends _core_.$SomeSurrealType | null = _core_.$ZodSurrealType | null,
> extends ZodSurrealTypeDef {
  type: "tuple";
  items: T;
  rest: Rest;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealTupleInternals<
  T extends _core_.TupleItems = readonly _core_.$ZodSurrealType[],
  Rest extends _core_.$SomeSurrealType | null = _core_.$ZodSurrealType | null,
> extends ZodSurrealTypeInternals<
  _core_.$InferTupleOutputType<T, Rest>,
  _core_.$InferTupleInputType<T, Rest>,
  _core_.$InferTupleDbOutputType<T, Rest>,
  _core_.$InferTupleDbInputType<T, Rest>
> {
  def: ZodSurrealTupleDef<T, Rest>;
  isst:
  | core.$ZodIssueInvalidType
  | core.$ZodIssueTooBig<unknown[]>
  | core.$ZodIssueTooSmall<unknown[]>;
  // $ZodTypeInternals<$InferTupleOutputType<T, Rest>, $InferTupleInputType<T, Rest>>
}

export interface ZodSurrealTuple<
  T extends _core_.TupleItems = readonly _core_.$ZodSurrealType[],
  Rest extends _core_.$SomeSurrealType | null = _core_.$ZodSurrealType | null,
> extends _ZodSurrealType<ZodSurrealTupleInternals<T, Rest>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  rest<Rest extends _core_.$SomeSurrealType = ZodSurrealType>(
    rest: Rest,
  ): ZodSurrealTuple<T, Rest>;
}
export const ZodSurrealTuple: core.$constructor<ZodSurrealTuple> =
  core.$constructor("ZodSurrealTuple", (inst, def) => {
    // @ts-expect-error
    core.$ZodTuple.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.tuple(inst as any, ctx, json, params);
    inst.rest = (rest) =>
      inst.clone({
        ...inst._zod.def,
        rest: rest as any as _core_.$ZodSurrealType,
      }) as any;
  });

export function tuple<
  T extends readonly [_core_.$SomeSurrealType, ..._core_.$SomeSurrealType[]],
>(items: T, params?: string | core.$ZodTupleParams): ZodSurrealTuple<T, null>;
export function tuple<
  T extends readonly [_core_.$SomeSurrealType, ..._core_.$SomeSurrealType[]],
  Rest extends _core_.$SomeSurrealType,
>(
  items: T,
  rest: Rest,
  params?: string | core.$ZodTupleParams,
): ZodSurrealTuple<T, Rest>;
export function tuple(
  items: [],
  params?: string | core.$ZodTupleParams,
): ZodSurrealTuple<[], null>;
export function tuple(
  items: _core_.$SomeSurrealType[],
  _paramsOrRest?: string | core.$ZodTupleParams | _core_.$SomeSurrealType,
  _params?: string | core.$ZodTupleParams,
) {
  const hasRest = _paramsOrRest instanceof ZodSurrealType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodSurrealTuple({
    type: "tuple",
    items: items as any as _core_.$ZodSurrealType[],
    rest,
    ...core.util.normalizeParams(params),
    surreal: {},
  });
}

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealRecord      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealRecordDef<
  Key extends _core_.$ZodRecordKey = _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "record";
  keyType: Key;
  valueType: Value;
  /** @default "strict" - errors on keys not matching keyType. "loose" passes through non-matching keys unchanged. */
  mode?: "strict" | "loose";
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealRecordInternals<
  Key extends _core_.$ZodRecordKey = _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  _core_.$InferZodRecordOutput<Key, Value>,
  _core_.$InferZodRecordInput<Key, Value>,
  _core_.$InferZodRecordDbOutput<Key, Value>,
  _core_.$InferZodRecordDbInput<Key, Value>
> {
  def: ZodSurrealRecordDef<Key, Value>;
  isst:
  | core.$ZodIssueInvalidType
  | core.$ZodIssueInvalidKey<Record<PropertyKey, unknown>>;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
  dboptin?: "optional" | undefined;
  dboptout?: "optional" | undefined;
}

export interface ZodSurrealRecord<
  Key extends _core_.$ZodRecordKey = _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealRecordInternals<Key, Value>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  keyType: Key;
  valueType: Value;
}
export const ZodSurrealRecord: core.$constructor<ZodSurrealRecord> =
  core.$constructor("ZodSurrealRecord", (inst, def) => {
    // @ts-expect-error
    core.$ZodRecord.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.record(inst as any, ctx, json, params);

    inst.keyType = def.keyType;
    inst.valueType = def.valueType;
  });

export function record<
  Key extends _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType,
>(
  keyType: Key,
  valueType: Value,
  params?: string | core.$ZodRecordParams,
): ZodSurrealRecord<Key, Value> {
  return new ZodSurrealRecord({
    type: "record",
    keyType,
    valueType: valueType as any as _core_.$ZodSurrealType,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

export function partialRecord<
  Key extends _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType,
>(
  keyType: Key,
  valueType: Value,
  params?: string | core.$ZodRecordParams,
): ZodSurrealRecord<Key & core.$partial, Value> {
  const k = core.clone(keyType as any);
  k._zod.values = undefined;
  return new ZodSurrealRecord({
    type: "record",
    keyType: k,
    valueType: valueType as any,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

export function looseRecord<
  Key extends _core_.$ZodRecordKey,
  Value extends _core_.$SomeSurrealType,
>(
  keyType: Key,
  valueType: Value,
  params?: string | core.$ZodRecordParams,
): ZodSurrealRecord<Key, Value> {
  return new ZodSurrealRecord({
    type: "record",
    keyType,
    valueType: valueType as any as _core_.$ZodSurrealType,
    mode: "loose",
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////
/////////////////////////////////////////////
//////////                         //////////
//////////      ZodSurrealMap      //////////
//////////                         //////////
/////////////////////////////////////////////
/////////////////////////////////////////////

export interface ZodSurrealMapDef<
  Key extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "map";
  keyType: Key;
  valueType: Value;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealMapInternals<
  Key extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  Map<core.output<Key>, core.output<Value>>,
  Map<core.input<Key>, core.input<Value>>,
  Map<_core_.dboutput<Key>, _core_.dboutput<Value>>,
  Map<_core_.dbinput<Key>, _core_.dbinput<Value>>
> {
  def: ZodSurrealMapDef<Key, Value>;
  isst:
  | core.$ZodIssueInvalidType
  | core.$ZodIssueInvalidKey
  | core.$ZodIssueInvalidElement<unknown>;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
  dboptin?: "optional" | undefined;
  dboptout?: "optional" | undefined;
}

export interface ZodSurrealMap<
  Key extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  Value extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealMapInternals<Key, Value>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  keyType: Key;
  valueType: Value;
  min(minSize: number, params?: string | core.$ZodCheckMinSizeParams): this;
  nonempty(params?: string | core.$ZodCheckMinSizeParams): this;
  max(maxSize: number, params?: string | core.$ZodCheckMaxSizeParams): this;
  size(size: number, params?: string | core.$ZodCheckSizeEqualsParams): this;
}
export const ZodSurrealMap: core.$constructor<ZodSurrealMap> =
  core.$constructor("ZodSurrealMap", (inst, def) => {
    // @ts-expect-error
    core.$ZodMap.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.map(inst as any, ctx, json, params);
    inst.keyType = def.keyType;
    inst.valueType = def.valueType;
    inst.min = (...args) => inst.check(core._minSize(...args));
    inst.nonempty = (params) => inst.check(core._minSize(1, params));
    inst.max = (...args) => inst.check(core._maxSize(...args));
    inst.size = (...args) => inst.check(core._size(...args));
  });

export function map<
  Key extends _core_.$SomeSurrealType,
  Value extends _core_.$SomeSurrealType,
>(
  keyType: Key,
  valueType: Value,
  params?: string | core.$ZodMapParams,
): ZodSurrealMap<Key, Value> {
  return new ZodSurrealMap({
    type: "map",
    keyType: keyType as any as _core_.$ZodSurrealType,
    valueType: valueType as any as _core_.$ZodSurrealType,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////
/////////////////////////////////////////////
//////////                         //////////
//////////      ZodSurrealSet      //////////
//////////                         //////////
/////////////////////////////////////////////
/////////////////////////////////////////////

export interface ZodSurrealSetDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "set";
  valueType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealSetInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  Set<core.output<T>>,
  Set<core.input<T>>,
  Set<_core_.dboutput<T>>,
  Set<_core_.dbinput<T>>
> {
  def: ZodSurrealSetDef<T>;
  isst: core.$ZodIssueInvalidType;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
  dboptin?: "optional" | undefined;
  dboptout?: "optional" | undefined;
}

export interface ZodSurrealSet<
  T extends _core_.$SomeSurrealType = ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealSetInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  min(minSize: number, params?: string | core.$ZodCheckMinSizeParams): this;
  nonempty(params?: string | core.$ZodCheckMinSizeParams): this;
  max(maxSize: number, params?: string | core.$ZodCheckMaxSizeParams): this;
  size(size: number, params?: string | core.$ZodCheckSizeEqualsParams): this;
}
export const ZodSurrealSet: core.$constructor<ZodSurrealSet> =
  core.$constructor("ZodSurrealSet", (inst, def) => {
    // @ts-expect-error
    core.$ZodSet.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.set(inst as any, ctx, json, params);

    inst.min = (...args) => inst.check(core._minSize(...args));
    inst.nonempty = (params) => inst.check(core._minSize(1, params));
    inst.max = (...args) => inst.check(core._maxSize(...args));
    inst.size = (...args) => inst.check(core._size(...args));
  });

export function set<Value extends _core_.$SomeSurrealType>(
  valueType: Value,
  params?: string | core.$ZodSetParams,
): ZodSurrealSet<Value> {
  return new ZodSurrealSet({
    type: "set",
    valueType: valueType as any as ZodSurrealType,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealEnum      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealEnumDef<
  T extends core.util.EnumLike = core.util.EnumLike,
> extends ZodSurrealTypeDef {
  type: "enum";
  entries: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealEnumInternals<
  /** @ts-expect-error Cast variance */
  out T extends core.util.EnumLike = core.util.EnumLike,
> extends ZodSurrealTypeInternals<
  core.$InferEnumOutput<T>,
  core.$InferEnumInput<T>,
  _core_.$InferEnumDbOutput<T>,
  _core_.$InferEnumDbInput<T>
> {
  // enum: T;

  def: ZodSurrealEnumDef<T>;
  /** @deprecated Internal API, use with caution (not deprecated) */
  values: core.util.PrimitiveSet;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;
  isst: core.$ZodIssueInvalidValue;
}

export interface ZodSurrealEnum<
  /** @ts-expect-error Cast variance */
  out T extends core.util.EnumLike = core.util.EnumLike,
> extends _ZodSurrealType<ZodSurrealEnumInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  enum: T;
  options: Array<T[keyof T]>;

  extract<const U extends readonly (keyof T)[]>(
    values: U,
    params?: string | core.$ZodEnumParams,
  ): ZodSurrealEnum<core.util.Flatten<Pick<T, U[number]>>>;
  exclude<const U extends readonly (keyof T)[]>(
    values: U,
    params?: string | core.$ZodEnumParams,
  ): ZodSurrealEnum<core.util.Flatten<Omit<T, U[number]>>>;
}
export const ZodSurrealEnum: core.$constructor<ZodSurrealEnum> =
  /*@__PURE__*/ core.$constructor("ZodEnum", (inst, def) => {
  // @ts-expect-error
  core.$ZodEnum.init(inst, def);
  ZodSurrealType.init(inst, def);
  ZodSurrealField.init(inst as any, def as any);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    allProcessors.enum(inst as any, ctx, json, params);

  inst.enum = def.entries;
  inst.options = Object.values(def.entries);

  const keys = new Set(Object.keys(def.entries));

  inst.extract = (values, params) => {
    const newEntries: Record<string, any> = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodSurrealEnum({
      ...def,
      checks: [],
      ...core.util.normalizeParams(params),
      entries: newEntries,
    }) as any;
  };

  inst.exclude = (values, params) => {
    const newEntries: Record<string, any> = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodSurrealEnum({
      ...def,
      checks: [],
      ...core.util.normalizeParams(params),
      entries: newEntries,
    }) as any;
  };
});

function _enum<const T extends readonly string[]>(
  values: T,
  params?: string | core.$ZodEnumParams,
): ZodSurrealEnum<core.util.ToEnum<T[number]>>;
function _enum<const T extends core.util.EnumLike>(
  entries: T,
  params?: string | core.$ZodEnumParams,
): ZodSurrealEnum<T>;
function _enum(values: any, params?: string | core.$ZodEnumParams) {
  const entries: any = Array.isArray(values)
    ? Object.fromEntries(values.map((v) => [v, v]))
    : values;

  return new ZodSurrealEnum({
    type: "enum",
    entries,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}
export { _enum as enum };

/** @deprecated This API has been merged into `z.enum()`. Use `z.enum()` instead.
 *
 * ```ts
 * enum Colors { red, green, blue }
 * z.enum(Colors);
 * ```
 */
export function nativeEnum<T extends core.util.EnumLike>(
  entries: T,
  params?: string | core.$ZodEnumParams,
): ZodSurrealEnum<T> {
  return new ZodSurrealEnum({
    type: "enum",
    entries,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any as ZodSurrealEnum<T>;
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealLiteral      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealLiteralDef<T extends core.util.Literal>
  extends ZodSurrealTypeDef {
  type: "literal";
  values: T[];
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealLiteralInternals<
  T extends core.util.Literal = core.util.Literal,
> extends ZodSurrealTypeInternals<T, T> {
  def: ZodSurrealLiteralDef<T>;
  values: Set<T>;
  pattern: RegExp;
  isst: core.$ZodIssueInvalidValue;
}

export interface ZodSurrealLiteral<
  T extends core.util.Literal = core.util.Literal,
> extends _ZodSurrealType<ZodSurrealLiteralInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  values: Set<T>;
  /** @legacy Use `.values` instead. Accessing this property will throw an error if the literal accepts multiple values. */
  value: T;
}
export const ZodSurrealLiteral: core.$constructor<ZodSurrealLiteral> =
  core.$constructor("ZodSurrealLiteral", (inst, def) => {
    // @ts-expect-error
    core.$ZodLiteral.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.literal(inst as any, ctx, json, params);
    inst.values = new Set(def.values);
    Object.defineProperty(inst, "value", {
      get() {
        if (def.values.length > 1) {
          throw new Error(
            "This schema contains multiple valid literal values. Use `.values` instead.",
          );
        }
        return def.values[0];
      },
    });
  });

export function literal<const T extends ReadonlyArray<core.util.Literal>>(
  value: T,
  params?: string | core.$ZodLiteralParams,
): ZodSurrealLiteral<T[number]>;
export function literal<const T extends core.util.Literal>(
  value: T,
  params?: string | core.$ZodLiteralParams,
): ZodSurrealLiteral<T>;
export function literal(value: any, params: any) {
  return new ZodSurrealLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...core.util.normalizeParams(params),
    surreal: {},
  });
}

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealFile      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

type _File = typeof globalThis extends {
  File: infer F extends new (...args: any[]) => any;
}
  ? InstanceType<F>
  : {};
/** Do not reference this directly. */
export interface File extends _File {
  readonly type: string;
  readonly size: number;
}

export interface ZodSurrealFileDef extends ZodSurrealTypeDef {
  type: "file";
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealFileInternals
  extends ZodSurrealTypeInternals<File, File> {
  def: ZodSurrealFileDef;
  isst: core.$ZodIssueInvalidType;
  bag: core.util.LoosePartial<{
    minimum: number;
    maximum: number;
    mime: core.util.MimeTypes[];
  }>;
}

export interface ZodSurrealFile
  extends _ZodSurrealType<ZodSurrealFileInternals>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  min(size: number, params?: string | core.$ZodCheckMinSizeParams): this;
  max(size: number, params?: string | core.$ZodCheckMaxSizeParams): this;
  mime(
    types: core.util.MimeTypes | Array<core.util.MimeTypes>,
    params?: string | core.$ZodCheckMimeTypeParams,
  ): this;
}
export const ZodSurrealFile: core.$constructor<ZodSurrealFile> =
  core.$constructor("ZodSurrealFile", (inst, def) => {
    // @ts-expect-error
    core.$ZodFile.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.file(inst as any, ctx, json, params);

    inst.min = (size, params) => inst.check(core._minSize(size, params));
    inst.max = (size, params) => inst.check(core._maxSize(size, params));
    inst.mime = (types, params) =>
      inst.check(core._mime(Array.isArray(types) ? types : [types], params));
  });

export function file(params?: string | core.$ZodFileParams): ZodSurrealFile {
  return new ZodSurrealFile({
    type: "file",
    ...core.util.normalizeParams(params),
    surreal: {},
  });
}

///////////////////////////////////////////////////
///////////////////////////////////////////////////
//////////                               //////////
//////////      ZodSurrealTransform      //////////
//////////                               //////////
///////////////////////////////////////////////////
///////////////////////////////////////////////////

export interface ZodSurrealTransformDef extends ZodSurrealTypeDef {
  type: "transform";
  transform: (
    input: unknown,
    payload: core.ParsePayload<unknown>,
  ) => core.util.MaybeAsync<unknown>;
  surreal: {
    type?: undefined;
  };
}
export interface ZodSurrealTransformInternals<O = unknown, I = unknown>
  extends ZodSurrealTypeInternals<O, I> {
  def: ZodSurrealTransformDef;
  isst: never;
}

export interface ZodSurrealTransform<O = unknown, I = unknown>
  extends _ZodSurrealType<ZodSurrealTransformInternals<O, I>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodSurrealTransform: core.$constructor<ZodSurrealTransform> =
  core.$constructor("ZodSurrealTransform", (inst, def) => {
    // @ts-expect-error
    core.$ZodTransform.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.transform(inst as any, ctx, json, params);

    inst._zod.parse = (payload, _ctx) => {
      if (_ctx.direction === "backward") {
        throw new core.$ZodEncodeError(inst.constructor.name);
      }

      (payload as core.$RefinementCtx).addIssue = (issue) => {
        if (typeof issue === "string") {
          payload.issues.push(core.util.issue(issue, payload.value, def));
        } else {
          // for Zod 3 backwards compatibility
          const _issue = issue as any;

          if (_issue.fatal) _issue.continue = false;
          _issue.code ??= "custom";
          _issue.input ??= payload.value;
          _issue.inst ??= inst;
          // _issue.continue ??= true;
          payload.issues.push(core.util.issue(_issue));
        }
      };

      const output = def.transform(payload.value, payload);
      if (output instanceof Promise) {
        return output.then((output) => {
          payload.value = output;
          return payload;
        });
      }
      payload.value = output;
      return payload;
    };
  });

export function transform<I = unknown, O = I>(
  fn: (input: I, ctx: core.ParsePayload) => O,
): ZodSurrealTransform<Awaited<O>, I> {
  return new ZodSurrealTransform({
    type: "transform",
    transform: fn as any,
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealOptional      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealOptionalDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "optional";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealOptionalInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<T> | undefined,
  core.input<T> | undefined,
  _core_.dboutput<T> | undefined,
  _core_.dbinput<T> | undefined
> {
  def: ZodSurrealOptionalDef<T>;
  optin: "optional";
  optout: "optional";
  dboptin: "optional";
  dboptout: "optional";
  isst: never;
  values: T["_zod"]["values"];
  pattern: T["_zod"]["pattern"];
}

export interface ZodSurrealOptional<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealOptionalInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealOptional: core.$constructor<ZodSurrealOptional> =
  core.$constructor("ZodSurrealOptional", (inst, def) => {
    // @ts-expect-error
    core.$ZodOptional.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.optional(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function optional<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealOptional<T> {
  return new ZodSurrealOptional({
    type: "optional",
    innerType: innerType as any as _core_.$ZodSurrealType,
    surreal: {},
  }) as any;
}

///////////////////////////////////////////////////////
///////////////////////////////////////////////////////
//////////                                   //////////
//////////      ZodSurrealExactOptional      //////////
//////////                                   //////////
///////////////////////////////////////////////////////
///////////////////////////////////////////////////////

// Def extends $ZodOptionalDef (no additional fields needed)
export interface ZodSurrealExactOptionalDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealOptionalDef<T> { }

// Internals extends $ZodOptionalInternals but narrows output/input types (removes | undefined)
export interface ZodSurrealExactOptionalInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealOptionalInternals<T> {
  def: ZodSurrealExactOptionalDef<T>;
  output: core.output<T>; // NO | undefined (narrowed from parent)
  input: core.input<T>; // NO | undefined (narrowed from parent)
  dboutput: _core_.dboutput<T>; // NO | undefined (narrowed from parent)
  dbinput: _core_.dbinput<T>; // NO | undefined (narrowed from parent)
}

export interface ZodSurrealExactOptional<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealExactOptionalInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealExactOptional: core.$constructor<ZodSurrealExactOptional> =
  core.$constructor("ZodSurrealExactOptional", (inst, def) => {
    // @ts-expect-error
    core.$ZodExactOptional.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.optional(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function exactOptional<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealExactOptional<T> {
  return new ZodSurrealExactOptional({
    type: "optional",
    innerType: innerType as any as _core_.$ZodSurrealType,
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealNullable      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealNullableDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "nullable";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealNullableInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<T> | null,
  core.input<T> | null,
  _core_.dboutput<T> | null,
  _core_.dbinput<T> | null
> {
  def: ZodSurrealNullableDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  dboptin: T["_zod"]["dboptin"];
  dboptout: T["_zod"]["dboptout"];
  isst: never;
  values: T["_zod"]["values"];
  pattern: T["_zod"]["pattern"];
}

export interface ZodSurrealNullable<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealNullableInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealNullable: core.$constructor<ZodSurrealNullable> =
  /*@__PURE__*/ core.$constructor("ZodSurrealNullable", (inst, def) => {
  // @ts-expect-error
  core.$ZodNullable.init(inst, def);
  ZodSurrealType.init(inst, def);
  ZodSurrealField.init(inst as any, def as any);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    allProcessors.nullable(inst as any, ctx, json, params);

  inst.unwrap = () => inst._zod.def.innerType;
});

export function nullable<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealNullable<T> {
  return new ZodSurrealNullable({
    type: "nullable",
    innerType: innerType as any as _core_.$ZodSurrealType,
    surreal: {},
  }) as any;
}

// nullish
export function nullish<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealOptional<ZodSurrealNullable<T>> {
  return optional(nullable(innerType));
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealDefault      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealDefaultDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "default";
  innerType: T;
  /** The default value. May be a getter. */
  defaultValue: core.util.NoUndefined<core.output<T>>;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealDefaultInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.util.NoUndefined<core.output<T>>,
  core.input<T> | undefined,
  core.util.NoUndefined<_core_.dboutput<T>>,
  _core_.dbinput<T> | undefined
> {
  def: ZodSurrealDefaultDef<T>;
  optin: "optional";
  optout?: "optional" | undefined; // required
  dboptin: "optional";
  dboptout?: "optional" | undefined; // required
  isst: never;
  values: T["_zod"]["values"];
}

export interface ZodSurrealDefault<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealDefaultInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
  /** @deprecated Use `.unwrap()` instead. */
  removeDefault(): T;
}
export const ZodSurrealDefault: core.$constructor<ZodSurrealDefault> =
  core.$constructor("ZodSurrealDefault", (inst, def) => {
    // @ts-expect-error
    core.$ZodDefault.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.default(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
    inst.removeDefault = inst.unwrap;
  });

export function _default<T extends _core_.$SomeSurrealType>(
  innerType: T,
  defaultValue:
    | core.util.NoUndefined<core.output<T>>
    | (() => core.util.NoUndefined<core.output<T>>),
): ZodSurrealDefault<T> {
  return new ZodSurrealDefault({
    type: "default",
    innerType: innerType as any as ZodSurrealType,
    get defaultValue() {
      return typeof defaultValue === "function"
        ? (defaultValue as Function)()
        : core.util.shallowClone(defaultValue);
    },
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealPrefault      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealPrefaultDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "prefault";
  innerType: T;
  /** The default value. May be a getter. */
  defaultValue: core.input<T>;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealPrefaultInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.util.NoUndefined<core.output<T>>,
  core.input<T> | undefined,
  core.util.NoUndefined<_core_.dboutput<T>>,
  _core_.dbinput<T> | undefined
> {
  def: ZodSurrealPrefaultDef<T>;
  optin: "optional";
  optout?: "optional" | undefined;
  dboptin: "optional";
  dboptout?: "optional" | undefined;
  isst: never;
  values: T["_zod"]["values"];
}

export interface ZodSurrealPrefault<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealPrefaultInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealPrefault: core.$constructor<ZodSurrealPrefault> =
  core.$constructor("ZodSurrealPrefault", (inst, def) => {
    // @ts-expect-error
    core.$ZodPrefault.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.prefault(inst as any, ctx, json, params);
    inst.unwrap = () => inst._zod.def.innerType;
  });

export function prefault<T extends _core_.$SomeSurrealType>(
  innerType: T,
  defaultValue: core.input<T> | (() => core.input<T>),
): ZodSurrealPrefault<T> {
  return new ZodSurrealPrefault({
    type: "prefault",
    innerType: innerType as any as ZodSurrealType,
    get defaultValue() {
      return typeof defaultValue === "function"
        ? (defaultValue as Function)()
        : core.util.shallowClone(defaultValue);
    },
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
//////////                                 //////////
//////////      ZodSurrealNonOptional      //////////
//////////                                 //////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////

export interface ZodSurrealNonOptionalDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "nonoptional";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealNonOptionalInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.util.NoUndefined<core.output<T>>,
  core.util.NoUndefined<core.input<T>>,
  core.util.NoUndefined<_core_.dboutput<T>>,
  core.util.NoUndefined<_core_.dbinput<T>>
> {
  def: ZodSurrealNonOptionalDef<T>;
  isst: core.$ZodIssueInvalidType;
  values: T["_zod"]["values"];
  optin: "optional" | undefined;
  optout: "optional" | undefined;
  dboptin: "optional" | undefined;
  dboptout: "optional" | undefined;
}

export interface ZodSurrealNonOptional<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealNonOptionalInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealNonOptional: core.$constructor<ZodSurrealNonOptional> =
  core.$constructor("ZodSurrealNonOptional", (inst, def) => {
    // @ts-expect-error
    core.$ZodNonOptional.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.nonoptional(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function nonoptional<T extends _core_.$SomeSurrealType>(
  innerType: T,
  params?: string | core.$ZodNonOptionalParams,
): ZodSurrealNonOptional<T> {
  return new ZodSurrealNonOptional({
    type: "nonoptional",
    innerType: innerType as any as ZodSurrealType,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealSuccess      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealSuccessDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "success";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealSuccessInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  boolean,
  core.input<T>,
  boolean,
  _core_.dbinput<T>
> {
  def: ZodSurrealSuccessDef<T>;
  isst: never;
  optin: T["_zod"]["optin"];
  optout: "optional" | undefined;
  dboptin: T["_zod"]["dboptin"];
  dboptout: "optional" | undefined;
}

export interface ZodSurrealSuccess<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealSuccessInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealSuccess: core.$constructor<ZodSurrealSuccess> =
  core.$constructor("ZodSuccess", (inst, def) => {
    // @ts-expect-error
    core.$ZodSuccess.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.success(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function success<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealSuccess<T> {
  return new ZodSurrealSuccess({
    type: "success",
    innerType: innerType as any as _core_.$ZodSurrealType,
    surreal: {},
  }) as any;
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealCatch      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealCatchDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "catch";
  innerType: T;
  catchValue: (ctx: core.$ZodCatchCtx) => unknown;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealCatchInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<T>,
  core.input<T>,
  _core_.dboutput<T>,
  _core_.dbinput<T>
> {
  def: ZodSurrealCatchDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  dboptin: T["_zod"]["dboptin"];
  dboptout: T["_zod"]["dboptout"];
  isst: never;
  values: T["_zod"]["values"];
}

export interface ZodSurrealCatch<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealCatchInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
  /** @deprecated Use `.unwrap()` instead. */
  removeCatch(): T;
}
export const ZodSurrealCatch: core.$constructor<ZodSurrealCatch> =
  core.$constructor("ZodSurrealCatch", (inst, def) => {
    // @ts-expect-error
    core.$ZodCatch.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.catch(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
    inst.removeCatch = inst.unwrap;
  });

function _catch<T extends _core_.$SomeSurrealType>(
  innerType: T,
  catchValue: core.output<T> | ((ctx: core.$ZodCatchCtx) => core.output<T>),
): ZodSurrealCatch<T> {
  return new ZodSurrealCatch({
    type: "catch",
    innerType: innerType as any as ZodSurrealType,
    catchValue: (typeof catchValue === "function"
      ? catchValue
      : () => catchValue) as (ctx: core.$ZodCatchCtx) => core.output<T>,
    surreal: {},
  }) as any;
}
export { _catch as catch };

/////////////////////////////////////////////
/////////////////////////////////////////////
//////////                         //////////
//////////      ZodSurrealNaN      //////////
//////////                         //////////
/////////////////////////////////////////////
/////////////////////////////////////////////

export interface ZodSurrealNaNDef extends ZodSurrealTypeDef {
  type: "nan";
  surreal: {
    type: "number";
  };
}

export interface ZodSurrealNaNInternals
  extends ZodSurrealTypeInternals<number, number> {
  def: ZodSurrealNaNDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealNaN
  extends _ZodSurrealType<ZodSurrealNaNInternals>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodSurrealNaN: core.$constructor<ZodSurrealNaN> =
  core.$constructor("ZodSurrealNaN", (inst, def) => {
    // @ts-expect-error
    core.$ZodNaN.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.nan(inst as any, ctx, json, params);
  });

export function nan(params?: string | core.$ZodNaNParams): ZodSurrealNaN {
  return new ZodSurrealNaN({
    type: "nan",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "number",
    },
  });
}

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealPipe      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealPipeDef<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "pipe";
  in: A;
  out: B;
  /** Only defined inside $ZodCodec instances. */
  transform?: (
    value: core.output<A>,
    payload: core.ParsePayload<core.output<A>>,
  ) => core.util.MaybeAsync<core.input<B>>;
  /** Only defined inside $ZodCodec instances. */
  reverseTransform?: (
    value: core.input<B>,
    payload: core.ParsePayload<core.input<B>>,
  ) => core.util.MaybeAsync<core.output<A>>;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealPipeInternals<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<B>,
  core.input<A>,
  _core_.dboutput<B>,
  _core_.dbinput<A>
> {
  def: ZodSurrealPipeDef<A, B>;
  isst: never;
  values: A["_zod"]["values"];
  optin: A["_zod"]["optin"];
  optout: B["_zod"]["optout"];
  dboptin: A["_zod"]["dboptin"];
  dboptout: B["_zod"]["dboptout"];
  propValues: A["_zod"]["propValues"];
}

export interface ZodSurrealPipe<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealPipeInternals<A, B>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  in: A;
  out: B;
}
export const ZodSurrealPipe: core.$constructor<ZodSurrealPipe> =
  core.$constructor("ZodSurrealPipe", (inst, def) => {
    // @ts-expect-error
    core.$ZodPipe.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.pipe(inst as any, ctx, json, params);

    inst.in = def.in;
    inst.out = def.out;
  });

export function pipe<
  const A extends _core_.$SomeSurrealType,
  B extends ZodSurrealType<unknown, core.output<A>> = ZodSurrealType<
    unknown,
    core.output<A>
  >,
>(
  in_: A,
  out: B | ZodSurrealType<unknown, core.output<A>>,
): ZodSurrealPipe<A, B>;
export function pipe(
  in_: _core_.$SomeSurrealType,
  out: _core_.$SomeSurrealType,
) {
  return new ZodSurrealPipe({
    type: "pipe",
    in: in_ as unknown as ZodSurrealType,
    out: out as unknown as ZodSurrealType,
    // ...util.normalizeParams(params),
    surreal: {},
  });
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealCodec      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealCodecDef<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealPipeDef<A, B> {
  transform: (
    value: core.output<A>,
    payload: core.ParsePayload<core.output<A>>,
  ) => core.util.MaybeAsync<core.input<B>>;
  reverseTransform: (
    value: core.input<B>,
    payload: core.ParsePayload<core.input<B>>,
  ) => core.util.MaybeAsync<core.output<A>>;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealCodecInternals<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<B>,
  core.input<A>,
  _core_.dboutput<B>,
  _core_.dbinput<A>
> {
  def: ZodSurrealCodecDef<A, B>;
  isst: never;
  values: A["_zod"]["values"];
  optin: A["_zod"]["optin"];
  optout: B["_zod"]["optout"];
  dboptin: A["_zod"]["dboptin"];
  dboptout: B["_zod"]["dboptout"];
  propValues: A["_zod"]["propValues"];
}

export interface ZodSurrealCodec<
  A extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealPipe<A, B>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  _zod: ZodSurrealCodecInternals<A, B>;
  def: ZodSurrealCodecDef<A, B>;
}
export const ZodSurrealCodec: core.$constructor<ZodSurrealCodec> =
  core.$constructor("ZodSurrealCodec", (inst, def) => {
    // @ts-expect-error
    core.$ZodCodec.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
  });

export function codec<
  const A extends _core_.$SomeSurrealType,
  B extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
>(
  in_: A,
  out: B,
  params: {
    decode: (
      value: core.output<A>,
      payload: core.ParsePayload<core.output<A>>,
    ) => core.util.MaybeAsync<core.input<B>>;
    encode: (
      value: core.input<B>,
      payload: core.ParsePayload<core.input<B>>,
    ) => core.util.MaybeAsync<core.output<A>>;
  },
): ZodSurrealCodec<A, B> {
  return new ZodSurrealCodec({
    type: "pipe",
    in: in_ as any as _core_.$ZodSurrealType,
    out: out as any as _core_.$ZodSurrealType,
    transform: params.decode as any,
    reverseTransform: params.encode as any,
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealReadonly      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealReadonlyDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "readonly";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealReadonlyInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.util.MakeReadonly<core.output<T>>,
  core.util.MakeReadonly<core.input<T>>,
  core.util.MakeReadonly<_core_.dboutput<T>>,
  core.util.MakeReadonly<_core_.dbinput<T>>
> {
  def: ZodSurrealReadonlyDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  dboptin: T["_zod"]["dboptin"];
  dboptout: T["_zod"]["dboptout"];
  isst: never;
  propValues: T["_zod"]["propValues"];
  values: T["_zod"]["values"];
}

export interface ZodSurrealReadonly<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealReadonlyInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealReadonly: core.$constructor<ZodSurrealReadonly> =
  core.$constructor("ZodSurrealReadonly", (inst, def) => {
    // @ts-expect-error
    core.$ZodReadonly.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.readonly(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function readonly<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealReadonly<T> {
  return new ZodSurrealReadonly({
    type: "readonly",
    innerType: innerType as any as ZodSurrealType,
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////
//////////                                     //////////
//////////      ZodSurrealTemplateLiteral      //////////
//////////                                     //////////
/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////

export interface ZodSurrealTemplateLiteralDef extends ZodSurrealTypeDef {
  type: "template_literal";
  parts: _core_.$ZodSurrealTemplateLiteralPart[];
  format?: string | undefined;
  surreal: {
    type?: undefined;
  };
}
export interface ZodSurrealTemplateLiteralInternals<
  Template extends string = string,
> extends ZodSurrealTypeInternals<Template, Template> {
  pattern: RegExp;
  def: ZodSurrealTemplateLiteralDef;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealTemplateLiteral<Template extends string = string>
  extends _ZodSurrealType<ZodSurrealTemplateLiteralInternals<Template>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodSurrealTemplateLiteral: core.$constructor<ZodSurrealTemplateLiteral> =
  core.$constructor("ZodSurrealTemplateLiteral", (inst, def) => {
    // @ts-expect-error
    core.$ZodTemplateLiteral.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.template_literal(inst as any, ctx, json, params);
  });

export function templateLiteral<
  const Parts extends _core_.$ZodSurrealTemplateLiteralPart[],
>(
  parts: Parts,
  params?: string | core.$ZodTemplateLiteralParams,
): ZodSurrealTemplateLiteral<_core_.$PartsToTemplateLiteral<Parts>> {
  return new ZodSurrealTemplateLiteral({
    type: "template_literal",
    parts,
    ...core.util.normalizeParams(params),
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      ZodSurrealLazy      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface ZodSurrealLazyDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "lazy";
  getter: () => T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealLazyInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  core.output<T>,
  core.input<T>,
  _core_.dboutput<T>,
  _core_.dbinput<T>
> {
  def: ZodSurrealLazyDef<T>;
  isst: never;
  /** Auto-cached way to retrieve the inner schema */
  innerType: T;
  pattern: T["_zod"]["pattern"];
  propValues: T["_zod"]["propValues"];
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  dboptin: T["_zod"]["dboptin"];
  dboptout: T["_zod"]["dboptout"];
}

export interface ZodSurrealLazy<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealLazyInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealLazy: core.$constructor<ZodSurrealLazy> =
  core.$constructor("ZodSurrealLazy", (inst, def) => {
    // @ts-expect-error
    core.$ZodLazy.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.lazy(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.getter();
  });

export function lazy<T extends _core_.$SomeSurrealType>(
  getter: () => T,
): ZodSurrealLazy<T> {
  return new ZodSurrealLazy({
    type: "lazy",
    getter: getter as any,
    surreal: {},
  }) as any;
}

/////////////////////////////////////////////////
/////////////////////////////////////////////////
//////////                             //////////
//////////      ZodSurrealPromise      //////////
//////////                             //////////
/////////////////////////////////////////////////
/////////////////////////////////////////////////

export interface ZodSurrealPromiseDef<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeDef {
  type: "promise";
  innerType: T;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealPromiseInternals<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends ZodSurrealTypeInternals<
  Promise<core.output<T>>,
  core.util.MaybeAsync<core.input<T>>,
  Promise<_core_.dboutput<T>>,
  core.util.MaybeAsync<_core_.dbinput<T>>
> {
  def: ZodSurrealPromiseDef<T>;
  isst: never;
}

export interface ZodSurrealPromise<
  T extends _core_.$SomeSurrealType = _core_.$ZodSurrealType,
> extends _ZodSurrealType<ZodSurrealPromiseInternals<T>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
export const ZodSurrealPromise: core.$constructor<ZodSurrealPromise> =
  core.$constructor("ZodSurrealPromise", (inst, def) => {
    // @ts-expect-error
    core.$ZodPromise.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.promise(inst as any, ctx, json, params);

    inst.unwrap = () => inst._zod.def.innerType;
  });

export function promise<T extends _core_.$SomeSurrealType>(
  innerType: T,
): ZodSurrealPromise<T> {
  return new ZodSurrealPromise({
    type: "promise",
    innerType: innerType as any as ZodSurrealType,
    surreal: {},
  }) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealFunction      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealFunctionDef<
  In extends _core_.ZodSurrealFunctionIn = _core_.ZodSurrealFunctionIn,
  Out extends _core_.ZodSurrealFunctionOut = _core_.ZodSurrealFunctionOut,
> extends ZodSurrealTypeDef {
  type: "function";
  input: In;
  output: Out;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealFunctionInternals<
  Args extends _core_.ZodSurrealFunctionIn,
  Returns extends _core_.ZodSurrealFunctionOut,
> extends ZodSurrealTypeInternals<
  _core_.$InferOuterFunctionType<Args, Returns>,
  _core_.$InferInnerFunctionType<Args, Returns>,
  _core_.$InferOuterFunctionDbType<Args, Returns>,
  _core_.$InferInnerFunctionDbType<Args, Returns>
> {
  def: ZodSurrealFunctionDef<Args, Returns>;
  isst: core.$ZodIssueInvalidType;
}

export interface ZodSurrealFunction<
  Args extends _core_.ZodSurrealFunctionIn = _core_.ZodSurrealFunctionIn,
  Returns extends _core_.ZodSurrealFunctionOut = _core_.ZodSurrealFunctionOut,
> extends _ZodSurrealType<ZodSurrealFunctionInternals<Args, Returns>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
  _def: ZodSurrealFunctionDef<Args, Returns>;
  _input: _core_.$InferInnerFunctionType<Args, Returns>;
  _output: _core_.$InferOuterFunctionType<Args, Returns>;
  _dbinput: _core_.$InferInnerFunctionDbType<Args, Returns>;
  _dboutput: _core_.$InferOuterFunctionDbType<Args, Returns>;

  input<
    const Items extends _core_.TupleItems,
    const Rest extends
    _core_.ZodSurrealFunctionOut = _core_.ZodSurrealFunctionOut,
  >(
    args: Items,
    rest?: Rest,
  ): ZodSurrealFunction<ZodSurrealTuple<Items, Rest>, Returns>;
  input<NewArgs extends _core_.ZodSurrealFunctionIn>(
    args: NewArgs,
  ): ZodSurrealFunction<NewArgs, Returns>;
  input(...args: any[]): ZodSurrealFunction<any, Returns>;

  output<NewReturns extends ZodSurrealType>(
    output: NewReturns,
  ): ZodSurrealFunction<Args, NewReturns>;
}

export const ZodSurrealFunction: core.$constructor<ZodSurrealFunction> =
  core.$constructor("ZodSurrealFunction", (inst, def) => {
    // @ts-expect-error
    core.$ZodFunction.init(inst, def);
    ZodSurrealType.init(inst, def);
    // @ts-expect-error
    ZodSurrealField.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      // @ts-expect-error
      allProcessors.function(inst, ctx, json, params);
  });

export function _function(): ZodSurrealFunction;
export function _function<
  const In extends ReadonlyArray<ZodSurrealType>,
>(params: {
  input: In;
}): ZodSurrealFunction<ZodSurrealTuple<In, null>, _core_.ZodSurrealFunctionOut>;
export function _function<
  const In extends ReadonlyArray<ZodSurrealType>,
  const Out extends _core_.ZodSurrealFunctionOut = _core_.ZodSurrealFunctionOut,
>(params: {
  input: In;
  output: Out;
}): ZodSurrealFunction<ZodSurrealTuple<In, null>, Out>;
export function _function<
  const In extends _core_.ZodSurrealFunctionIn = _core_.ZodSurrealFunctionIn,
>(params: { input: In }): ZodSurrealFunction<In, _core_.ZodSurrealFunctionOut>;
export function _function<
  const Out extends _core_.ZodSurrealFunctionOut = _core_.ZodSurrealFunctionOut,
>(params: {
  output: Out;
}): ZodSurrealFunction<_core_.ZodSurrealFunctionIn, Out>;
export function _function<
  In extends _core_.ZodSurrealFunctionIn = _core_.ZodSurrealFunctionIn,
  Out extends ZodSurrealType = ZodSurrealType,
>(params?: { input: In; output: Out }): ZodSurrealFunction<In, Out>;
export function _function(params?: {
  output?: ZodSurrealType;
  input?: _core_.ZodSurrealFunctionArgs | Array<ZodSurrealType>;
}): ZodSurrealFunction {
  return new ZodSurrealFunction({
    type: "function",
    input: Array.isArray(params?.input)
      ? tuple(params?.input as any)
      : (params?.input ?? array(unknown())),
    output: params?.output ?? unknown(),
    surreal: {},
  });
}

export { _function as function };

////////////////////////////////////////////////
////////////////////////////////////////////////
//////////                            //////////
//////////      ZodSurrealCustom      //////////
//////////                            //////////
////////////////////////////////////////////////
////////////////////////////////////////////////

export interface ZodSurrealCustomDef<O = unknown>
  extends ZodSurrealTypeDef,
  core.$ZodCheckDef {
  type: "custom";
  check: "custom";
  path?: PropertyKey[] | undefined;
  error?: core.$ZodErrorMap | undefined;
  params?: Record<string, any> | undefined;
  fn: (arg: O) => unknown;
  surreal: {
    type?: undefined;
  };
}

export interface ZodSurrealCustomInternals<O = unknown, I = unknown>
  extends ZodSurrealTypeInternals<O, I>,
  core.$ZodCheckInternals<O> {
  def: ZodSurrealCustomDef;
  issc: core.$ZodIssue;
  isst: never;
  bag: core.util.LoosePartial<{
    Class: typeof core.util.Class;
  }>;
}

export interface ZodSurrealCustom<O = unknown, I = unknown>
  extends _ZodSurrealType<ZodSurrealCustomInternals<O, I>>,
  ZodSurrealFieldMethods {
  "~standard": core.ZodStandardSchemaWithJSON<this>;
}
export const ZodSurrealCustom: core.$constructor<ZodSurrealCustom> =
  core.$constructor("ZodSurrealCustom", (inst, def) => {
    // @ts-expect-error
    core.$ZodCustom.init(inst, def);
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);
    inst._zod.processJSONSchema = (ctx, json, params) =>
      allProcessors.custom(inst as any, ctx, json, params);
  });

// custom checks
export function check<O = unknown>(fn: core.CheckFn<O>): core.$ZodCheck<O> {
  const ch = new core.$ZodCheck({
    check: "custom",
    // ...util.normalizeParams(params),
  });

  ch._zod.check = fn;
  return ch;
}

export function custom<O>(
  fn?: (data: unknown) => unknown,
  _params?: string | core.$ZodCustomParams | undefined,
): ZodSurrealCustom<O, O> {
  const norm = core.util.normalizeParams(_params);
  norm.abort ??= true; // default to abort:false
  const schema = new ZodSurrealCustom({
    type: "custom",
    check: "custom",
    fn: fn ?? ((() => true) as any),
    ...norm,
    surreal: {},
  });

  return schema as any;
}

export function refine<T>(
  fn: (arg: NoInfer<T>) => core.util.MaybeAsync<unknown>,
  _params: string | core.$ZodCustomParams = {},
): core.$ZodCheck<T> {
  const schema = new ZodSurrealCustom({
    type: "custom",
    check: "custom",
    fn: fn as any,
    ...core.util.normalizeParams(_params),
    surreal: {},
  });

  return schema as any;
}

// superRefine
export function superRefine<T>(
  fn: (arg: T, payload: core.$RefinementCtx<T>) => void | Promise<void>,
): core.$ZodCheck<T> {
  const ch = core._check<T>((payload) => {
    (payload as core.$RefinementCtx).addIssue = (issue) => {
      if (typeof issue === "string") {
        payload.issues.push(core.util.issue(issue, payload.value, ch._zod.def));
      } else {
        // for Zod 3 backwards compatibility
        const _issue: any = issue;
        if (_issue.fatal) _issue.continue = false;
        _issue.code ??= "custom";
        _issue.input ??= payload.value;
        _issue.inst ??= ch;
        _issue.continue ??= !ch._zod.def.abort; // abort is always undefined, so this is always true...
        payload.issues.push(core.util.issue(_issue));
      }
    };

    return fn(payload.value, payload as core.$RefinementCtx<T>);
  });
  return ch;
}

// Re-export describe and meta from core
export const describe = core.describe;
export const meta = core.meta;

type ZodInstanceOfParams = core.Params<
  ZodSurrealCustom,
  core.$ZodIssueCustom,
  "type" | "check" | "checks" | "fn" | "abort" | "error" | "params" | "path"
>;
function _instanceof<T extends typeof core.util.Class>(
  cls: T,
  params: ZodInstanceOfParams = {},
): ZodSurrealCustom<InstanceType<T>, InstanceType<T>> {
  const inst = new ZodSurrealCustom({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...(core.util.normalizeParams(params) as any),
    surreal: {
      type: "custom",
    },
  });
  inst._zod.bag.Class = cls;
  // Override check to emit invalid_type instead of custom
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...(inst._zod.def.path ?? [])],
      });
    }
  };
  return inst as any;
}
export { _instanceof as instanceof };

// stringbool
export const stringbool: (
  _params?: string | core.$ZodStringBoolParams,
) => ZodSurrealCodec<ZodSurrealString, ZodSurrealBoolean> = (_params) => {
  const params = core.util.normalizeParams(_params);

  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) =>
      typeof v === "string" ? v.toLowerCase() : v,
    );
    falsyArray = falsyArray.map((v) =>
      typeof v === "string" ? v.toLowerCase() : v,
    );
  }

  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);

  const stringSchema = new ZodSurrealString({
    type: "string",
    error: params.error,
    surreal: { type: "string" },
  });
  const booleanSchema = new ZodSurrealBoolean({
    type: "boolean",
    error: params.error,
    surreal: { type: "bool" },
  });

  const codec = new ZodSurrealCodec({
    type: "pipe",
    in: stringSchema as any,
    out: booleanSchema as any,
    transform: ((input: string, payload: core.ParsePayload<string>) => {
      let data: string = input;
      if (params.case !== "sensitive") data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec,
          continue: false,
        });
        return {} as never;
      }
    }) as any,
    reverseTransform: ((
      input: boolean,
      _payload: core.ParsePayload<boolean>,
    ) => {
      if (input === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    }) as any,
    error: params.error,
    surreal: {},
  }) as any;

  return codec;
};

////////////////////////////////////////////////////
////////////////////////////////////////////////////
//////////                                //////////
//////////      ZodSurrealJSONSchema      //////////
//////////                                //////////
////////////////////////////////////////////////////
////////////////////////////////////////////////////

// json
type _ZodSurrealJSONSchema = ZodSurrealUnion<
  [
    ZodSurrealString,
    ZodSurrealNumber,
    ZodSurrealBoolean,
    ZodSurrealNull,
    ZodSurrealArray<ZodSurrealJSONSchema>,
    ZodSurrealRecord<ZodSurrealString, ZodSurrealJSONSchema>,
  ]
>;
type _ZodSurrealJSONSchemaInternals = _ZodSurrealJSONSchema["_zod"];

export interface ZodJSONSchemaInternals extends _ZodSurrealJSONSchemaInternals {
  output: core.util.JSONType;
  input: core.util.JSONType;
  dboutput: core.util.JSONType;
  dbinput: core.util.JSONType;
}
export interface ZodSurrealJSONSchema extends _ZodSurrealJSONSchema {
  _zod: ZodJSONSchemaInternals;
}

export function json(
  params?: string | core.$ZodCustomParams,
): ZodSurrealJSONSchema {
  const jsonSchema: any = lazy(() => {
    return union([
      string(params),
      number(),
      boolean(),
      _null(),
      array(jsonSchema),
      record(string(), jsonSchema),
    ]);
  });

  return jsonSchema;
}

////////////////////////////////////////////////////
////////////////////////////////////////////////////
//////////                                //////////
//////////      ZodSurrealPreprocess      //////////
//////////                                //////////
////////////////////////////////////////////////////
////////////////////////////////////////////////////

// /** @deprecated Use `z.pipe()` and `z.transform()` instead. */
export function preprocess<A, U extends _core_.$SomeSurrealType, B = unknown>(
  fn: (arg: B, ctx: core.$RefinementCtx) => A,
  schema: U,
): ZodSurrealPipe<ZodSurrealTransform<A, B>, U> {
  return pipe(transform(fn as any), schema as any) as any;
}

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealRecordId      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export type ZodSurrealRecordIdValue = _core_.$ZodSurrealType<
  RecordIdValue | undefined,
  unknown,
  RecordIdValue,
  unknown
>;

export type inferRecordIdValue<Id extends ZodSurrealRecordIdValue> =
  Id extends {
    _zod: {
      output: any;
    };
  }
  ? Id["_zod"]["output"]
  : RecordIdValue;

export type inferRecordIdTable<T extends ZodSurrealdRecordId<string, any>> =
  T extends ZodSurrealdRecordId<infer N> ? N : never;

export interface ZodSurrealRecordIdDef<
  Table extends string = string,
  Id extends ZodSurrealRecordIdValue = ZodSurrealRecordIdValue,
> extends ZodSurrealTypeDef {
  innerType: Id;
  table?: Table[];

  surreal: {
    type?: undefined;
  };
}

interface ZodSurrealRecordIdExtras {
  output?: null | undefined;
  input?: null | undefined;
  dboutput?: null | undefined;
  dbinput?: null | undefined;
}

type PartialRangeTuple<T extends any[]> = T extends [infer Head, ...infer Tail]
  ? Head extends RecordId
  ? [
    (Head | StringRecordId | Range<any, any> | null | undefined)?,
    ...PartialRangeTuple<Tail>,
  ]
  : [(Head | Range<any, any> | null | undefined)?, ...PartialRangeTuple<Tail>]
  : [];

type PartialRangePart<T extends RecordIdValue> =
  | null
  | undefined
  | (T extends [infer A, ...infer Rest]
    ? PartialRangeTuple<T>
    : T extends (infer Item)[]
    ? (Item | Range<any, any> | null | undefined)[]
    : T extends {}
    ? {
      [K in keyof T]?: T[K] extends RecordIdValue
      ? PartialRangePart<T[K]>
      : T[K];
    }
    : T);

export interface ZodSurrealRecordIdInternals<
  Table extends string = string,
  Id extends ZodSurrealRecordIdValue = ZodSurrealRecordIdValue,
  Extras extends ZodSurrealRecordIdExtras = {},
> extends ZodSurrealTypeInternals<
  // O
  | RecordId<Table, Exclude<core.output<Id>, undefined>>
  | (Extras extends { output: infer Output } ? Output : never),
  // I
  | RecordId<Table, Exclude<core.output<Id>, undefined>>
  | StringRecordId
  | (Extras extends { input: infer Input } ? Input : never),
  // DBO
  | RecordId<Table, _core_.dboutput<Id>>
  | (Extras extends { dboutput: infer DBOutput } ? DBOutput : never),
  // DBI
  | RecordId<Table, _core_.dboutput<Id>>
  | StringRecordId
  | (Extras extends { dbinput: infer DBInput } ? DBInput : never)
> {
  def: ZodSurrealRecordIdDef<Table, Id>;
}

type AnyTableRecordIdTrait<
  Tb extends string,
  Id extends ZodSurrealRecordIdValue,
> = {
  parse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): RecordId<
    Tb,
    Ctx extends { db: any }
    ? _core_.dboutput<Id>
    : Exclude<core.output<Id>, undefined>
  >;
  parseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeParse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeParseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >
  >;
  decode<Ctx extends ParseDbContext>(
    id: RecordId<Tb, Exclude<core.output<Id>, undefined>> | StringRecordId,
    params?: Ctx,
  ): RecordId<
    Tb,
    Ctx extends { db: any }
    ? _core_.dboutput<Id>
    : Exclude<core.output<Id>, undefined>
  >;
  decodeAsync<Ctx extends ParseDbContext>(
    id: RecordId<Tb, Exclude<core.output<Id>, undefined>> | StringRecordId,
    params?: Ctx,
  ): Promise<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeDecode<Ctx extends ParseDbContext>(
    id: RecordId<Tb, Exclude<core.output<Id>, undefined>> | StringRecordId,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeDecodeAsync<Ctx extends ParseDbContext>(
    id: RecordId<Tb, Exclude<core.output<Id>, undefined>> | StringRecordId,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >
  >;

  fromParts<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ?
    | RecordId<
      Tb,
      // @ts-expect-error: output intersected above
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
    | undefined
    : RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >;
  fromPartsAsync<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? Promise<
      | RecordId<
        Tb,
        // @ts-expect-error: output intersected above
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
      | undefined
    >
    : Promise<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >;
  safeFromParts<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? classic.ZodSafeParseResult<
      | RecordId<
        Tb,
        // @ts-expect-error: output intersected above
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
      | undefined
    >
    : classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >;
  safeFromPartsAsync<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? Promise<
      classic.ZodSafeParseResult<
        | RecordId<
          Tb,
          // @ts-expect-error: output intersected above
          Ctx extends { db: any }
          ? _core_.dboutput<Id>
          : Exclude<core.output<Id>, undefined>
        >
        | undefined
      >
    >
    : Promise<
      classic.ZodSafeParseResult<
        RecordId<
          Tb,
          Ctx extends { db: any }
          ? _core_.dboutput<Id>
          : Exclude<core.output<Id>, undefined>
        >
      >
    >;
};

type SpecificTableRecordIdTrait<
  Tb extends string,
  Id extends ZodSurrealRecordIdValue,
> = {
  parse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): RecordId<
    Tb,
    Ctx extends { db: any }
    ? _core_.dboutput<Id>
    : Exclude<core.output<Id>, undefined>
  >;
  parseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeParse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeParseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >
  >;
  decode<Ctx extends ParseDbContext>(
    data: core.output<Id> | StringRecordId,
    params?: Ctx,
  ): RecordId<
    Tb,
    Ctx extends { db: any }
    ? _core_.dboutput<Id>
    : Exclude<core.output<Id>, undefined>
  >;
  decodeAsync<Ctx extends ParseDbContext>(
    data: core.output<Id> | StringRecordId,
    params?: Ctx,
  ): Promise<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeDecode<Ctx extends ParseDbContext>(
    data: core.output<Id> | StringRecordId,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeDecodeAsync<Ctx extends ParseDbContext>(
    data: core.output<Id> | StringRecordId,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >
  >;

  fromParts<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ?
    | RecordId<
      Tb,
      // @ts-expect-error: output intersected above
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
    | undefined
    : RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >;
  fromPartsAsync<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? Promise<
      | RecordId<
        Tb,
        // @ts-expect-error: output intersected above
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
      | undefined
    >
    : Promise<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >;
  safeFromParts<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? classic.ZodSafeParseResult<
      | RecordId<
        Tb,
        // @ts-expect-error: output intersected above
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
      | undefined
    >
    : classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >;
  safeFromPartsAsync<Ctx extends ParseDbContext>(
    table: Tb,
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): undefined extends core.output<Id>
    ? Promise<
      classic.ZodSafeParseResult<
        | RecordId<
          Tb,
          // @ts-expect-error: output intersected above
          Ctx extends { db: any }
          ? _core_.dboutput<Id>
          : Exclude<core.output<Id>, undefined>
        >
        | undefined
      >
    >
    : Promise<
      classic.ZodSafeParseResult<
        RecordId<
          Tb,
          Ctx extends { db: any }
          ? _core_.dboutput<Id>
          : Exclude<core.output<Id>, undefined>
        >
      >
    >;

  fromId<Ctx extends ParseDbContext>(
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): RecordId<
    Tb,
    Ctx extends { db: any }
    ? _core_.dboutput<Id>
    : Exclude<core.output<Id>, undefined>
  >;
  fromIdAsync<Ctx extends ParseDbContext>(
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): Promise<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeFromId<Ctx extends ParseDbContext>(
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    RecordId<
      Tb,
      Ctx extends { db: any }
      ? _core_.dboutput<Id>
      : Exclude<core.output<Id>, undefined>
    >
  >;
  safeFromIdAsync<Ctx extends ParseDbContext>(
    id: Ctx extends { db: any }
      ? core.output<Id>
      : Exclude<core.output<Id>, undefined>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      RecordId<
        Tb,
        Ctx extends { db: any }
        ? _core_.dboutput<Id>
        : Exclude<core.output<Id>, undefined>
      >
    >
  >;

  fromRange(
    from:
      | PartialRangePart<_core_.dboutput<Id>>
      | Bound<PartialRangePart<_core_.dboutput<Id>>>
      | null
      | undefined,
    to:
      | PartialRangePart<_core_.dboutput<Id>>
      | Bound<PartialRangePart<_core_.dboutput<Id>>>
      | null
      | undefined,
  ): RecordIdRange<Tb, _core_.dboutput<Id>>;

  fromString(id: string): StringRecordId;
};

type ZodSurrealRecordIdTrait<
  Tb extends string,
  Id extends ZodSurrealRecordIdValue,
  Extras extends ZodSurrealRecordIdExtras = {},
> = string extends Tb
  ? AnyTableRecordIdTrait<Tb, Id>
  : UnionToTuple<Tb> extends { length: 1 }
  ? SpecificTableRecordIdTrait<Tb, Id>
  : AnyTableRecordIdTrait<Tb, Id>;

export type ZodSurrealdRecordId<
  Table extends string = string,
  Id extends ZodSurrealRecordIdValue = ZodSurrealRecordIdValue,
  Extras extends ZodSurrealRecordIdExtras = {},
> = Omit<
  _ZodSurrealType<ZodSurrealRecordIdInternals<Table, Id, Extras>>,
  | ParsingEncodingDecodingMethodNames
  | "optional"
  | "nullable"
  | "nullish"
  | "nonoptional"
> &
  ZodSurrealRecordIdTrait<Table, Id, Extras> &
  ZodSurrealFieldMethods & {
    anytable(): ZodSurrealdRecordId<string, Id, Extras>;

    table<const NewTable extends string | string[]>(
      table: NewTable,
    ): ZodSurrealdRecordId<
      NewTable extends string ? NewTable : NewTable[number],
      Id,
      Extras
    >;

    /** @alias id */
    type<NewType extends ZodSurrealRecordIdValue>(
      innerType: NewType,
    ): ZodSurrealdRecordId<Table, NewType, Extras>;
    /** @alias value */
    id<NewType extends ZodSurrealRecordIdValue>(
      innerType: NewType,
    ): ZodSurrealdRecordId<Table, NewType, Extras>;
    /** @alias type */
    value<NewType extends ZodSurrealRecordIdValue>(
      innerType: NewType,
    ): ZodSurrealdRecordId<Table, NewType, Extras>;

    // Wrappers
    optional(): ZodSurrealdRecordId<
      Table,
      Id,
      Omit<Extras, "input" | "output"> & {
        output: undefined | (Extras extends { output: infer O } ? O : never);
        input: undefined | (Extras extends { input: infer I } ? I : never);
      }
    >;
    nullable(): ZodSurrealdRecordId<
      Table,
      Id,
      Omit<Extras, "input" | "output"> & {
        output: null | (Extras extends { output: infer O } ? O : never);
        input: null | (Extras extends { input: infer I } ? I : never);
      }
    >;
    nullish(): ZodSurrealdRecordId<
      Table,
      Id,
      Omit<Extras, "input" | "output"> & {
        output:
        | null
        | undefined
        | (Extras extends { output: infer O } ? O : never);
        input:
        | null
        | undefined
        | (Extras extends { input: infer I } ? I : never);
      }
    >;
    nonoptional(): ZodSurrealdRecordId<
      Table,
      Id,
      Omit<Extras, "input" | "output"> & {
        output: Extras extends { output: infer O }
        ? Exclude<O, undefined>
        : never;
        input: Extras extends { input: infer I }
        ? Exclude<I, undefined>
        : never;
      }
    >;
  };

function normalizeRecordIdDef(def: ZodSurrealRecordIdDef) {
  const { type, context } = inferSurrealType(def.innerType);
  const isValid = Array.from(context.type).every(
    (option) =>
      ["any", "string", "number", "int", "array", "object"].includes(option) ||
      option.startsWith("array<") ||
      option.startsWith("[") ||
      option.startsWith("{") ||
      option.startsWith("'") ||
      option.startsWith('"') ||
      /^\d+(\.\d+)?f?$/.test(option),
  );

  if (!isValid) {
    throw new Error(`${type} is not valid as a RecordId's value`);
  }

  return {
    ...def,
  };
}

// /* instanbul ignore next */
// function parseRecordIdString(id: string) {
//   let table = "";
//   let value: RecordIdValue = "";

//   const match = id.match(/^(?:⟨(.*)⟩|`(.*)`|(.*)):(?:⟨(.*)⟩|`(.*)`|(.*))$/);
//   if (!match) {
//     throw new Error(`Invalid record id string: ${id}`);
//   }

//   table = (match[1] ?? match[2] ?? match[2] ?? "").replace(/\\⟩/g, "⟩");
//   value = match[4] ?? match[5] ?? match[6] ?? "";
//   // check if value is a number
//   value = parseSurrealValue(value);
//   // console.log("result:", value);

//   return new RecordId(table, value);
// }
// /* instanbul ignore stop */

// type ParserContext = {
//   in: "root" | "array" | "object";
//   acc: string;
//   path: ("array" | "object")[];
// };

// function parseSurrealValue(str: string) {
//   const stack: {
//     in: "root" | "array" | "object";
//     value: any;
//   }[] = [];
//   let ctx: ParserContext = {
//     in: "root",
//     acc: "",
//     path: [],
//   };
//   let value: any;

//   function expr() {
//     const parsed = ctx.acc;
//     // Decimal with optional exponent
//     if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?dec$/i.test(parsed)) {
//       return new Decimal(parsed.slice(0, -3));
//     }

//     // Strict integer → Number | BigInt
//     if (/^[-+]?\d+f?$/.test(parsed)) {
//       const asBigInt = BigInt(parsed.replace(/f$/i, ""));
//       if (
//         asBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
//         asBigInt < BigInt(Number.MIN_SAFE_INTEGER)
//       ) {
//         return asBigInt;
//       }
//       return Number(parsed.replace(/f$/i, ""));
//     }

//     // Float or exponent → Number
//     if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?f?$/i.test(parsed)) {
//       return Number(parsed.replace(/f$/, ""));
//     }

//     return parsed;
//   }

//   function enter(type: "array" | "object") {
//     if (ctx.in !== "root") {
//       stack.push({ in: ctx.in, value });
//     }
//     ctx.in = type;
//     if (type === "array") {
//       value = [];
//     } else if (type === "object") {
//       value = {};
//     }
//   }

//   function exit() {
//     if (ctx.in === "array" && ctx.acc) {
//       nextArray();
//     }
//     const popped = stack.pop();
//     if (!popped) {
//       return;
//     }
//     value = popped.value;
//     ctx.in = popped.in;
//     ctx.acc = "";
//   }

//   function nextArray() {
//     (value as any[]).push(expr());
//   }

//   for (let i = 0; i < str.length; i++) {
//     const ch = str[i];
//     if (ch === "[") {
//       enter("array");
//     } else if (ch === "{") {
//       enter("object");
//     } else if (ch === "]") {
//       exit();
//     } else if (ch === "}") {
//       exit();
//     } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
//       continue;
//     } else if (ch === ",") {
//       if (ctx.in === "array") nextArray();
//       ctx.acc = "";
//     } else {
//       ctx.acc += ch;
//     }
//     // console.log(inspect({ ...ctx, stack }, { depth: Infinity, colors: true }));
//   }

//   return value;
// }

export const ZodSurrealdRecordId: core.$constructor<ZodSurrealdRecordId> =
  core.$constructor("ZodSurrealRecordId", (inst, def) => {
    ZodSurrealType.init(inst as any, def);
    ZodSurrealField.init(inst as any, def as any);

    // surreal internals
    const normalized = normalizeRecordIdDef(def);

    inst.anytable = () => {
      return inst.clone({
        ...def,
        table: undefined,
      }) as any;
    };

    inst.table = (table) => {
      return inst.clone({
        ...inst._zod.def,
        table: Array.isArray(table) ? table : [table],
      }) as any;
    };

    inst.type = (innerType) => {
      return inst.clone({
        ...inst._zod.def,
        innerType,
      }) as any;
    };
    inst.id = inst.type;
    inst.value = inst.type;

    // ------- Parsing/Encoding/Decoding -------
    inst.fromParts = (
      table: string,
      id: RecordIdValue,
      params?: ParseDbContext,
    ) => {
      const inner = def.innerType as core.$ZodType;
      if (id === undefined) {
        const res = core.safeDecode(inner, id, params);
        if (res.error) {
          for (const issue of res.error.issues) {
            issue.path.unshift("id");
          }
          throw res.error;
        }
        id = res.data as RecordIdValue;
        if (id === undefined) {
          return undefined;
        }
      }
      return inst.decode(new RecordId(table, id), params);
    };

    inst.fromPartsAsync = async (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => {
      const inner = def.innerType as core.$ZodType;
      if (id === undefined) {
        const res = await core.safeDecodeAsync(inner, id, params);
        if (res.error) {
          for (const issue of res.error.issues) {
            issue.path.unshift("id");
          }
          throw res.error;
        }
        id = res.data as RecordIdValue;
      }

      return inst.decodeAsync(new RecordId(table, id), params);
    };

    inst.safeFromParts = (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => {
      const inner = def.innerType as core.$ZodType;
      if (id === undefined) {
        const res = core.safeDecode(inner, id, params);
        if (res.error) {
          for (const issue of res.error.issues) {
            issue.path.unshift("id");
          }
          throw res.error;
        }
        id = res.data as RecordIdValue;
      }

      return inst.safeDecode(new RecordId(table, id), params);
    };

    inst.safeFromPartsAsync = async (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => {
      const inner = def.innerType as core.$ZodType;
      if (id === undefined) {
        const res = await core.safeDecodeAsync(inner, id, params);
        if (res.error) {
          for (const issue of res.error.issues) {
            issue.path.unshift("id");
          }
          throw res.error;
        }
        id = res.data as RecordIdValue;
      }

      return inst.safeDecodeAsync(new RecordId(table, id), params);
    };

    if (normalized.table?.length === 1) {
      const _inst = inst as any;
      _inst.fromId = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) => {
        const inner = def.innerType as core.$ZodType;
        if (id === undefined) {
          const res = core.safeDecode(inner, id, params);
          if (res.error) {
            for (const issue of res.error.issues) {
              issue.path.unshift("id");
            }
            throw res.error;
          }
          id = res.data as RecordIdValue;
        }

        return _inst.decode(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );
      };

      _inst.fromIdAsync = async (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) => {
        const inner = def.innerType as core.$ZodType;
        if (id === undefined) {
          const res = await core.safeDecodeAsync(inner, id, params);
          if (res.error) {
            for (const issue of res.error.issues) {
              issue.path.unshift("id");
            }
            throw res.error;
          }
          id = res.data as RecordIdValue;
        }

        return _inst.decodeAsync(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );
      };

      _inst.safeFromId = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) => {
        const inner = def.innerType as core.$ZodType;
        if (id === undefined) {
          const res = core.safeDecode(inner, id, params);
          if (res.error) {
            for (const issue of res.error.issues) {
              issue.path.unshift("id");
            }
            throw res.error;
          }
          id = res.data as RecordIdValue;
        }

        return _inst.safeDecode(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );
      };

      _inst.safeFromIdAsync = async (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) => {
        const inner = def.innerType as core.$ZodType;
        if (id === undefined) {
          const res = await core.safeDecodeAsync(inner, id, params);
          if (res.error) {
            for (const issue of res.error.issues) {
              issue.path.unshift("id");
            }
            throw res.error;
          }
          id = res.data as RecordIdValue;
        }

        return _inst.safeDecodeAsync(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );
      };

      _inst.fromRange = (
        from: RecordIdValue | Bound<RecordIdValue>,
        to: RecordIdValue | Bound<RecordIdValue>,
      ) =>
        new RecordIdRange(
          normalized.table?.[0] ?? "",
          from instanceof BoundExcluded || from instanceof BoundIncluded
            ? (from as any)
            : new BoundIncluded(from),
          to instanceof BoundExcluded || to instanceof BoundIncluded
            ? (to as any)
            : new BoundExcluded(to),
        );
    }

    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof RecordId) {
        if (
          normalized.table &&
          !normalized.table.includes(payload.value.table.name)
        ) {
          payload.issues.push({
            code: "invalid_value",
            values: normalized.table,
            input: payload.value.table.name,
            message:
              normalized.table.length > 1
                ? `Expected RecordId's table to be one of ${normalized.table.map(escapeIdent).join(" | ")} but found ${payload.value.table.name}`
                : `Expected RecordId's table to be ${normalized.table[0]} but found ${payload.value.table.name}`,
          });
        }

        const schema = normalized.innerType._zod;
        const result = schema.run({ value: payload.value.id, issues: [] }, ctx);

        if (result instanceof Promise) {
          return result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(
                ...core.util.prefixIssues("id", result.issues),
              );
            }
            payload.value = new RecordId(
              payload.value.table.name,
              result.value as any,
            );
            return payload;
          });
        } else if (result.issues.length) {
          payload.issues.push(...core.util.prefixIssues("id", result.issues));
        } else {
          payload.value = new RecordId(
            payload.value.table.name,
            result.value as any,
          );
        }
      } else {
        payload.issues.push({
          code: "invalid_type",
          expected: "record_id",
          input: payload.value,
        });
      }

      return payload;
    };

    return inst;
  });

export function recordId<
  const W extends string | string[],
  I extends ZodSurrealRecordIdValue = ZodSurrealRecordIdValue,
>(
  what?: W,
  innerType?: I,
): ZodSurrealdRecordId<W extends string ? W : W[number], I> {
  return new ZodSurrealdRecordId({
    type: "any",
    table: what ? (Array.isArray(what) ? what : [what]) : undefined,
    innerType: innerType ?? any(),

    surreal: {},
  }) as any;
}

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      SurrealZodTable      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export type SurrealZodTableFields = {
  [key: string]: _core_.$ZodSurrealType;
};

export type SurrealZodTableRelationFields = {
  [K in "in" | "out"]?: ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>;
} & {
  [key: string]: _core_.$ZodSurrealType;
};

/**
 * Normalizes the fields of a table schema to include the id field if it is not present.
 * If the id field is present, it will be normalized using the table name and the inner type.
 */
type NormalizedIdField<
  TableName extends string,
  Fields extends SurrealZodTableFields,
  FieldName extends string,
> = {
    [K in keyof Fields | FieldName]: K extends FieldName
    ? Fields extends { [P in FieldName]: infer F }
    ? F extends ZodSurrealdRecordId<any, infer T>
    ? ZodSurrealdRecordId<TableName, T>
    : F extends ZodSurrealRecordIdValue
    ? ZodSurrealdRecordId<TableName, F>
    : ZodSurrealdRecordId<TableName>
    : ZodSurrealdRecordId<TableName>
    : K extends keyof Fields
    ? Fields[K]
    : never;
  };

export type NormalizedFields<
  TableName extends string = string,
  Fields extends SurrealZodTableFields = {},
> = NormalizedIdField<TableName, Fields, "id">;

export type SetConfig<Key extends string, Value> = {
  [key in Key]: Value;
};
export type MergeConfig<
  A extends Partial<SurrealZodTableConfig>,
  B extends Partial<SurrealZodTableConfig>,
> = Omit<A, keyof B> & B;
export type SurrealZodTableConfigSchemafull = SetConfig<"catchall", {}>;
export type SurrealZodTableConfigSchemaless = SetConfig<
  "catchall",
  Record<string, unknown>
>;
export type SurrealZodTableConfig = {
  catchall: any;
};

export interface SurrealZodTableDef<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = SurrealZodTableConfig,
> extends ZodSurrealTypeDef {
  type: "table";
  name: Name;
  fields: NormalizedFields<Name, Fields> & Config["catchall"];
  catchall?: _core_.$ZodSurrealType;

  surreal: {
    type?: undefined;
    tableType: "any" | "normal" | "relation";
    schemafull: boolean;
    drop: boolean;
    comment?: string;
  };
}

export interface ZodSurrealTableInternals<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = MergeConfig<
    SurrealZodTableConfig,
    SurrealZodTableConfigSchemaless
  >,
> extends ZodSurrealTypeInternals<
  core.$InferObjectOutput<Fields, Config["catchall"]>,
  core.$InferObjectInput<Fields, Config["catchall"]>,
  _core_.$InferObjectDbOutput<Fields, Config["catchall"]>,
  _core_.$InferObjectDbInput<Fields, Config["catchall"]>
> {
  def: SurrealZodTableDef<Name, Fields, Config>;
}

export type TableKind = "any" | "normal" | "relation";

type RelationMethods<
  Name extends string,
  Fields extends SurrealZodTableFields,
  Config extends SurrealZodTableConfig,
> = {
  from<
    NewFrom extends
    | string
    | string[]
    | ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>,
  >(
    from: NewFrom,
  ): ZodSurrealTable<
    Name,
    Omit<Fields, "in"> & { in: toRecordId<NewFrom> },
    Config,
    "relation"
  >;

  to<
    NewTo extends
    | string
    | string[]
    | ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>,
  >(
    to: NewTo,
  ): ZodSurrealTable<
    Name,
    Omit<Fields, "out"> & { out: toRecordId<NewTo> },
    Config,
    "relation"
  >;

  in: RelationMethods<Name, Fields, Config>["from"];
  out: RelationMethods<Name, Fields, Config>["to"];
};

type MaybeRelationMethods<
  Kind extends TableKind,
  Name extends string,
  Fields extends SurrealZodTableFields,
  Config extends SurrealZodTableConfig,
> = Kind extends "relation" ? RelationMethods<Name, Fields, Config> : {};

type TableMask<Keys extends PropertyKey, Kind extends TableKind> = {
  [K in Exclude<
    Keys,
    "id" | (Kind extends "relation" ? "in" | "out" : never)
  >]?: true;
} & {
  id?: boolean;
} & (Kind extends "relation"
  ? {
    in?: boolean;
    out?: boolean;
  }
  : {});

export type ZodSurrealTable<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = MergeConfig<
    SurrealZodTableConfig,
    SurrealZodTableConfigSchemaless
  >,
  Kind extends TableKind = "any",
> = _core_.$ZodSurrealType<
  any,
  any,
  any,
  any,
  ZodSurrealTableInternals<Name, NormalizedFields<Name, Fields>, Config>
> &
  MaybeRelationMethods<Kind, Name, Fields, Config> &
  ParsingEncodingDecodingMethods<
    ZodSurrealTable<Name, Fields, Config, Kind>
  > & {
    clone(
      def?: ZodSurrealTableInternals<
        Name,
        NormalizedFields<Name, Fields>,
        Config
      >["def"],
      params?: { parent: boolean },
    ): ZodSurrealTable<Name, Fields, Config, Kind>;
    register<R extends core.$ZodRegistry>(
      registry: R,
      ...meta: ZodSurrealTable<Name, Fields, Config, Kind> extends R["_schema"]
        ? undefined extends R["_meta"]
        ? [
          core.$replace<
            R["_meta"],
            ZodSurrealTable<Name, Fields, Config, Kind>
          >?,
        ]
        : [
          core.$replace<
            R["_meta"],
            ZodSurrealTable<Name, Fields, Config, Kind>
          >,
        ]
        : ["Incompatible schema"]
    ): ZodSurrealTable<Name, Fields, Config, Kind>;

    name<NewName extends string>(
      name: NewName,
    ): ZodSurrealTable<NewName, Fields, Config, Kind>;
    fields<
      NewFields extends Kind extends "relation"
      ? SurrealZodTableRelationFields
      : SurrealZodTableFields,
    >(
      fields: NewFields,
    ): ZodSurrealTable<
      Name,
      Kind extends "relation"
      ? {
        [K in "in" | "out" as K extends keyof NewFields
        ? K
        : never]: NewFields[K];
      } & {
        [K in "in" | "out" as K extends keyof NewFields
        ? never
        : K extends keyof Fields
        ? K
        : never]: Fields[K];
      } & Omit<NewFields, "in" | "out">
      : NewFields,
      Config,
      Kind
    >;
    schemafull(): ZodSurrealTable<
      Name,
      Fields,
      MergeConfig<Config, SurrealZodTableConfigSchemafull>,
      Kind
    >;
    schemaless(): ZodSurrealTable<
      Name,
      Fields,
      MergeConfig<Config, SurrealZodTableConfigSchemaless>,
      Kind
    >;

    any(): ZodSurrealTable<Name, Fields, Config, "any">;
    normal(): ZodSurrealTable<Name, Fields, Config, "normal">;
    relation(): ZodSurrealTable<
      Name,
      {
        [K in "in" | "out"]: Fields[K] extends ZodSurrealdRecordId
        ? Fields[K]
        : ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>;
      } & Omit<Fields, "in" | "out">,
      Config,
      "relation"
    >;

    drop(): ZodSurrealTable<Name, Fields, Config, Kind>;
    nodrop(): ZodSurrealTable<Name, Fields, Config, Kind>;
    comment(comment: string): ZodSurrealTable<Name, Fields, Config, Kind>;

    record(): NormalizedIdField<Name, Fields, "id">["id"];
    dto(): ZodSurrealObject<
      Omit<NormalizedFields<Name, Fields>, "id"> & {
        id: ZodSurrealOptional<NormalizedFields<Name, Fields>["id"]>;
      },
      {
        in: Config["catchall"];
        out: Config["catchall"];
      }
    >;
    table(): Table<Name>;

    toSurql(
      statement?: "define",
      options?: DefineTableOptions,
    ): BoundQuery<[undefined]>;
    toSurql(
      statement: "remove",
      options?: RemoveTableOptions,
    ): BoundQuery<[undefined]>;
    toSurql(statement: "info"): BoundQuery<[TableInfo]>;
    toSurql(statement: "structure"): BoundQuery<[TableStructure]>;

    // object-like methods

    extend<
      ExtraFields extends Kind extends "relation"
      ? SurrealZodTableRelationFields
      : SurrealZodTableFields,
    >(
      extraFields: ExtraFields,
    ): ZodSurrealTable<
      Name,
      core.util.Extend<Fields, ExtraFields>,
      Config,
      Kind
    >;

    safeExtend<
      ExtraFields extends Kind extends "relation"
      ? SurrealZodTableRelationFields
      : SurrealZodTableFields,
    >(
      shape: SafeExtendShape<Fields, ExtraFields> &
        Partial<Record<keyof Fields, core.SomeType>>,
    ): ZodSurrealTable<
      Name,
      core.util.Extend<Fields, ExtraFields>,
      Config,
      Kind
    >;

    pick<M extends TableMask<keyof Fields, Kind>>(
      mask: M,
    ): M extends { id: false }
      ? ZodSurrealObject<
        core.util.Flatten<
          Pick<Fields, Extract<Exclude<keyof Fields, "id">, keyof M>>
        >,
        {
          out: Config["catchall"];
          in: Config["catchall"];
        }
      >
      : ZodSurrealTable<
        Name,
        core.util.Flatten<
          Pick<Fields, Extract<keyof Fields, keyof M | "id">>
        >,
        Config,
        Kind
      >;

    omit<M extends TableMask<keyof Fields, Kind>>(
      mask: M,
    ): M extends { id: true }
      ? ZodSurrealObject<
        core.util.Flatten<Omit<Fields, Extract<keyof Fields, keyof M>>>,
        {
          in: Config["catchall"];
          out: Config["catchall"];
        }
      >
      : ZodSurrealTable<
        Name,
        core.util.Flatten<Omit<Fields, Extract<keyof Fields, keyof M>>>,
        Config,
        Kind
      >;

    /**
     * @returns a table schema that is partial for all fields, except for `id`
     */
    partial(): ZodSurrealTable<
      Name,
      {
        [k in keyof Fields]: ZodSurrealOptional<Fields[k]>;
      },
      Config,
      Kind
    >;

    /**
     * @returns an object schema that is partial for all fields, including `id`.
     * This is equivalent to calling `.dto().partial()`
     */
    partial(mask: true): ZodSurrealObject<
      core.util.Flatten<{
        [k in keyof Fields | "id"]: k extends "id"
        ? Fields["id"] extends ZodSurrealdRecordId<infer N, infer I>
        ? ZodSurrealOptional<ZodSurrealdRecordId<N, I>>
        : ZodSurrealOptional<
          ZodSurrealdRecordId<Name, ZodSurrealRecordIdValue>
        >
        : ZodSurrealOptional<Fields[k]>;
      }>,
      {
        out: Config["catchall"];
        in: Config["catchall"];
      }
    >;

    /**
     * @returns an object schema that is partial for the fields specified in
     * the mask, if id is specified in the mask, it will be marked as optional
     * and an object schema will be returned instead of a table schema.
     */
    partial<M extends TableMask<keyof Fields, Kind>>(
      mask?: M,
    ): M extends { id: true }
      ? ZodSurrealObject<
        core.util.Flatten<{
          [k in keyof Fields | "id"]: k extends keyof M
          ? k extends "id"
          ? Fields["id"] extends ZodSurrealdRecordId<
            infer N,
            infer I,
            infer E
          >
          ? ZodSurrealOptional<ZodSurrealdRecordId<N, I, E>>
          : ZodSurrealOptional<
            ZodSurrealdRecordId<Name, ZodSurrealRecordIdValue>
          >
          : ZodSurrealOptional<Fields[k]>
          : Fields[k];
        }>,
        {
          out: Config["catchall"];
          in: Config["catchall"];
        }
      >
      : ZodSurrealTable<
        Name,
        {
          [k in keyof Fields]: k extends keyof M
          ? ZodSurrealOptional<Fields[k]>
          : Fields[k];
        },
        Config,
        Kind
      >;

    required(): ZodSurrealTable<
      Name,
      {
        [k in keyof Fields]: ZodSurrealNonOptional<Fields[k]>;
      },
      Config,
      Kind
    >;
    required<M extends core.util.Mask<keyof Fields>>(
      mask: M,
    ): ZodSurrealTable<
      Name,
      {
        [k in keyof Fields]: k extends keyof M
        ? ZodSurrealNonOptional<Fields[k]>
        : Fields[k];
      },
      Config,
      Kind
    >;
  };

function handleFieldResult(
  result: core.ParsePayload,
  final: core.ParsePayload,
  field: PropertyKey,
  input: Record<PropertyKey, unknown>,
) {
  if (result.issues.length) {
    final.issues.push(...core.util.prefixIssues(field, result.issues));
  }

  if (result.value === undefined) {
    if (field in input) {
      // @ts-expect-error: field not index-checked on final.value, doesnt matter
      final.value[field] = undefined;
    }
  } else {
    // @ts-expect-error: field not index-checked on final.value, doesnt matter
    final.value[field] = result.value;
  }
}

function handleCatchall(
  promises: Promise<any>[],
  input: Record<PropertyKey, unknown>,
  payload: core.ParsePayload,
  ctx: core.ParseContext,
  def: ReturnType<typeof normalizeTableDef>,
  inst: ZodSurrealTable,
) {
  const unrecognized: string[] = [];
  const known = def.fieldNamesSet;
  const _catchall = def.catchall!._zod;
  const type = _catchall.def.type;
  for (const field in input) {
    if (known.has(field)) continue;
    if (type === "never") {
      unrecognized.push(field);
      continue;
    }

    const result = _catchall.run({ value: input[field], issues: [] }, ctx);
    if (result instanceof Promise) {
      promises.push(
        result.then((result) =>
          handleFieldResult(result, payload, field, input),
        ),
      );
    } else {
      handleFieldResult(result, payload, field, input);
    }
  }

  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
    });
  }

  if (!promises.length) return payload;
  return Promise.all(promises).then(() => payload);
}

function normalizeTableDef(def: SurrealZodTableDef) {
  const fields: Record<string, _core_.$ZodSurrealType> = {};
  const fieldNames = Object.keys(def.fields);
  if (!def.fields.id) {
    fields.id = recordId(def.name).type(any());
    fieldNames.push("id");
  } else if (def.fields.id instanceof ZodSurrealdRecordId) {
    fields.id = def.fields.id.table(def.name);
  } else {
    fields.id = recordId(def.name).type(def.fields.id);
  }

  for (const field of fieldNames) {
    if (field === "id") continue;
    fields[field] = def.fields[field];
  }

  return {
    ...def,
    fields,
    fieldNames,
    fieldNamesSet: new Set(fieldNames),
  };
}

export const ZodSurrealTable: core.$constructor<ZodSurrealTable> =
  core.$constructor("SurrealZodTable", (inst, def) => {
    // @ts-expect-error
    core.$ZodType.init(inst, def);

    const normalized = normalizeTableDef(def);
    // @ts-expect-error - through normalization id is always present
    inst._zod.def.fields = normalized.fields;
    const catchall = normalized.catchall;
    const table = new Table(def.name);

    assignParsingMethods(inst as any);

    inst.clone = (def, params) => core.clone(inst as any, def, params);
    inst.register = ((reg: any, meta: any) => {
      reg.add(inst, meta);
      return inst;
    }) as any;

    inst.name = (name) => {
      return inst.clone({
        ...inst._zod.def,
        name,
      }) as any;
    };
    inst.fields = (fields) => {
      if (inst._zod.def.surreal.tableType === "relation") {
        fields = {
          in: inst._zod.def.fields.in ?? recordId().type(any()),
          out: inst._zod.def.fields.out ?? recordId().type(any()),
          ...fields,
        };
      }

      return inst.clone({
        ...inst._zod.def,
        // @ts-expect-error - id may or may not be provided
        fields,
      }) as any;
    };
    // @ts-expect-error - type defined conditionally
    inst.from = (from) => {
      if (inst._zod.def.surreal.tableType !== "relation") {
        throw new Error("Cannot call .from() on a non-relation table");
      }

      return inst.clone({
        ...inst._zod.def,
        fields: {
          ...inst._zod.def.fields,
          in: from instanceof ZodSurrealdRecordId ? from : recordId(from),
        },
      }) as any;
    };
    // @ts-expect-error - type defined conditionally
    inst.to = (to) => {
      if (inst._zod.def.surreal.tableType !== "relation") {
        throw new Error("Cannot call .to() on a non-relation table");
      }

      return inst.clone({
        ...inst._zod.def,
        fields: {
          ...inst._zod.def.fields,
          out: to instanceof ZodSurrealdRecordId ? to : recordId(to),
        },
      }) as any;
    };
    // @ts-expect-error - type defined conditionally
    inst.in = inst.from;
    // @ts-expect-error - type defined conditionally
    inst.out = inst.to;

    inst.any = () => {
      return inst.clone({
        ...inst._zod.def,
        surreal: {
          ...inst._zod.def.surreal,
          tableType: "any",
        },
      }) as any;
    };
    inst.normal = () => {
      return inst.clone({
        ...inst._zod.def,
        surreal: {
          ...inst._zod.def.surreal,
          tableType: "normal",
        },
      }) as any;
    };
    inst.relation = () => {
      return inst.clone({
        ...inst._zod.def,
        fields: {
          in: recordId().type(any()),
          out: recordId().type(any()),
          ...inst._zod.def.fields,
        },
        surreal: {
          ...inst._zod.def.surreal,
          tableType: "relation",
        },
      }) as any;
    };
    inst.comment = (comment) => {
      return inst.clone({
        ...inst._zod.def,
        surreal: {
          ...inst._zod.def.surreal,
          comment,
        },
      }) as any;
    };
    inst.schemafull = () => {
      return inst.clone({
        ...inst._zod.def,
        catchall: never(),
        surreal: {
          ...inst._zod.def.surreal,
          schemafull: true,
        },
      }) as any;
    };
    inst.schemaless = () => {
      return inst.clone({
        ...inst._zod.def,
        catchall: unknown(),
        surreal: {
          ...inst._zod.def.surreal,
          schemafull: false,
        },
      }) as any;
    };
    inst.drop = () => {
      return inst.clone({
        ...inst._zod.def,
        surreal: {
          ...inst._zod.def.surreal,
          drop: true,
        },
      }) as any;
    };
    inst.nodrop = () => {
      return inst.clone({
        ...inst._zod.def,
        surreal: {
          ...inst._zod.def.surreal,
          drop: false,
        },
      }) as any;
    };
    inst.record = () => inst._zod.def.fields.id;
    inst.table = () => table;
    inst.dto = () => {
      return new ZodSurrealObject({
        type: "object",
        shape: {
          ...inst._zod.def.fields,
          id: optional(inst._zod.def.fields.id),
        },
        catchall: inst._zod.def.catchall,
        surreal: {},
      }) as any;
    };
    // @ts-expect-error - overloaded
    inst.toSurql = (statement = "define", options) =>
      // @ts-expect-error - overloaded
      tableToSurql(inst, statement, options);

    // @ts-expect-error - false-positive
    inst.extend = (extraFields) => {
      if (!core.util.isPlainObject(extraFields)) {
        throw new Error("Invalid input to extend: expected a plain object");
      }

      const checks = inst._zod.def.checks;
      const hasChecks = checks && checks.length > 0;
      if (hasChecks) {
        throw new Error(
          "Table schemas containing refinements cannot be extended. Use `.safeExtend()` instead.",
        );
      }

      const mergedDef = core.util.mergeDefs(inst._zod.def, {
        get fields() {
          const fields = { ...inst._zod.def.fields, ...extraFields };
          core.util.assignProp(this, "fields", fields); // self-caching
          return fields;
        },
        checks: [],
      });

      return inst.clone(mergedDef);
    };

    // @ts-expect-error - false-positive
    inst.safeExtend = (extraFields) => {
      if (!core.util.isPlainObject(extraFields)) {
        throw new Error("Invalid input to safeExtend: expected a plain object");
      }
      const def = {
        ...inst._zod.def,
        get fields() {
          const fields = { ...inst._zod.def.fields, ...extraFields };
          core.util.assignProp(this, "fields", fields); // self-caching
          return fields;
        },
        checks: inst._zod.def.checks,
      } as any;
      return inst.clone(def);
    };

    inst.pick = (mask) => {
      const currDef = inst._zod.def;

      const def = core.util.mergeDefs(inst._zod.def, {
        get fields() {
          const newFields: Record<string, unknown> = {};
          for (const key in mask) {
            if (!(key in currDef.fields)) {
              throw new Error(`Unrecognized key: "${key}"`);
            }
            if (!mask[key]) continue;
            newFields[key] = currDef.fields[key]!;
          }

          core.util.assignProp(this, "fields", newFields); // self-caching
          return newFields;
        },
        checks: [],
      });

      if ("id" in mask && mask.id === false) {
        return new classic.ZodObject({
          type: "object",
          shape: def.fields,
          catchall: def.catchall,
        }) as any;
      }

      return inst.clone(def) as any;
    };

    inst.omit = (mask) => {
      const currDef = inst._zod.def;

      const def = core.util.mergeDefs(inst._zod.def, {
        get fields() {
          const newFields: Record<string, unknown> = { ...currDef.fields };
          for (const key in mask) {
            if (!(key in currDef.fields)) {
              throw new Error(`Unrecognized key: "${key}"`);
            }
            if (!(mask as any)[key]) continue;

            delete newFields[key];
          }
          core.util.assignProp(this, "fields", newFields); // self-caching
          return newFields;
        },
        checks: [],
      });

      if ("id" in mask && mask.id === true) {
        return new classic.ZodObject({
          type: "object",
          shape: def.fields,
          catchall: def.catchall,
        }) as any;
      }

      return inst.clone(def) as any;
    };

    inst.partial = (mask?: Record<string, boolean> | boolean) => {
      const def = core.util.mergeDefs(inst._zod.def, {
        get fields() {
          const oldFields = inst._zod.def.fields;
          const fields: Record<string, unknown> = { ...oldFields };

          if (typeof mask === "object") {
            for (const key in mask) {
              if (!(key in oldFields)) {
                throw new Error(`Unrecognized key: "${key}"`);
              }
              if (!(mask as any)[key]) continue;
              // if (oldShape[key]!._zod.optin === "optional") continue;
              fields[key] = classic.ZodOptional
                ? new classic.ZodOptional({
                  type: "optional",
                  innerType: oldFields[key]! as any,
                })
                : oldFields[key]!;
            }
          } else {
            for (const key in oldFields) {
              if (key === "id" && mask !== true) continue;

              // if (oldShape[key]!._zod.optin === "optional") continue;
              fields[key] = classic.ZodOptional
                ? new classic.ZodOptional({
                  type: "optional",
                  innerType: oldFields[key]! as any,
                })
                : oldFields[key]!;
            }
          }

          core.util.assignProp(this, "fields", fields); // self-caching
          return fields;
        },
        checks: [],
      });

      if (
        mask === true ||
        (typeof mask === "object" && "id" in mask && mask.id === true)
      ) {
        return new classic.ZodObject({
          type: "object",
          shape: def.fields,
          catchall: def.catchall,
        }) as any;
      }

      return inst.clone(def) as any;
    };

    inst.required = (mask?: Record<string, boolean>) => {
      const def = core.util.mergeDefs(inst._zod.def, {
        get fields() {
          const oldFields = inst._zod.def.fields;
          const fields: Record<string, unknown> = { ...oldFields };

          if (mask) {
            for (const key in mask) {
              if (!(key in fields)) {
                throw new Error(`Unrecognized key: "${key}"`);
              }
              if (!(mask as any)[key]) continue;
              if (key === "id") continue;
              // overwrite with non-optional
              fields[key] = new classic.ZodNonOptional({
                type: "nonoptional",
                innerType: oldFields[key]! as any,
              });
            }
          } else {
            for (const key in oldFields) {
              if (key === "id") continue;

              // overwrite with non-optional
              fields[key] = new classic.ZodNonOptional({
                type: "nonoptional",
                innerType: oldFields[key]! as any,
              });
            }
          }

          core.util.assignProp(this, "fields", fields); // self-caching
          return fields;
        },
        checks: [],
      });

      return inst.clone(def) as any;
    };

    inst._zod.parse = (payload, ctx) => {
      const input = payload.value;

      if (!core.util.isObject(input)) {
        payload.issues.push({
          expected: "object",
          code: "invalid_type",
          input,
        });
        return payload;
      }

      payload.value = {};
      const promises: Promise<any>[] = [];
      const fields = normalized.fields;

      for (const field of normalized.fieldNames) {
        const schema = fields[field]!;

        const result = schema._zod.run(
          { value: input[field], issues: [] },
          ctx,
        );
        if (result instanceof Promise) {
          promises.push(
            result.then((result) => {
              handleFieldResult(result, payload, field, input);
            }),
          );
        } else {
          handleFieldResult(result, payload, field, input);
        }
      }

      if (!catchall) {
        return promises.length
          ? Promise.all(promises).then(() => payload)
          : payload;
      }

      return handleCatchall(promises, input, payload, ctx, normalized, inst);
    };

    return inst;
  });

export function table<Name extends string = string>(name: Name) {
  return new ZodSurrealTable({
    type: "table",
    name,
    // @ts-expect-error - id set in constructor
    fields: {},
    catchall: unknown(),
    dto: false,

    surreal: {
      tableType: "any",
      schemafull: false,
      drop: false,
      comment: undefined,
    },
  }) as unknown as ZodSurrealTable<Name>;
}

export function normalTable<Name extends string = string>(name: Name) {
  return table(name).normal();
}

type toRecordId<
  T extends
  | string
  | string[]
  | ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>,
> = T extends string
  ? T extends ZodSurrealdRecordId<infer N, infer I>
  ? ZodSurrealdRecordId<N, I>
  : ZodSurrealdRecordId<T>
  : T extends string[]
  ? ZodSurrealdRecordId<T[number]>
  : T extends ZodSurrealdRecordId<string, ZodSurrealRecordIdValue>
  ? T
  : never;

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      ZodSurrealDuration      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface ZodSurrealDurationDef extends ZodSurrealTypeDef {
  type: "duration";
  surreal: {
    type: "duration";
  };
}

export interface ZodSurrealDurationInternals
  extends ZodSurrealTypeInternals<Duration, Duration> {
  def: ZodSurrealDurationDef;
}

export interface ZodSurrealDuration
  extends _ZodSurrealType<ZodSurrealDurationInternals>,
  ZodSurrealFieldMethods { }

export const ZodSurrealDuration: core.$constructor<ZodSurrealDuration> =
  core.$constructor("ZodSurrealDuration", (inst, def) => {
    ZodSurrealType.init(inst, def);
    ZodSurrealField.init(inst as any, def as any);

    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof Duration) {
        return payload;
      }

      payload.issues.push({
        code: "invalid_type",
        expected: "duration",
        input: null,
      });

      return payload;
    };

    return inst;
  });

export function duration() {
  return new ZodSurrealDuration({
    type: "duration",
    surreal: {
      type: "duration",
    },
  });
}

// TODO: implement schemas
export const __rest__ = new Range(
  new BoundIncluded(undefined),
  new BoundExcluded(undefined),
);

export type ZodSurrealTypes =
  | ZodSurrealString
  | ZodSurrealNumber
  | ZodSurrealBigInt
  | ZodSurrealBoolean
  | ZodSurrealDate
  | ZodSurrealSymbol
  | ZodSurrealUndefined
  | ZodSurrealNullable
  | ZodSurrealNull
  | ZodSurrealAny
  | ZodSurrealUnknown
  | ZodSurrealNever
  | ZodSurrealVoid
  | ZodSurrealArray
  | ZodSurrealObject
  | ZodSurrealUnion
  | ZodSurrealIntersection
  | ZodSurrealTuple
  | ZodSurrealRecord
  | ZodSurrealMap
  | ZodSurrealSet
  | ZodSurrealLiteral
  | ZodSurrealEnum
  | ZodSurrealFunction
  | ZodSurrealPromise
  | ZodSurrealLazy
  | ZodSurrealOptional
  | ZodSurrealDefault
  | ZodSurrealPrefault
  | ZodSurrealTemplateLiteral
  | ZodSurrealCustom
  | ZodSurrealTransform
  | ZodSurrealNonOptional
  | ZodSurrealReadonly
  | ZodSurrealNaN
  | ZodSurrealPipe
  | ZodSurrealSuccess
  | ZodSurrealCatch
  | ZodSurrealFile;
