import * as core from "zod/v4/core";
import type { ZodSurrealType } from "./schema.js";

//////////////////////////////// API //////////////////////////////////////////

export type Params<
  T extends $ZodSurrealType | core.$ZodCheck,
  IssueTypes extends core.$ZodIssueBase,
  OmitKeys extends keyof T["_zod"]["def"] = never,
> = core.util.Flatten<
  Partial<
    core.util.EmptyToNever<
      Omit<T["_zod"]["def"], OmitKeys> &
        ([IssueTypes] extends [never]
          ? {}
          : {
              error?: string | core.$ZodErrorMap<IssueTypes> | undefined;
              /** @deprecated This parameter is deprecated. Use `error` instead. */
              message?: string | undefined;
            })
    >
  >
>;

export type TypeParams<
  T extends $ZodSurrealType = ZodSurrealType & {
    _isst: never;
  },
  AlsoOmit extends Exclude<
    keyof T["_zod"]["def"],
    "type" | "checks" | "error"
  > = never,
> = Params<
  T,
  NonNullable<T["_zod"]["isst"]>,
  "type" | "checks" | "error" | AlsoOmit
>;

//////////////////////////////// CORE /////////////////////////////////////////

export interface $ZodSurrealTypeDef {
  type:
    | "string"
    | "number"
    | "boolean"
    | "bigint"
    | "symbol"
    | "undefined"
    | "null"
    | "any"
    | "unknown"
    | "never"
    | "void"
    | "date"
    | "array"
    | "object"
    | "union"
    | "intersection"
    | "tuple"
    | "record"
    | "map"
    | "set"
    | "enum"
    | "file"
    | "transform"
    | "literal"
    | "optional"
    | "nullable"
    | "default"
    | "prefault"
    | "nonoptional"
    | "success"
    | "catch"
    | "nan"
    | "pipe"
    | "readonly"
    | "template_literal"
    | "lazy"
    | "promise"
    | "function"
    | "custom"
    | "record_id"
    // DB specific (We want a different one for each schema type, this helps on
    // inferring final data type to use on the database queries and DDLs)
    | "table"
    | "field"
    | "duration";
  error?: core.$ZodErrorMap<never> | undefined;
  checks?: core.$ZodCheck<never>[];
  surreal?: $ZodSurrealTypeDefInternals;
}

export interface $ZodSurrealTypeDefInternals {
  type?:
    | "string"
    | "number"
    | "int"
    | "float"
    | "bool"
    | "int"
    | "none"
    | "null"
    | "any"
    | "datetime"
    | "uuid"
    | "duration";
}

export interface _$ZodSurrealTypeInternals {
  /** The `@zod/core` version of this schema */
  version: typeof core.version;
  /** Schema definition. */
  def: $ZodSurrealTypeDef;
  /** @internal Randomly generated ID for this schema. */
  /** @internal List of deferred initializers. */
  deferred: core.util.AnyFunc[] | undefined;
  /** @internal Parses input and runs all checks (refinements). */
  run(
    payload: core.ParsePayload<any>,
    ctx: core.ParseContextInternal,
  ): core.util.MaybeAsync<core.ParsePayload>;
  /** @internal Parses input, doesn't run checks. */
  parse(
    payload: core.ParsePayload<any>,
    ctx: core.ParseContextInternal,
  ): core.util.MaybeAsync<core.ParsePayload>;
  /** @internal  Stores identifiers for the set of traits implemented by this schema. */
  traits: Set<string>;
  /** @internal Indicates that a schema output type should be considered optional inside objects.
   * @default Required
   */
  /** @internal */
  optin?: "optional" | undefined;
  /** @internal */
  optout?: "optional" | undefined;
  /** @internal */
  dboptin?: "optional" | undefined;
  /** @internal */
  dboptout?: "optional" | undefined;
  /** @internal The set of literal values that will pass validation. Must be an exhaustive set. Used to determine optionality in z.record().
   *
   * Defined on: enum, const, literal, null, undefined
   * Passthrough: optional, nullable, branded, default, catch, pipe
   * Todo: unions?
   */
  values?: core.util.PrimitiveSet | undefined;
  /** Default value bubbled up from  */
  /** @internal A set of literal discriminators used for the fast path in discriminated unions. */
  propValues?: core.util.PropValues | undefined;
  /** @internal This flag indicates that a schema validation can be represented with a regular expression. Used to determine allowable schemas in z.templateLiteral(). */
  pattern: RegExp | undefined;
  /** @internal The constructor function of this schema. */
  constr: new (
    def: any,
  ) => $ZodSurrealType;
  /** @internal A catchall object for bag metadata related to this schema. Commonly modified by checks using `onattach`. */
  bag: Record<string, unknown>;
  /** @internal The set of issues this schema might throw during type checking. */
  isst: core.$ZodIssueBase;
  /** @internal Subject to change, not a public API. */
  processJSONSchema?:
    | ((
        ctx: core.ToJSONSchemaContext,
        json: core.JSONSchema.BaseSchema,
        params: core.ProcessParams,
      ) => void)
    | undefined;
  /** An optional method used to override `toJSONSchema` logic. */
  toJSONSchema?: () => unknown;
  /** @internal The parent of this schema. Only set during certain clone operations. */
  parent?: $ZodSurrealType | undefined;
}

export interface $ZodSurrealTypeInternals<
  out O = unknown,
  out I = unknown,
  out DBO = O,
  out DBI = I,
> extends _$ZodSurrealTypeInternals {
  /** @internal The inferred output type */
  output: O;
  /** @internal The inferred input type */
  input: I;

  /** @internal The inferred output type when using database context */
  dboutput: DBO;
  /** @internal The inferred input type when using database context */
  dbinput: DBI;
}

export type $SomeSurrealType = { _zod: _$ZodSurrealTypeInternals };

export type $ZodBranded<
  T extends $SomeSurrealType,
  Brand extends string | number | symbol,
  Dir extends "in" | "out" | "inout" = "out",
> = T &
  (Dir extends "inout"
    ? {
        _zod: {
          input: core.input<T> & core.$brand<Brand>;
          output: core.output<T> & core.$brand<Brand>;
        };
      }
    : Dir extends "in"
      ? {
          _zod: {
            input: core.input<T> & core.$brand<Brand>;
          };
        }
      : {
          _zod: {
            output: core.output<T> & core.$brand<Brand>;
          };
        });

export interface $ZodSurrealType<
  out O = unknown,
  out I = unknown,
  out DBO = O,
  out DBI = I,
  out Internals extends $ZodSurrealTypeInternals<
    O,
    I,
    DBO,
    DBI
  > = $ZodSurrealTypeInternals<O, I, DBO, DBI>,
> {
  _zod: Internals;
  "~standard": core.$ZodStandardSchema<this>;
}

////////////////////////////  TYPE HELPERS  ///////////////////////////////////

export type $catchall<T extends $SomeSurrealType> = {
  out: {
    [k: string]: core.output<T>;
  };
  in: {
    [k: string]: core.input<T>;
  };
};
export type $ZodSurrealShape = Readonly<{
  [k: string]: $ZodSurrealType;
}>;

export type OptionalOutSchema = { _zod: { optout: "optional" } };
export type OptionalDbOutSchema = { _zod: { dboptout: "optional" } };
export type OptionalInSchema = { _zod: { optin: "optional" } };
export type OptionalDbInSchema = { _zod: { dboptin: "optional" } };

export type IsOptionalIn<T extends $SomeSurrealType> =
  T extends OptionalInSchema ? true : false;
export type IsOptionalOut<T extends $SomeSurrealType> =
  T extends OptionalOutSchema ? true : false;
export type IsOptionalDbIn<T extends $SomeSurrealType> =
  T extends OptionalDbInSchema ? true : false;
export type IsOptionalDbOut<T extends $SomeSurrealType> =
  T extends OptionalDbOutSchema ? true : false;

export type $InferObjectDbOutput<
  T extends core.$ZodLooseShape,
  Extra extends Record<string, unknown>,
> = string extends keyof T
  ? core.util.IsAny<T[keyof T]> extends true
    ? Record<string, unknown>
    : Record<string, dboutput<T[keyof T]>>
  : keyof (T & Extra) extends never
    ? Record<string, never>
    : core.util.Prettify<
        {
          -readonly [k in keyof T as T[k] extends OptionalDbOutSchema
            ? never
            : k]: T[k]["_zod"]["dboutput"];
        } & {
          -readonly [k in keyof T as T[k] extends OptionalDbOutSchema
            ? k
            : never]?: T[k]["_zod"]["dboutput"];
        } & Extra
      >;

export type $InferObjectDbInput<
  T extends core.$ZodLooseShape,
  Extra extends Record<string, unknown>,
> = string extends keyof T
  ? core.util.IsAny<T[keyof T]> extends true
    ? Record<string, unknown>
    : Record<string, dbinput<T[keyof T]>>
  : keyof (T & Extra) extends never
    ? Record<string, never>
    : core.util.Prettify<
        {
          -readonly [k in keyof T as T[k] extends OptionalDbInSchema
            ? never
            : k]: T[k]["_zod"]["dbinput"];
        } & {
          -readonly [k in keyof T as T[k] extends OptionalDbInSchema
            ? k
            : never]?: T[k]["_zod"]["dbinput"];
        } & Extra
      >;

export type dbinput<T> = T extends { _zod: { dbinput: any } }
  ? T["_zod"]["dbinput"]
  : T extends { _zod: { input: any } }
    ? T["_zod"]["input"]
    : unknown;

export type dboutput<T> = T extends { _zod: { dboutput: any } }
  ? T["_zod"]["dboutput"]
  : T extends { _zod: { output: any } }
    ? T["_zod"]["output"]
    : unknown;

// Unions

export type $InferUnionOutput<T extends $SomeSurrealType> = T extends any
  ? core.output<T>
  : never;
export type $InferUnionInput<T extends $SomeSurrealType> = T extends any
  ? core.input<T>
  : never;
export type $InferUnionDbOutput<T extends $SomeSurrealType> = T extends any
  ? dboutput<T>
  : never;
export type $InferUnionDbInput<T extends $SomeSurrealType> = T extends any
  ? dbinput<T>
  : never;

export interface $ZodSurrealTypeDiscriminableInternals
  extends $ZodSurrealTypeInternals {
  propValues: core.util.PropValues;
}
export interface $ZodSurrealTypeDiscriminable extends $ZodSurrealType {
  _zod: $ZodSurrealTypeDiscriminableInternals;
}

// Tuples

export type TupleItems = ReadonlyArray<$SomeSurrealType>;

export type $InferTupleInputType<
  T extends TupleItems,
  Rest extends $SomeSurrealType | null,
> = [
  ...TupleInputTypeWithOptionals<T>,
  ...(Rest extends $SomeSurrealType ? core.input<Rest>[] : []),
];
type TupleInputTypeNoOptionals<T extends TupleItems> = {
  [k in keyof T]: core.input<T[k]>;
};
type TupleInputTypeWithOptionals<T extends TupleItems> = T extends readonly [
  ...infer Prefix extends $SomeSurrealType[],
  infer Tail extends $SomeSurrealType,
]
  ? Tail["_zod"]["optin"] extends "optional"
    ? [...TupleInputTypeWithOptionals<Prefix>, core.input<Tail>?]
    : TupleInputTypeNoOptionals<T>
  : [];

export type $InferTupleDbInputType<
  T extends TupleItems,
  Rest extends $SomeSurrealType | null,
> = [
  ...TupleDbInputTypeWithOptionals<T>,
  ...(Rest extends $SomeSurrealType ? dbinput<Rest>[] : []),
];
type TupleDbInputTypeNoOptionals<T extends TupleItems> = {
  [k in keyof T]: dbinput<T[k]>;
};
type TupleDbInputTypeWithOptionals<T extends TupleItems> = T extends readonly [
  ...infer Prefix extends $SomeSurrealType[],
  infer Tail extends $SomeSurrealType,
]
  ? Tail["_zod"]["dboptin"] extends "optional"
    ? [...TupleDbInputTypeWithOptionals<Prefix>, dbinput<Tail>?]
    : TupleDbInputTypeNoOptionals<T>
  : [];

export type $InferTupleOutputType<
  T extends TupleItems,
  Rest extends $SomeSurrealType | null,
> = [
  ...TupleOutputTypeWithOptionals<T>,
  ...(Rest extends $SomeSurrealType ? core.output<Rest>[] : []),
];
type TupleOutputTypeNoOptionals<T extends TupleItems> = {
  [k in keyof T]: core.output<T[k]>;
};
type TupleOutputTypeWithOptionals<T extends TupleItems> = T extends readonly [
  ...infer Prefix extends $SomeSurrealType[],
  infer Tail extends $SomeSurrealType,
]
  ? Tail["_zod"]["optout"] extends "optional"
    ? [...TupleOutputTypeWithOptionals<Prefix>, core.output<Tail>?]
    : TupleOutputTypeNoOptionals<T>
  : [];

export type $InferTupleDbOutputType<
  T extends TupleItems,
  Rest extends $SomeSurrealType | null,
> = [
  ...TupleDbOutputTypeWithOptionals<T>,
  ...(Rest extends $SomeSurrealType ? dboutput<Rest>[] : []),
];
type TupleDbOutputTypeNoOptionals<T extends TupleItems> = {
  [k in keyof T]: dboutput<T[k]>;
};
type TupleDbOutputTypeWithOptionals<T extends TupleItems> = T extends readonly [
  ...infer Prefix extends $SomeSurrealType[],
  infer Tail extends $SomeSurrealType,
]
  ? Tail["_zod"]["dboptout"] extends "optional"
    ? [...TupleDbOutputTypeWithOptionals<Prefix>, dboutput<Tail>?]
    : TupleDbOutputTypeNoOptionals<T>
  : [];

// Record

export type $ZodRecordKey = $ZodSurrealType<string | number | symbol, unknown>;

export type $InferZodRecordOutput<
  Key extends $ZodRecordKey = $ZodRecordKey,
  Value extends $SomeSurrealType = $ZodSurrealType,
> = Key extends core.$partial
  ? Partial<Record<core.output<Key>, core.output<Value>>>
  : Record<core.output<Key>, core.output<Value>>;

export type $InferZodRecordInput<
  Key extends $ZodRecordKey = $ZodRecordKey,
  Value extends $SomeSurrealType = $ZodSurrealType,
> = Key extends core.$partial
  ? Partial<Record<core.input<Key> & PropertyKey, core.input<Value>>>
  : Record<core.input<Key> & PropertyKey, core.input<Value>>;

// export type $InferZodRecordOutput<
//   Key extends $ZodRecordKey = $ZodRecordKey,
//   Value extends SomeType = $ZodType,
// > = undefined extends Key["_zod"]["values"]
//   ? string extends core.output<Key>
//     ? Record<core.output<Key>, core.output<Value>>
//     : number extends core.output<Key>
//       ? Record<core.output<Key>, core.output<Value>>
//       : symbol extends core.output<Key>
//         ? Record<core.output<Key>, core.output<Value>>
//         : Record<core.output<Key>, core.output<Value>>
//   : Record<core.output<Key>, core.output<Value>>;
export type $InferZodRecordDbOutput<
  Key extends $ZodRecordKey = $ZodRecordKey,
  Value extends $SomeSurrealType = ZodSurrealType,
> = Key extends core.$partial
  ? Partial<Record<dboutput<Key>, dboutput<Value>>>
  : Record<dboutput<Key>, dboutput<Value>>;

// export type $InferZodRecordInput<
//   Key extends $ZodRecordKey = $ZodRecordKey,
//   Value extends SomeType = $ZodType,
// > = undefined extends Key["_zod"]["values"]
//   ? string extends core.input<Key>
//     ? Record<core.input<Key>, core.input<Value>>
//     : number extends core.input<Key>
//       ? Record<core.input<Key>, core.input<Value>>
//       : symbol extends core.input<Key>
//         ? Record<core.input<Key>, core.input<Value>>
//         : Record<core.input<Key>, core.input<Value>>
//   : Record<core.input<Key>, core.input<Value>>;

export type $InferZodRecordDbInput<
  Key extends $ZodRecordKey = $ZodRecordKey,
  Value extends $SomeSurrealType = ZodSurrealType,
> = Key extends core.$partial
  ? Partial<Record<dbinput<Key> & PropertyKey, dbinput<Value>>>
  : Record<dbinput<Key> & PropertyKey, dbinput<Value>>;

// Enum

export type $InferEnumDbOutput<T extends core.util.EnumLike> = T[keyof T] & {};
export type $InferEnumDbInput<T extends core.util.EnumLike> = T[keyof T] & {};

// Function

export type ZodSurrealFunctionArgs = ZodSurrealType<unknown[], unknown[]>;
export type ZodSurrealFunctionIn = ZodSurrealFunctionArgs;
export type ZodSurrealFunctionOut = ZodSurrealType;

export type $InferInnerFunctionType<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : core.output<Args>
) => core.input<Returns>;

export type $InferInnerFunctionDbType<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : dboutput<Args>
) => dbinput<Returns>;

export type $InferInnerFunctionTypeAsync<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : core.output<Args>
) => core.util.MaybeAsync<core.input<Returns>>;

export type $InferInnerFunctionDbTypeAsync<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : dboutput<Args>
) => core.util.MaybeAsync<dbinput<Returns>>;

export type $InferOuterFunctionType<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : core.input<Args>
) => core.output<Returns>;

export type $InferOuterFunctionDbType<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : dbinput<Args>
) => dboutput<Returns>;

export type $InferOuterFunctionTypeAsync<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : core.input<Args>
) => Promise<core.output<Returns>>;

export type $InferOuterFunctionDbTypeAsync<
  Args extends ZodSurrealFunctionIn,
  Returns extends ZodSurrealFunctionOut,
> = (
  ...args: ZodSurrealFunctionIn extends Args ? never[] : dbinput<Args>
) => Promise<dboutput<Returns>>;

// Literal

type LiteralPart = Exclude<core.util.Literal, symbol>;
interface SchemaPartInternals
  extends $ZodSurrealTypeInternals<LiteralPart, LiteralPart> {
  pattern: RegExp;
}
interface SchemaPart extends $ZodSurrealType {
  _zod: SchemaPartInternals;
}
export type $ZodSurrealTemplateLiteralPart = LiteralPart | SchemaPart;
type UndefinedToEmptyString<T> = T extends undefined ? "" : T;
type AppendToTemplateLiteral<
  Template extends string,
  Suffix extends LiteralPart | $ZodSurrealType,
> = Suffix extends LiteralPart
  ? `${Template}${UndefinedToEmptyString<Suffix>}`
  : Suffix extends $ZodSurrealType
    ? `${Template}${core.output<Suffix> extends infer T extends LiteralPart ? UndefinedToEmptyString<T> : never}`
    : never;
export type $PartsToTemplateLiteral<
  Parts extends $ZodSurrealTemplateLiteralPart[],
> = [] extends Parts
  ? ``
  : Parts extends [
        ...infer Rest,
        infer Last extends $ZodSurrealTemplateLiteralPart,
      ]
    ? Rest extends $ZodSurrealTemplateLiteralPart[]
      ? AppendToTemplateLiteral<$PartsToTemplateLiteral<Rest>, Last>
      : never
    : never;

///////////////////////////// Type Overriden Functions /////////////////////////

export function normalizeParams<T, S extends $ZodSurrealTypeDefInternals>(
  _params: T,
  surreal?: S,
): core.util.Normalize<T> & {
  surreal: Exclude<S, undefined>;
} {
  const params = core.util.normalizeParams(_params);
  if (params && typeof params === "object") {
    return { ...params, surreal: surreal ?? {} } as any;
  }
  return params ?? { surreal: surreal ?? {} };
}

export const clone: <T extends $ZodSurrealType>(
  inst: T,
  def?: T["_zod"]["def"],
  params?: {
    parent: boolean;
  },
) => T = core.clone as any;
