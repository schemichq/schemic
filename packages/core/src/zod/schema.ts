import {
  BoundQuery,
  Decimal,
  Duration,
  escapeIdent,
  RecordId,
  StringRecordId,
  Table,
  type RecordIdValue,
} from "surrealdb";
import * as core from "zod/v4/core";
import * as classic from "zod/v4";
import {
  inferSurrealType,
  tableToSurql,
  type DefineTableOptions,
  type RemoveTableOptions,
  type TableInfo,
  type TableStructure,
} from "../surql";
import type { UnionToTuple } from "./utils";

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////                          //////////
//////////      SurrealZodType      //////////
//////////                          //////////
//////////////////////////////////////////////
//////////////////////////////////////////////

export interface SurrealZodInternals {
  type:
    | "any"
    | "record_id"
    | "table"
    | "uuid"
    | "string"
    | "datetime"
    | "duration";
}

export interface SurrealZodTypeDef<
  out Internals extends SurrealZodInternals = SurrealZodInternals,
> extends core.$ZodTypeDef {
  surreal: Internals;
}

export interface SurrealZodTypeInternals<
  out O = unknown,
  out I = unknown,
  out SurrealInternals extends SurrealZodInternals = SurrealZodInternals,
> extends core.$ZodTypeInternals<O, I> {
  def: SurrealZodTypeDef<SurrealInternals>;
}

export interface ZodSurrealType<
  out O = unknown,
  out I = unknown,
  out Internals extends SurrealZodTypeInternals<
    O,
    I,
    SurrealZodInternals
  > = SurrealZodTypeInternals<O, I, SurrealZodInternals>,
> extends Omit<classic.ZodType<O, I, Internals>, "type"> {}

export interface _ZodSurrealType<
  Internals extends SurrealZodTypeInternals = SurrealZodTypeInternals,
> extends ZodSurrealType<any, any, Internals> {}

export const ZodSurrealType: core.$constructor<ZodSurrealType> =
  core.$constructor("ZodSurrealType", (inst, def) => {
    // @ts-expect-error - we will be overriding the type property
    classic.ZodType.init(inst, def);
    // @ts-expect-error - we will be overriding the type property
    delete inst.type;

    inst._zod.def.surreal ??= {
      type: "any",
    };

    return inst;
  });

///////////////////////////////////////////////
///////////////////////////////////////////////
//////////                           //////////
//////////      ZodSurrealField      //////////
//////////                           //////////
///////////////////////////////////////////////
///////////////////////////////////////////////

export interface ZodSurrealFieldInternals<
  out O = unknown,
  out I = unknown,
  out Internals extends SurrealZodTypeInternals<
    O,
    I,
    SurrealZodInternals
  > = SurrealZodTypeInternals<O, I, SurrealZodInternals>,
> extends core.$ZodTypeInternals<O, I> {
  def: SurrealZodTypeDef<
    Internals["def"]["surreal"] & {
      field: {
        default?: BoundQuery;
      };
    }
  > & {
    innerType: core.$ZodType<O, I>;
  };
}

export interface ZodSurrealField<
  T extends core.$ZodType = core.$ZodType,
  O = core.output<T>,
  I = core.input<T>,
> extends core.$ZodType<O, I, ZodSurrealFieldInternals<O, I>> {
  // parsing
  parse(
    data: unknown,
    params?: core.ParseContext<core.$ZodIssue>,
  ): core.output<this>;
  safeParse(
    data: unknown,
    params?: core.ParseContext<core.$ZodIssue>,
  ): classic.ZodSafeParseResult<core.output<this>>;
  parseAsync(
    data: unknown,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<core.output<this>>;
  safeParseAsync(
    data: unknown,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<classic.ZodSafeParseResult<core.output<this>>>;
  spa: (
    data: unknown,
    params?: core.ParseContext<core.$ZodIssue>,
  ) => Promise<classic.ZodSafeParseResult<core.output<this>>>;

  // encoding/decoding
  encode(
    data: core.output<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): core.input<this>;
  decode(
    data: core.input<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): core.output<this>;
  encodeAsync(
    data: core.output<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<core.input<this>>;
  decodeAsync(
    data: core.input<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<core.output<this>>;
  safeEncode(
    data: core.output<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): classic.ZodSafeParseResult<core.input<this>>;
  safeDecode(
    data: core.input<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): classic.ZodSafeParseResult<core.output<this>>;
  safeEncodeAsync(
    data: core.output<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<classic.ZodSafeParseResult<core.input<this>>>;
  safeDecodeAsync(
    data: core.input<this>,
    params?: core.ParseContext<core.$ZodIssue>,
  ): Promise<classic.ZodSafeParseResult<core.output<this>>>;

  $default(
    value: core.util.NoUndefined<core.output<T>> | BoundQuery,
  ): ZodSurrealField<T>;
}

export type WithZodSurrealFieldMethods<
  T extends core.$ZodType = core.$ZodType,
> = T & {
  $default(
    value: core.util.NoUndefined<core.output<T>> | BoundQuery,
  ): ZodSurrealField<T, core.output<T>, core.input<T> | undefined>;
};

export const ZodSurrealField: core.$constructor<ZodSurrealField> =
  core.$constructor("ZodSurrealField", (inst, def) => {
    // @ts-expect-error
    core.$ZodType.init(inst, def);
    def.surreal.field ??= {};

    // parsing
    inst.parse = (data, params) =>
      classic.parse(inst, data, params, { callee: inst.parse });
    inst.safeParse = (data, params) => classic.safeParse(inst, data, params);
    inst.parseAsync = async (data, params) =>
      classic.parseAsync(inst, data, params, { callee: inst.parseAsync });
    inst.safeParseAsync = async (data, params) =>
      classic.safeParseAsync(inst, data, params);
    inst.spa = inst.safeParseAsync;

    // encoding/decoding
    inst.encode = (data, params) => classic.encode(inst, data, params);
    inst.decode = (data, params) => classic.decode(inst, data, params);
    inst.encodeAsync = async (data, params) =>
      classic.encodeAsync(inst, data, params);
    inst.decodeAsync = async (data, params) =>
      classic.decodeAsync(inst, data, params);
    inst.safeEncode = (data, params) => classic.safeEncode(inst, data, params);
    inst.safeDecode = (data, params) => classic.safeDecode(inst, data, params);
    inst.safeEncodeAsync = async (data, params) =>
      classic.safeEncodeAsync(inst, data, params);
    inst.safeDecodeAsync = async (data, params) =>
      classic.safeDecodeAsync(inst, data, params);

    // ----------- Database Only Methods -----------
    inst.$default = (value) => {
      return new ZodSurrealField({
        ...inst._zod.def,
        innerType: classic.optional(inst),
        surreal: {
          ...inst._zod.def.surreal,
          field: {
            ...inst._zod.def.surreal.field,
            default: value instanceof BoundQuery ? value : undefined,
          },
        },
      });
    };

    if (inst._zod.traits.size === 2 && inst._zod.def.innerType) {
      inst._zod.parse = inst._zod.def.innerType._zod.parse;
      // @ts-expect-error
      inst._zod.check = inst._zod.def.innerType._zod.check;
      inst._zod.run = inst._zod.def.innerType._zod.run;
    }

    return inst;
  });

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      SurrealZodRecordId      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export type SurrealZodRecordIdValue = classic.ZodType<RecordIdValue, unknown>;

export type inferRecordIdValue<Id extends SurrealZodRecordIdValue> =
  Id extends {
    _zod: {
      output: any;
    };
  }
    ? Id["_zod"]["output"]
    : RecordIdValue;

export type inferRecordIdTable<T extends SurrealZodRecordId<string, any>> =
  T extends SurrealZodRecordId<infer N> ? N : never;

export interface SurrealZodRecordIdDef<
  Table extends string = string,
  Id extends SurrealZodRecordIdValue = SurrealZodRecordIdValue,
> extends core.$ZodTypeDef {
  innerType: Id;
  table?: Table[];

  surreal: {
    type: "record_id";
  };
}

export interface SurrealZodRecordIdInternals<
  Table extends string = string,
  Id extends SurrealZodRecordIdValue = SurrealZodRecordIdValue,
> extends SurrealZodTypeInternals<
    RecordId<Table, inferRecordIdValue<Id>>,
    RecordId<Table, inferRecordIdValue<Id>> | StringRecordId
  > {
  def: SurrealZodRecordIdDef<Table, Id>;
}

type SurrealZodRecordIdTrait<
  Tb extends string,
  Id extends SurrealZodRecordIdValue,
> = string extends Tb
  ? // Any Table:
    SurrealZodRecordIdValue extends Id
    ? // Any Table + Any Value:
      {
        // Clone - Split Parameters
        parse<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, OverrideId>;
        parseAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, OverrideId>>;
        safeParse<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>;
        safeParseAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>
        >;
        decode<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          id:
            | RecordId<NoInfer<OverrideTb>, NoInfer<OverrideId>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, OverrideId>;
        decodeAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          id:
            | RecordId<NoInfer<OverrideTb>, NoInfer<OverrideId>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, OverrideId>>;
        safeDecode<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          id:
            | RecordId<NoInfer<OverrideTb>, NoInfer<OverrideId>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>;
        safeDecodeAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          id:
            | RecordId<NoInfer<OverrideTb>, NoInfer<OverrideId>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>
        >;

        // From Parts - Split Parameters
        fromParts<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          table: NoInfer<OverrideTb>,
          id: NoInfer<OverrideId>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, OverrideId>;
        fromPartsAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          table: NoInfer<OverrideTb>,
          id: NoInfer<OverrideId>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, OverrideId>>;
        safeFromParts<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          table: NoInfer<OverrideTb>,
          id: NoInfer<OverrideId>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>;
        safeFromPartsAsync<
          OverrideTb extends string = Tb,
          OverrideId extends RecordIdValue = core.output<Id>,
        >(
          table: NoInfer<OverrideTb>,
          id: NoInfer<OverrideId>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, OverrideId>>
        >;

        // Clone - Single Parameter
        parse<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(data: unknown, params?: core.ParseContext<core.$ZodIssue>): Override;
        parseAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<Override>;
        safeParse<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<Override>;
        safeParseAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<classic.ZodSafeParseResult<Override>>;
        decode<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          id: NoInfer<Override> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Override;
        decodeAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          id: NoInfer<Override> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<Override>;
        safeDecode<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          id: NoInfer<Override> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<Override>;
        safeDecodeAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          id: NoInfer<Override> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<classic.ZodSafeParseResult<Override>>;

        // From Parts - Single Parameter
        fromParts<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<Override["id"]>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Override;
        fromPartsAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<Override["id"]>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<Override>;
        safeFromParts<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<Override["id"]>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<Override>;
        safeFromPartsAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<Override["id"]>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<classic.ZodSafeParseResult<Override>>;
      }
    : // Any Table + Typed Value:
      {
        // Clone - Split Parameters
        parse<OverrideTb extends string = Tb>(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, core.output<Id>>;
        parseAsync<OverrideTb extends string = Tb>(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, core.output<Id>>>;
        safeParse<OverrideTb extends string = Tb>(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>;
        safeParseAsync<OverrideTb extends string = Tb>(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>
        >;
        decode<OverrideTb extends string = Tb>(
          data: RecordId<NoInfer<OverrideTb>, core.output<Id>> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, core.output<Id>>;
        decodeAsync<OverrideTb extends string = Tb>(
          data: RecordId<NoInfer<OverrideTb>, core.output<Id>> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, core.output<Id>>>;
        safeDecode<OverrideTb extends string = Tb>(
          data: RecordId<NoInfer<OverrideTb>, core.output<Id>> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>;
        safeDecodeAsync<OverrideTb extends string = Tb>(
          data: RecordId<NoInfer<OverrideTb>, core.output<Id>> | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>
        >;

        // From Parts - Split Parameters
        fromParts<OverrideTb extends string = Tb>(
          table: NoInfer<OverrideTb>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<OverrideTb, core.output<Id>>;
        fromPartsAsync<OverrideTb extends string = Tb>(
          table: NoInfer<OverrideTb>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<OverrideTb, core.output<Id>>>;
        safeFromParts<OverrideTb extends string = Tb>(
          table: NoInfer<OverrideTb>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>;
        safeFromPartsAsync<OverrideTb extends string = Tb>(
          table: NoInfer<OverrideTb>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<RecordId<OverrideTb, core.output<Id>>>
        >;

        // Clone - Single Parameter
        parse<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<Override["table"]["name"], core.output<Id>>;
        parseAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<Override["table"]["name"], core.output<Id>>>;
        safeParse<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<
          RecordId<Override["table"]["name"], core.output<Id>>
        >;
        safeParseAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data: unknown,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<
            RecordId<Override["table"]["name"], core.output<Id>>
          >
        >;
        decode<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data:
            | RecordId<Override["table"]["name"], core.output<Id>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<Override["table"]["name"], core.output<Id>>;
        decodeAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data:
            | RecordId<Override["table"]["name"], core.output<Id>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<Override["table"]["name"], core.output<Id>>>;
        safeDecode<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data:
            | RecordId<Override["table"]["name"], core.output<Id>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<
          RecordId<Override["table"]["name"], core.output<Id>>
        >;
        safeDecodeAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          data:
            | RecordId<Override["table"]["name"], core.output<Id>>
            | StringRecordId,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<
            RecordId<Override["table"]["name"], core.output<Id>>
          >
        >;

        // From Parts - Single Parameter
        fromParts<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): RecordId<Override["table"]["name"], core.output<Id>>;
        fromPartsAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<RecordId<Override["table"]["name"], core.output<Id>>>;
        safeFromParts<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): classic.ZodSafeParseResult<
          RecordId<Override["table"]["name"], core.output<Id>>
        >;
        safeFromPartsAsync<
          Override extends RecordId<string, RecordIdValue> = RecordId<
            Tb,
            core.output<Id>
          >,
        >(
          table: NoInfer<Override["table"]["name"]>,
          id: NoInfer<core.output<Id>>,
          params?: core.ParseContext<core.$ZodIssue>,
        ): Promise<
          classic.ZodSafeParseResult<
            RecordId<Override["table"]["name"], core.output<Id>>
          >
        >;
      }
  : // Specific Table:
    UnionToTuple<Tb> extends { length: 1 }
    ? SurrealZodRecordIdValue extends Id
      ? // Specific Table + Any Value
        {
          // Clone - Split Parameters
          parse<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          parseAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeParse<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeParseAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;
          decode<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          decodeAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeDecode<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeDecodeAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;

          // From Parts - Split Parameters
          fromParts<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          fromPartsAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeFromParts<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeFromPartsAsync<
            OverrideId extends RecordIdValue = core.output<Id>,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;

          // From Id - Split Parameters
          fromId<OverrideId extends RecordIdValue = core.output<Id>>(
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          fromIdAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeFromId<OverrideId extends RecordIdValue = core.output<Id>>(
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeFromIdAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;

          // Clone - Single Parameter
          parse<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          parseAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeParse<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeParseAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;
          decode<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          decodeAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeDecode<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeDecodeAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;

          // From Parts - Single Parameter
          fromParts<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          fromPartsAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeFromParts<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeFromPartsAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;

          // From Id - Single Parameter
          fromId<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          fromIdAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeFromId<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeFromIdAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;
        }
      : // Specific Table + Typed Value
        {
          // Clone - Non Overridable
          parse(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          parseAsync(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeParse(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeParseAsync(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;
          decode(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          decodeAsync(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeDecode(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeDecodeAsync(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;

          // From Parts - Non Overridable
          fromParts(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          fromPartsAsync(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeFromParts(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeFromPartsAsync(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;

          // From Id - Non Overridable
          fromId(
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          fromIdAsync(
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeFromId(
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeFromIdAsync(
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;
        }
    : // Multiple Tables:
      SurrealZodRecordIdValue extends Id
      ? // Multiple Tables + Any Value:
        {
          // Clone - Split Parameters
          parse<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          parseAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeParse<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeParseAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;
          decode<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          decodeAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeDecode<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeDecodeAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            data: RecordId<Tb, NoInfer<OverrideId>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;

          // From Parts - Split Parameters
          fromParts<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, OverrideId>;
          fromPartsAsync<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, OverrideId>>;
          safeFromParts<OverrideId extends RecordIdValue = core.output<Id>>(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>;
          safeFromPartsAsync<
            OverrideId extends RecordIdValue = core.output<Id>,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<OverrideId>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, OverrideId>>>;

          // Clone - Single Parameter
          parse<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          parseAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeParse<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeParseAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;
          decode<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          decodeAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeDecode<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeDecodeAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            data: RecordId<Tb, Override["id"]> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;

          // From Parts - Single Parameter
          fromParts<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, Override["id"]>;
          fromPartsAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, Override["id"]>>;
          safeFromParts<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>;
          safeFromPartsAsync<
            Override extends RecordId<string, RecordIdValue> = RecordId<
              Tb,
              core.output<Id>
            >,
          >(
            table: NoInfer<Tb>,
            id: NoInfer<Override["id"]>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, Override["id"]>>>;
        }
      : // Multiple Tables + Typed Value:
        {
          // Clone
          parse(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          parseAsync(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeParse(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeParseAsync(
            data: unknown,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;
          decode(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          decodeAsync(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeDecode(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeDecodeAsync(
            data: RecordId<Tb, core.output<Id>> | StringRecordId,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;

          // From Parts - Non Overridable
          fromParts(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): RecordId<Tb, core.output<Id>>;
          fromPartsAsync(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<RecordId<Tb, core.output<Id>>>;
          safeFromParts(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>;
          safeFromPartsAsync(
            table: NoInfer<Tb>,
            id: NoInfer<core.output<Id>>,
            params?: core.ParseContext<core.$ZodIssue>,
          ): Promise<classic.ZodSafeParseResult<RecordId<Tb, core.output<Id>>>>;
        };

export type SurrealZodRecordId<
  Table extends string = string,
  Id extends SurrealZodRecordIdValue = SurrealZodRecordIdValue,
> = Omit<
  _ZodSurrealType<SurrealZodRecordIdInternals<Table, Id>>,
  | "parse"
  | "parseAsync"
  | "safeParse"
  | "safeParseAsync"
  | "decode"
  | "decodeAsync"
  | "safeDecode"
  | "safeDecodeAsync"
  | "encode"
  | "encodeAsync"
  | "safeEncode"
  | "safeEncodeAsync"
> &
  SurrealZodRecordIdTrait<Table, Id> & {
    anytable(): SurrealZodRecordId<string, Id>;

    table<const NewTable extends string | string[]>(
      table: NewTable,
    ): SurrealZodRecordId<
      NewTable extends string ? NewTable : NewTable[number],
      Id
    >;

    /** @alias id */
    type<NewType extends SurrealZodRecordIdValue>(
      innerType: NewType,
    ): SurrealZodRecordId<Table, NewType>;
    /** @alias value */
    id<NewType extends SurrealZodRecordIdValue>(
      innerType: NewType,
    ): SurrealZodRecordId<Table, NewType>;
    /** @alias type */
    value<NewType extends SurrealZodRecordIdValue>(
      innerType: NewType,
    ): SurrealZodRecordId<Table, NewType>;
  };

function normalizeRecordIdDef(def: SurrealZodRecordIdDef) {
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
/* instanbul ignore next */
function parseRecordIdString(id: string) {
  let table = "";
  let value: RecordIdValue = "";

  const match = id.match(/^(?:⟨(.*)⟩|`(.*)`|(.*)):(?:⟨(.*)⟩|`(.*)`|(.*))$/);
  if (!match) {
    throw new Error(`Invalid record id string: ${id}`);
  }

  table = (match[1] ?? match[2] ?? match[2] ?? "").replace(/\\⟩/g, "⟩");
  value = match[4] ?? match[5] ?? match[6] ?? "";
  // check if value is a number
  value = parseSurrealValue(value);
  // console.log("result:", value);

  return new RecordId(table, value);
}
/* instanbul ignore stop */

type ParserContext = {
  in: "root" | "array" | "object";
  acc: string;
  path: ("array" | "object")[];
};

function parseSurrealValue(str: string) {
  const stack: {
    in: "root" | "array" | "object";
    value: any;
  }[] = [];
  let ctx: ParserContext = {
    in: "root",
    acc: "",
    path: [],
  };
  let value: any;

  function expr() {
    const parsed = ctx.acc;
    // Decimal with optional exponent
    if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?dec$/i.test(parsed)) {
      return new Decimal(parsed.slice(0, -3));
    }

    // Strict integer → Number | BigInt
    if (/^[-+]?\d+f?$/.test(parsed)) {
      const asBigInt = BigInt(parsed.replace(/f$/i, ""));
      if (
        asBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
        asBigInt < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        return asBigInt;
      }
      return Number(parsed.replace(/f$/i, ""));
    }

    // Float or exponent → Number
    if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?f?$/i.test(parsed)) {
      return Number(parsed.replace(/f$/, ""));
    }

    return parsed;
  }

  function enter(type: "array" | "object") {
    if (ctx.in !== "root") {
      stack.push({ in: ctx.in, value });
    }
    ctx.in = type;
    if (type === "array") {
      value = [];
    } else if (type === "object") {
      value = {};
    }
  }

  function exit() {
    if (ctx.in === "array" && ctx.acc) {
      nextArray();
    }
    const popped = stack.pop();
    if (!popped) {
      return;
    }
    value = popped.value;
    ctx.in = popped.in;
    ctx.acc = "";
  }

  function nextArray() {
    (value as any[]).push(expr());
  }

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "[") {
      enter("array");
    } else if (ch === "{") {
      enter("object");
    } else if (ch === "]") {
      exit();
    } else if (ch === "}") {
      exit();
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      continue;
    } else if (ch === ",") {
      if (ctx.in === "array") nextArray();
      ctx.acc = "";
    } else {
      ctx.acc += ch;
    }
    // console.log(inspect({ ...ctx, stack }, { depth: Infinity, colors: true }));
  }

  return value;
}

export const SurrealZodRecordId: core.$constructor<SurrealZodRecordId> =
  core.$constructor("SurrealZodRecordId", (inst, def) => {
    ZodSurrealType.init(inst as any, def);

    // surreal internals
    inst._zod.def.surreal.type = "record_id";
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
    const _inst = inst as any;
    _inst.fromParts = (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => _inst.decode(new RecordId(table, id), params);

    _inst.fromPartsAsync = (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => _inst.decodeAsync(new RecordId(table, id), params);

    _inst.safeFromParts = (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => _inst.safeDecode(new RecordId(table, id), params);

    _inst.safeFromPartsAsync = (
      table: string,
      id: RecordIdValue,
      params?: core.ParseContext<core.$ZodIssue>,
    ) => _inst.safeDecodeAsync(new RecordId(table, id), params);

    if (normalized.table?.length === 1) {
      _inst.fromId = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) => _inst.decode(new RecordId(normalized.table?.[0] ?? "", id), params);

      _inst.fromIdAsync = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) =>
        _inst.decodeAsync(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );

      _inst.safeFromId = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) =>
        _inst.safeDecode(new RecordId(normalized.table?.[0] ?? "", id), params);

      _inst.safeFromIdAsync = (
        id: RecordIdValue,
        params?: core.ParseContext<core.$ZodIssue>,
      ) =>
        _inst.safeDecodeAsync(
          new RecordId(normalized.table?.[0] ?? "", id),
          params,
        );
    }

    // inst.fromUnsafe = (...args: any[]) => {
    //   if (args.length === 1) {
    //     if (args[0] instanceof RecordId) {
    //       return new RecordId(args[0].table.name, args[0].id);
    //     }

    //     if (inst._zod.def.table?.length !== 1) {
    //       throw new Error(
    //         "Cannot call .fromUnsafe() with a single argument if the schema is not restricted to a single table, please use .fromUnsafe(table, id) instead",
    //       );
    //     }

    //     return new RecordId(inst._zod.def.table?.[0] ?? "", args[0]);
    //   }

    //   return new RecordId(args[0], args[1]);
    // };

    // inst.fromString = (id) => inst.parse(parseRecordIdString(id));
    // inst.fromStringUnsafe = (id) => parseRecordIdString(id);

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
        }
        payload.value = new RecordId(
          payload.value.table.name,
          result.value as any,
        );
      } else {
        // @ts-expect-error - Issues dont know about surreal types
        payload.issues.push({
          code: "invalid_type",
          expected: "record_id",
        });
      }

      return payload;
    };

    return inst;
  });

export function recordId<
  const W extends string | string[],
  I extends SurrealZodRecordIdValue = SurrealZodRecordIdValue,
>(
  what?: W,
  innerType?: I,
): SurrealZodRecordId<W extends string ? W : W[number], I> {
  return new SurrealZodRecordId({
    // Zod would not be happy if we have a custom type here, so we use any
    type: "any",
    table: what ? (Array.isArray(what) ? what : [what]) : undefined,
    innerType: innerType ?? classic.any(),

    surreal: {
      type: "record_id",
    },
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
  [key: string]: core.$ZodType;
};

export type SurrealZodTableRelationFields = {
  [K in "in" | "out"]?: SurrealZodRecordId<string, SurrealZodRecordIdValue>;
} & {
  [key: string]: core.$ZodType;
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
      ? F extends SurrealZodRecordId<any, infer T>
        ? SurrealZodRecordId<TableName, T>
        : F extends SurrealZodRecordIdValue
          ? SurrealZodRecordId<TableName, F>
          : SurrealZodRecordId<TableName>
      : SurrealZodRecordId<TableName>
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
  dto: boolean;
};

/**
 * Helper type that makes the id field optional for DTO mode.
 * Uses [IsDto] extends [true] to avoid distributive conditionals.
 */
type ApplyDtoToFields<
  NormFields extends SurrealZodTableFields,
  IsDto extends boolean,
> = [IsDto] extends [true]
  ? Omit<NormFields, "id"> & { id: classic.ZodOptional<NormFields["id"]> }
  : NormFields;

/**
 * Precomputed fields type that combines normalization and DTO transformation.
 * Uses a single NormalizedFields computation to avoid redundant type expansion.
 */
type TableDefFields<
  Name extends string,
  Fields extends SurrealZodTableFields,
  Config extends SurrealZodTableConfig,
> = ApplyDtoToFields<NormalizedFields<Name, Fields>, Config["dto"]> &
  Config["catchall"];

export interface SurrealZodTableDef<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = SurrealZodTableConfig,
> extends core.$ZodTypeDef {
  name: Name;
  fields: TableDefFields<Name, Fields, Config>;
  catchall?: core.$ZodType;
  dto: Config["dto"];

  surreal: {
    type: "table";
    tableType: "any" | "normal" | "relation";
    schemafull: boolean;
    drop: boolean;
    comment?: string;
  };
}

export interface SurrealZodTableInternals<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = MergeConfig<
    SurrealZodTableConfig,
    SurrealZodTableConfigSchemaless
  >,
> extends SurrealZodTypeInternals<
    core.$InferObjectOutput<Fields, Config["catchall"]>,
    core.$InferObjectInput<Fields, Config["catchall"]>
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
      | SurrealZodRecordId<string, SurrealZodRecordIdValue>,
  >(
    from: NewFrom,
  ): SurrealZodTable<
    Name,
    Omit<Fields, "in"> & { in: toRecordId<NewFrom> },
    Config,
    "relation"
  >;

  to<
    NewTo extends
      | string
      | string[]
      | SurrealZodRecordId<string, SurrealZodRecordIdValue>,
  >(
    to: NewTo,
  ): SurrealZodTable<
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

export type SurrealZodTable<
  Name extends string = string,
  Fields extends SurrealZodTableFields = {},
  Config extends SurrealZodTableConfig = MergeConfig<
    SurrealZodTableConfig,
    SurrealZodTableConfigSchemaless
  >,
  Kind extends TableKind = "any",
> = _ZodSurrealType<
  SurrealZodTableInternals<
    Name,
    ApplyDtoToFields<NormalizedFields<Name, Fields>, Config["dto"]>,
    Config
  >
> &
  MaybeRelationMethods<Kind, Name, Fields, Config> & {
    name<NewName extends string>(
      name: NewName,
    ): SurrealZodTable<NewName, Fields, Config, Kind>;
    fields<
      NewFields extends Kind extends "relation"
        ? SurrealZodTableRelationFields
        : SurrealZodTableFields,
    >(
      fields: NewFields,
    ): SurrealZodTable<
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
    schemafull(): SurrealZodTable<
      Name,
      Fields,
      MergeConfig<Config, SurrealZodTableConfigSchemafull>,
      Kind
    >;
    schemaless(): SurrealZodTable<
      Name,
      Fields,
      MergeConfig<Config, SurrealZodTableConfigSchemaless>,
      Kind
    >;

    any(): SurrealZodTable<Name, Fields, Config, "any">;
    normal(): SurrealZodTable<Name, Fields, Config, "normal">;
    relation(): SurrealZodTable<
      Name,
      {
        [K in "in" | "out"]: Fields[K] extends SurrealZodRecordId
          ? Fields[K]
          : SurrealZodRecordId<string, SurrealZodRecordIdValue>;
      } & Omit<Fields, "in" | "out">,
      Config,
      "relation"
    >;

    drop(): SurrealZodTable<Name, Fields, Config, Kind>;
    nodrop(): SurrealZodTable<Name, Fields, Config, Kind>;
    comment(comment: string): SurrealZodTable<Name, Fields, Config, Kind>;

    record(): SurrealZodTable<
      Name,
      Fields,
      Config,
      Kind
    >["_zod"]["def"]["fields"]["id"];
    dto(): classic.ZodObject<
      Omit<Fields, "id"> & { id: classic.ZodOptional<Fields["id"]> },
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

    // object methods

    extend<
      ExtraFields extends Kind extends "relation"
        ? SurrealZodTableRelationFields
        : SurrealZodTableFields,
    >(
      extraFields: ExtraFields,
    ): SurrealZodTable<
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
      shape: classic.SafeExtendShape<Fields, ExtraFields> &
        Partial<Record<keyof Fields, core.SomeType>>,
    ): SurrealZodTable<
      Name,
      core.util.Extend<Fields, ExtraFields>,
      Config,
      Kind
    >;

    pick<M extends TableMask<keyof Fields, Kind>>(
      mask: M,
    ): M extends { id: false }
      ? classic.ZodObject<
          core.util.Flatten<
            Pick<Fields, Extract<Exclude<keyof Fields, "id">, keyof M>>
          >,
          {
            out: Config["catchall"];
            in: Config["catchall"];
          }
        >
      : SurrealZodTable<
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
      ? classic.ZodObject<
          core.util.Flatten<Omit<Fields, Extract<keyof Fields, keyof M>>>,
          {
            in: Config["catchall"];
            out: Config["catchall"];
          }
        >
      : SurrealZodTable<
          Name,
          core.util.Flatten<Omit<Fields, Extract<keyof Fields, keyof M>>>,
          Config,
          Kind
        >;

    /**
     * @returns a table schema that is partial for all fields, except for `id`
     */
    partial(): SurrealZodTable<
      Name,
      {
        [k in keyof Fields]: classic.ZodOptional<Fields[k]>;
      },
      Config,
      Kind
    >;

    /**
     * @returns an object schema that is partial for all fields, including `id`.
     * This is equivalent to calling `.dto().partial()`
     */
    partial(mask: true): classic.ZodObject<
      core.util.Flatten<{
        [k in keyof Fields | "id"]: k extends "id"
          ? Fields["id"] extends SurrealZodRecordId<infer N, infer I>
            ? classic.ZodOptional<SurrealZodRecordId<N, I>>
            : classic.ZodOptional<
                SurrealZodRecordId<Name, SurrealZodRecordIdValue>
              >
          : classic.ZodOptional<Fields[k]>;
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
      ? classic.ZodObject<
          core.util.Flatten<{
            [k in keyof Fields | "id"]: k extends keyof M
              ? k extends "id"
                ? Fields["id"] extends SurrealZodRecordId<infer N, infer I>
                  ? classic.ZodOptional<SurrealZodRecordId<N, I>>
                  : classic.ZodOptional<
                      SurrealZodRecordId<Name, SurrealZodRecordIdValue>
                    >
                : classic.ZodOptional<Fields[k]>
              : Fields[k];
          }>,
          {
            out: Config["catchall"];
            in: Config["catchall"];
          }
        >
      : SurrealZodTable<
          Name,
          {
            [k in keyof Fields]: k extends keyof M
              ? classic.ZodOptional<Fields[k]>
              : Fields[k];
          },
          Config,
          Kind
        >;

    required(): SurrealZodTable<
      Name,
      {
        [k in keyof Fields]: classic.ZodNonOptional<Fields[k]>;
      },
      Config,
      Kind
    >;
    required<M extends core.util.Mask<keyof Fields>>(
      mask: M,
    ): SurrealZodTable<
      Name,
      {
        [k in keyof Fields]: k extends keyof M
          ? classic.ZodNonOptional<Fields[k]>
          : Fields[k];
      },
      Config,
      Kind
    >;

    parseStrict(
      value: core.input<SurrealZodTable<Name, Fields, Config, Kind>>,
    ): core.output<SurrealZodTable<Name, Fields, Config, Kind>>;
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
  inst: SurrealZodTable,
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
      inst,
    });
  }

  if (!promises.length) return payload;
  return Promise.all(promises).then(() => payload);
}

function normalizeTableDef(def: SurrealZodTableDef) {
  const fields: Record<string, core.$ZodType> = {};
  const fieldNames = Object.keys(def.fields);
  if (!def.fields.id) {
    fields.id = recordId(def.name).type(classic.any());
    fieldNames.push("id");
  } else if (def.fields.id._zod.traits.has("$ZodOptional")) {
    if (
      !def.dto ||
      !(def.fields.id._zod.def.innerType instanceof SurrealZodRecordId)
    ) {
      throw new Error(
        "Invalid table definition: When using .dto() we try to make the id field optional, " +
          "the inner type must be a SurrealZodRecordId but it is not. This is supposed to " +
          "be impossible, likely an internal library error. Please open an issue at " +
          "https://github.com/msanchezdev/surreal-zod/issues with a minimal reproduction.",
      );
    }
    fields.id = def.fields.id;
  } else if (def.fields.id instanceof SurrealZodRecordId) {
    const base = def.fields.id.table(def.name);
    fields.id = def.dto ? classic.optional(base) : base;
  } else {
    const base = recordId(def.name).type(def.fields.id);
    fields.id = def.dto ? classic.optional(base) : base;
  }

  for (const field of fieldNames) {
    if (field === "id") continue;
    // if (!def.fields[field]?._zod.traits.has("SurrealZodType")) {
    //   throw new Error(
    //     `Invalid field definition for "${field}": expected a Surreal Zod schema`,
    //   );
    // }
    fields[field] = def.fields[field];
  }

  return {
    ...def,
    fields,
    fieldNames,
    fieldNamesSet: new Set(fieldNames),
  };
}

export const SurrealZodTable: core.$constructor<SurrealZodTable> =
  core.$constructor("SurrealZodTable", (inst, def) => {
    ZodSurrealType.init(inst, def);

    const normalized = normalizeTableDef(def);
    // @ts-expect-error - through normalization id is always present
    inst._zod.def.fields = normalized.fields;
    const catchall = normalized.catchall;
    const table = new Table(def.name);

    inst.name = (name) => {
      return inst.clone({
        ...inst._zod.def,
        name,
      }) as any;
    };
    inst.fields = (fields) => {
      if (inst._zod.def.surreal.tableType === "relation") {
        fields = {
          in: inst._zod.def.fields.in ?? recordId().type(classic.any()),
          out: inst._zod.def.fields.out ?? recordId().type(classic.any()),
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
          in: from instanceof SurrealZodRecordId ? from : recordId(from),
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
          out: to instanceof SurrealZodRecordId ? to : recordId(to),
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
          in: recordId().type(classic.any()),
          out: recordId().type(classic.any()),
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
        catchall: classic.never(),
        surreal: {
          ...inst._zod.def.surreal,
          schemafull: true,
        },
      }) as any;
    };
    inst.schemaless = () => {
      return inst.clone({
        ...inst._zod.def,
        catchall: classic.unknown(),
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
      return new classic.ZodObject({
        type: "object",
        shape: {
          ...inst._zod.def.fields,
          id: classic.optional(inst._zod.def.fields.id),
        },
        catchall: inst._zod.def.catchall,
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

      return core.clone(inst, mergedDef);
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
      return core.clone(inst, def);
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

      return core.clone(inst, def) as any;
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

      return core.clone(inst, def) as any;
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

      return core.clone(inst, def) as any;
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

      return core.clone(inst, def) as any;
    };

    inst._zod.parse = (payload, ctx) => {
      const input = payload.value;

      if (!core.util.isObject(input)) {
        payload.issues.push({
          expected: "object",
          code: "invalid_type",
          input,
          inst,
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
  return new SurrealZodTable({
    type: "any",
    name,
    // @ts-expect-error - id set in constructor
    fields: {},
    catchall: classic.unknown(),
    dto: false,

    surreal: {
      type: "table",
      tableType: "any",
      schemafull: false,
      drop: false,
      comment: undefined,
    },
  }) as unknown as SurrealZodTable<Name>;
}

export function normalTable<Name extends string = string>(name: Name) {
  return table(name).normal();
}

type toRecordId<
  T extends
    | string
    | string[]
    | SurrealZodRecordId<string, SurrealZodRecordIdValue>,
> = T extends string
  ? T extends SurrealZodRecordId<infer N, infer I>
    ? SurrealZodRecordId<N, I>
    : SurrealZodRecordId<T>
  : T extends string[]
    ? SurrealZodRecordId<T[number]>
    : T extends SurrealZodRecordId<string, SurrealZodRecordIdValue>
      ? T
      : never;

//////////////////////////////////////////////////
//////////////////////////////////////////////////
//////////                              //////////
//////////      SurrealZodDuration      //////////
//////////                              //////////
//////////////////////////////////////////////////
//////////////////////////////////////////////////

export interface SurrealZodDurationDef extends core.$ZodTypeDef {
  surreal: {
    type: "duration";
  };
}

export interface SurrealZodDurationInternals
  extends SurrealZodTypeInternals<Duration, unknown> {
  def: SurrealZodDurationDef;
}

export interface SurrealZodDuration
  extends _ZodSurrealType<SurrealZodDurationInternals> {}

export const SurrealZodDuration: core.$constructor<SurrealZodDuration> =
  core.$constructor("SurrealZodDuration", (inst, def) => {
    ZodSurrealType.init(inst, def);

    // surreal internals
    inst._zod.def.surreal.type = "duration";

    inst._zod.parse = (payload, ctx) => {
      if (payload.value instanceof Duration) {
        return payload;
      }

      payload.issues.push({
        code: "invalid_type",
        expected: "duration",
        input: payload.value,
        inst,
      } as any);

      return payload;
    };

    return inst;
  });

export function duration() {
  return new SurrealZodDuration({
    type: "any",
    surreal: {
      type: "duration",
    },
  });
}

export type SurrealZodTypes =
  | SurrealZodRecordId
  | SurrealZodTable
  | SurrealZodDuration;
