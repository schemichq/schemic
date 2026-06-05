import type { Surreal, SurrealTransaction } from "surrealdb";
import * as classic from "zod/v4";
import * as core from "zod/v4/core";
import type * as _core_ from "./core.js";
import type { ZodSurrealType } from "./schema.js";

export interface ParseDbContext<T extends core.$ZodIssueBase = core.$ZodIssue>
  extends core.ParseContext<T> {
  db?: Surreal | SurrealTransaction;
}

export interface ParseDbContextInternal<
  T extends core.$ZodIssueBase = core.$ZodIssue,
> extends core.ParseContextInternal<T> {
  db?: Surreal | SurrealTransaction;
}

export type ZodSafeParseResult<T> =
  | classic.ZodSafeParseSuccess<T>
  | classic.ZodSafeParseError<T>;

export type ParsingEncodingDecodingMethodNames =
  | "parse"
  | "encode"
  | "decode"
  | "parseAsync"
  | "encodeAsync"
  | "decodeAsync"
  | "safeParse"
  | "safeEncode"
  | "safeDecode"
  | "safeParseAsync"
  | "safeEncodeAsync"
  | "safeDecodeAsync";

export interface ParsingEncodingDecodingMethods<
  T extends _core_.$SomeSurrealType,
> {
  parse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>;
  encode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>;
  decode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>,
    params?: Ctx,
  ): Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>;
  parseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>>;
  encodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>,
    params?: Ctx,
  ): Promise<Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>>;
  decodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>,
    params?: Ctx,
  ): Promise<Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>>;
  safeParse<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>
  >;
  safeEncode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>
  >;
  safeDecode<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>,
    params?: Ctx,
  ): classic.ZodSafeParseResult<
    Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>
  >;
  safeParseAsync<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>
    >
  >;
  spa<Ctx extends ParseDbContext>(
    data: unknown,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>
    >
  >;
  safeEncodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>
    >
  >;
  safeDecodeAsync<Ctx extends ParseDbContext>(
    data: Ctx extends { db: any } ? _core_.dbinput<T> : core.input<T>,
    params?: Ctx,
  ): Promise<
    classic.ZodSafeParseResult<
      Ctx extends { db: any } ? _core_.dboutput<T> : core.output<T>
    >
  >;
}

export function assignParsingMethods(inst: ZodSurrealType) {
  inst.parse = (data, params) => classic.parse(inst as any, data, params);
  inst.decode = (data, params) => classic.decode(inst as any, data, params);
  inst.encode = (data, params) => classic.encode(inst as any, data, params);
  inst.parseAsync = (data, params) =>
    classic.parseAsync(inst as any, data, params);
  inst.decodeAsync = (data, params) =>
    classic.decodeAsync(inst as any, data, params);
  inst.encodeAsync = (data, params) =>
    classic.encodeAsync(inst as any, data, params);
  inst.safeParse = (data, params) =>
    classic.safeParse(inst as any, data, params);
  inst.safeDecode = (data, params) =>
    classic.safeDecode(inst as any, data, params);
  inst.safeEncode = (data, params) =>
    classic.safeEncode(inst as any, data, params);
  inst.safeParseAsync = (data, params) =>
    classic.safeParseAsync(inst as any, data, params);
  inst.spa = inst.safeParseAsync;
  inst.safeDecodeAsync = (data, params) =>
    classic.safeDecodeAsync(inst as any, data, params);
  inst.safeEncodeAsync = (data, params) =>
    classic.safeEncodeAsync(inst as any, data, params);
}
