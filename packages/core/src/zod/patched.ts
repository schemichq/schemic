import { DateTime, Uuid } from "surrealdb";
import {
  core,
  ZodDate as OriginalZodDate,
  ZodGUID as OriginalZodGUID,
  ZodUUID as OriginalZodUUID,
} from "zod/v4";
import { type OverrideOutputInput, patch } from "./utils";
import { ZodSurrealField, type WithZodSurrealFieldMethods } from "./schema";

// guid
export type ZodGUID = SurrealZodGUID;

export interface SurrealZodGUID
  extends OverrideOutputInput<
    OriginalZodGUID,
    Uuid,
    OriginalZodGUID["_zod"]["input"] | Uuid,
    { type: "uuid" }
  > {}

export const SurrealZodGUID = patch<SurrealZodGUID>({
  original: OriginalZodGUID,
  name: "SurrealZodGUID",
  patchDef(def) {
    def.surreal.type = "uuid";
  },
  beforeParse(payload) {
    if (payload.value instanceof Uuid) {
      return payload;
    }
  },
  onRunSuccess(result) {
    result.value = new Uuid(result.value as string);
  },
});

export function guid(params?: string | core.$ZodGUIDParams) {
  return new SurrealZodGUID({
    type: "string",
    check: "string_format",
    format: "guid",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "uuid",
    },
  });
}

// uuid

export type ZodUUID = SurrealZodUUID;

export interface SurrealZodUUID
  extends OverrideOutputInput<
    OriginalZodUUID,
    Uuid,
    OriginalZodUUID["_zod"]["input"] | Uuid,
    { type: "uuid" }
  > {}

export const SurrealZodUUID = patch<SurrealZodUUID>({
  original: OriginalZodUUID,
  name: "SurrealZodUUID",
  patchDef(def) {
    def.surreal.type = "uuid";
  },
  beforeParse(payload) {
    if (payload.value instanceof Uuid) {
      return payload;
    }
  },
  onRunSuccess(result) {
    if (!(result.value instanceof Uuid)) {
      result.value = new Uuid(result.value as string);
    }
  },
});

export function uuid(params?: string | core.$ZodUUIDParams) {
  return new SurrealZodUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...core.util.normalizeParams(params),
    surreal: {
      type: "uuid",
    },
  });
}

// uuidv4
export function uuidv4(params?: string | core.$ZodUUIDv4Params) {
  return new SurrealZodUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "uuid",
    },
  });
}

// uuidv6
export function uuidv6(params?: string | core.$ZodUUIDv6Params) {
  return new SurrealZodUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "uuid",
    },
  });
}

// uuidv7
export function uuidv7(params?: string | core.$ZodUUIDv7Params) {
  return new SurrealZodUUID({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "uuid",
    },
  });
}

// date

export type ZodDate = SurrealZodDate;

export interface SurrealZodDate
  extends OverrideOutputInput<
    OriginalZodDate,
    Date,
    OriginalZodDate["_zod"]["input"] | DateTime,
    { type: "datetime" }
  > {}

export const SurrealZodDate = patch<WithZodSurrealFieldMethods<SurrealZodDate>>(
  {
    original: OriginalZodDate,
    name: "SurrealZodDate",
    extend: [ZodSurrealField],
    patchDef(def) {
      def.surreal.type = "datetime";
    },
    beforeParse(payload) {
      if (payload.value instanceof DateTime) {
        payload.value = payload.value.toDate();
        return payload;
      }
    },
  },
);

export function date(params?: string | core.$ZodDateParams) {
  return new SurrealZodDate({
    type: "date",
    ...core.util.normalizeParams(params),
    surreal: {
      type: "datetime",
    },
  });
}
