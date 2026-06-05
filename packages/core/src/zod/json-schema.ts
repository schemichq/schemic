import * as core from "zod/v4/core";

const formatMap: Partial<Record<core.$ZodStringFormats, string | undefined>> = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: "", // do not set
};

// ==================== SIMPLE TYPE PROCESSORS ====================

export const stringProcessor: core.Processor<core.$ZodString> = (
  schema,
  ctx,
  _json,
  _params,
) => {
  const json = _json as core.JSONSchema.StringSchema;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod
    .bag as core.$ZodStringInternals<unknown>["bag"];
  if (typeof minimum === "number") json.minLength = minimum;
  if (typeof maximum === "number") json.maxLength = maximum;
  // custom pattern overrides format
  if (format) {
    json.format = formatMap[format as core.$ZodStringFormats] ?? format;
    if (json.format === "") delete json.format; // empty format is not valid

    // JSON Schema format: "time" requires a full time with offset or Z
    // z.iso.time() does not include timezone information, so format: "time" should never be used
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding) json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1) json.pattern = regexes[0]!.source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...(ctx.target === "draft-07" ||
          ctx.target === "draft-04" ||
          ctx.target === "openapi-3.0"
            ? ({ type: "string" } as const)
            : {}),
          pattern: regex.source,
        })),
      ];
    }
  }
};

export const numberProcessor: core.Processor<core.$ZodNumber> = (
  schema,
  ctx,
  _json,
  _params,
) => {
  const json = _json as
    | core.JSONSchema.NumberSchema
    | core.JSONSchema.IntegerSchema;
  const {
    minimum,
    maximum,
    format,
    multipleOf,
    exclusiveMaximum,
    exclusiveMinimum,
  } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else json.type = "number";

  if (typeof exclusiveMinimum === "number") {
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  }
  if (typeof minimum === "number") {
    json.minimum = minimum;
    if (typeof exclusiveMinimum === "number" && ctx.target !== "draft-04") {
      if (exclusiveMinimum >= minimum) delete json.minimum;
      else delete json.exclusiveMinimum;
    }
  }

  if (typeof exclusiveMaximum === "number") {
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  }
  if (typeof maximum === "number") {
    json.maximum = maximum;
    if (typeof exclusiveMaximum === "number" && ctx.target !== "draft-04") {
      if (exclusiveMaximum <= maximum) delete json.maximum;
      else delete json.exclusiveMaximum;
    }
  }

  if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};

export const booleanProcessor: core.Processor<core.$ZodBoolean> = (
  _schema,
  _ctx,
  json,
  _params,
) => {
  (json as core.JSONSchema.BooleanSchema).type = "boolean";
};

export const bigintProcessor: core.Processor<core.$ZodBigInt> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("BigInt cannot be represented in JSON Schema");
  }
};

export const symbolProcessor: core.Processor<core.$ZodSymbol> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Symbols cannot be represented in JSON Schema");
  }
};

export const nullProcessor: core.Processor<core.$ZodNull> = (
  _schema,
  ctx,
  json,
  _params,
) => {
  if (ctx.target === "openapi-3.0") {
    json.type = "string";
    json.nullable = true;
    json.enum = [null];
  } else {
    json.type = "null";
  }
};

export const undefinedProcessor: core.Processor<core.$ZodUndefined> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Undefined cannot be represented in JSON Schema");
  }
};

export const voidProcessor: core.Processor<core.$ZodVoid> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Void cannot be represented in JSON Schema");
  }
};

export const neverProcessor: core.Processor<core.$ZodNever> = (
  _schema,
  _ctx,
  json,
  _params,
) => {
  json.not = {};
};

export const anyProcessor: core.Processor<core.$ZodAny> = (
  _schema,
  _ctx,
  _json,
  _params,
) => {
  // empty schema accepts anything
};

export const unknownProcessor: core.Processor<core.$ZodUnknown> = (
  _schema,
  _ctx,
  _json,
  _params,
) => {
  // empty schema accepts anything
};

export const dateProcessor: core.Processor<core.$ZodDate> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Date cannot be represented in JSON Schema");
  }
};

export const enumProcessor: core.Processor<core.$ZodEnum> = (
  schema,
  _ctx,
  json,
  _params,
) => {
  const def = schema._zod.def as core.$ZodEnumDef;
  const values = core.util.getEnumValues(def.entries);
  // Number enums can have both string and number values
  if (values.every((v) => typeof v === "number")) json.type = "number";
  if (values.every((v) => typeof v === "string")) json.type = "string";
  json.enum = values;
};

export const literalProcessor: core.Processor<core.$ZodLiteral> = (
  schema,
  ctx,
  json,
  _params,
) => {
  const def = schema._zod.def as core.$ZodLiteralDef<any>;
  const vals: (string | number | boolean | null)[] = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error(
          "Literal `undefined` cannot be represented in JSON Schema",
        );
      } else {
        // do not add to vals
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
    // do nothing (an undefined literal was stripped)
  } else if (vals.length === 1) {
    const val = vals[0]!;
    json.type = val === null ? ("null" as const) : (typeof val as any);
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number")) json.type = "number";
    if (vals.every((v) => typeof v === "string")) json.type = "string";
    if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
    if (vals.every((v) => v === null)) json.type = "null";
    json.enum = vals;
  }
};

export const nanProcessor: core.Processor<core.$ZodNaN> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("NaN cannot be represented in JSON Schema");
  }
};

export const templateLiteralProcessor: core.Processor<
  core.$ZodTemplateLiteral
> = (schema, _ctx, json, _params) => {
  const _json = json as core.JSONSchema.StringSchema;
  const pattern = schema._zod.pattern;
  if (!pattern) throw new Error("Pattern not found in template literal");
  _json.type = "string";
  _json.pattern = pattern.source;
};

export const fileProcessor: core.Processor<core.$ZodFile> = (
  schema,
  _ctx,
  json,
  _params,
) => {
  const _json = json as core.JSONSchema.StringSchema;
  const file: core.JSONSchema.StringSchema = {
    type: "string",
    format: "binary",
    contentEncoding: "binary",
  };

  const { minimum, maximum, mime } = schema._zod
    .bag as core.$ZodFileInternals["bag"];
  if (minimum !== undefined) file.minLength = minimum;
  if (maximum !== undefined) file.maxLength = maximum;
  if (mime) {
    if (mime.length === 1) {
      file.contentMediaType = mime[0]!;
      Object.assign(_json, file);
    } else {
      Object.assign(_json, file); // shared props at root
      _json.anyOf = mime.map((m) => ({ contentMediaType: m })); // only contentMediaType differs
    }
  } else {
    Object.assign(_json, file);
  }
};

export const successProcessor: core.Processor<core.$ZodSuccess> = (
  _schema,
  _ctx,
  json,
  _params,
) => {
  (json as core.JSONSchema.BooleanSchema).type = "boolean";
};

export const customProcessor: core.Processor<core.$ZodCustom> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};

export const functionProcessor: core.Processor<core.$ZodFunction> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Function types cannot be represented in JSON Schema");
  }
};

export const transformProcessor: core.Processor<core.$ZodTransform> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};

export const mapProcessor: core.Processor<core.$ZodMap> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Map cannot be represented in JSON Schema");
  }
};

export const setProcessor: core.Processor<core.$ZodSet> = (
  _schema,
  ctx,
  _json,
  _params,
) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Set cannot be represented in JSON Schema");
  }
};

// ==================== COMPOSITE TYPE PROCESSORS ====================

export const arrayProcessor: core.Processor<core.$ZodArray> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const json = _json as core.JSONSchema.ArraySchema;
  const def = schema._zod.def as core.$ZodArrayDef;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number") json.minItems = minimum;
  if (typeof maximum === "number") json.maxItems = maximum;

  json.type = "array";
  json.items = core.process(def.element, ctx as any, {
    ...params,
    path: [...params.path, "items"],
  });
};

export const objectProcessor: core.Processor<core.$ZodObject> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const json = _json as core.JSONSchema.ObjectSchema;
  const def = schema._zod.def as core.$ZodObjectDef;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;

  for (const key in shape) {
    json.properties[key] = core.process(shape[key]!, ctx as any, {
      ...params,
      path: [...params.path, "properties", key],
    });
  }

  // required keys
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set(
    [...allKeys].filter((key) => {
      const v = def.shape[key]!._zod;
      if (ctx.io === "input") {
        return v.optin === undefined;
      } else {
        return v.optout === undefined;
      }
    }),
  );

  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }

  // catchall
  if (def.catchall?._zod.def.type === "never") {
    // strict
    json.additionalProperties = false;
  } else if (!def.catchall) {
    // regular
    if (ctx.io === "output") json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = core.process(def.catchall, ctx as any, {
      ...params,
      path: [...params.path, "additionalProperties"],
    });
  }
};

export const unionProcessor: core.Processor<core.$ZodUnion> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodUnionDef;
  // Exclusive unions (inclusive === false) use oneOf (exactly one match) instead of anyOf (one or more matches)
  // This includes both z.xor() and discriminated unions
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) =>
    core.process(x, ctx as any, {
      ...params,
      path: [...params.path, isExclusive ? "oneOf" : "anyOf", i],
    }),
  );
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};

export const intersectionProcessor: core.Processor<core.$ZodIntersection> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodIntersectionDef;
  const a = core.process(def.left, ctx as any, {
    ...params,
    path: [...params.path, "allOf", 0],
  });
  const b = core.process(def.right, ctx as any, {
    ...params,
    path: [...params.path, "allOf", 1],
  });

  const isSimpleIntersection = (val: any) =>
    "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...(isSimpleIntersection(a) ? (a.allOf as any[]) : [a]),
    ...(isSimpleIntersection(b) ? (b.allOf as any[]) : [b]),
  ];
  json.allOf = allOf;
};

export const tupleProcessor: core.Processor<core.$ZodTuple> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const json = _json as core.JSONSchema.ArraySchema;
  const def = schema._zod.def as core.$ZodTupleDef;
  json.type = "array";

  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath =
    ctx.target === "draft-2020-12"
      ? "items"
      : ctx.target === "openapi-3.0"
        ? "items"
        : "additionalItems";

  const prefixItems = def.items.map((x, i) =>
    core.process(x, ctx as any, {
      ...params,
      path: [...params.path, prefixPath, i],
    }),
  );
  const rest = def.rest
    ? core.process(def.rest, ctx as any, {
        ...params,
        path: [
          ...params.path,
          restPath,
          ...(ctx.target === "openapi-3.0" ? [def.items.length] : []),
        ],
      })
    : null;

  if (ctx.target === "draft-2020-12") {
    json.prefixItems = prefixItems;
    if (rest) {
      json.items = rest;
    }
  } else if (ctx.target === "openapi-3.0") {
    json.items = {
      anyOf: prefixItems,
    };

    if (rest) {
      json.items.anyOf!.push(rest);
    }
    json.minItems = prefixItems.length;
    if (!rest) {
      json.maxItems = prefixItems.length;
    }
  } else {
    json.items = prefixItems;
    if (rest) {
      json.additionalItems = rest;
    }
  }

  // length
  const { minimum, maximum } = schema._zod.bag as {
    minimum?: number;
    maximum?: number;
  };
  if (typeof minimum === "number") json.minItems = minimum;
  if (typeof maximum === "number") json.maxItems = maximum;
};

export const recordProcessor: core.Processor<core.$ZodRecord> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const json = _json as core.JSONSchema.ObjectSchema;
  const def = schema._zod.def as core.$ZodRecordDef;
  json.type = "object";

  // For looseRecord with regex patterns, use patternProperties
  // This correctly represents "only validate keys matching the pattern" semantics
  // and composes well with allOf (intersections)
  const keyType = def.keyType as core.$ZodTypes;
  const keyBag = keyType._zod.bag as
    | core.$ZodStringInternals<unknown>["bag"]
    | undefined;
  const patterns = keyBag?.patterns;

  if (def.mode === "loose" && patterns && patterns.size > 0) {
    // Use patternProperties for looseRecord with regex patterns
    const valueSchema = core.process(def.valueType, ctx as any, {
      ...params,
      path: [...params.path, "patternProperties", "*"],
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    // Default behavior: use propertyNames + additionalProperties
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = core.process(def.keyType, ctx as any, {
        ...params,
        path: [...params.path, "propertyNames"],
      });
    }
    json.additionalProperties = core.process(def.valueType, ctx as any, {
      ...params,
      path: [...params.path, "additionalProperties"],
    });
  }

  // Add required for keys with discrete values (enum, literal, etc.)
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter(
      (v): v is string | number =>
        typeof v === "string" || typeof v === "number",
    );

    if (validKeyValues.length > 0) {
      json.required = validKeyValues as string[];
    }
  }
};

export const nullableProcessor: core.Processor<core.$ZodNullable> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodNullableDef;
  const inner = core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};

export const nonoptionalProcessor: core.Processor<core.$ZodNonOptional> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const def = schema._zod.def as core.$ZodNonOptionalDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
};

export const defaultProcessor: core.Processor<core.$ZodDefault> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodDefaultDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};

export const prefaultProcessor: core.Processor<core.$ZodPrefault> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodPrefaultDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};

export const catchProcessor: core.Processor<core.$ZodCatch> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodCatchDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
  let catchValue: any;
  try {
    catchValue = def.catchValue(undefined as any);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};

export const pipeProcessor: core.Processor<core.$ZodPipe> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const def = schema._zod.def as core.$ZodPipeDef;
  const innerType =
    ctx.io === "input"
      ? def.in._zod.def.type === "transform"
        ? def.out
        : def.in
      : def.out;
  core.process(innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = innerType;
};

export const readonlyProcessor: core.Processor<core.$ZodReadonly> = (
  schema,
  ctx,
  json,
  params,
) => {
  const def = schema._zod.def as core.$ZodReadonlyDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
  json.readOnly = true;
};

export const promiseProcessor: core.Processor<core.$ZodPromise> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const def = schema._zod.def as core.$ZodPromiseDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
};

export const optionalProcessor: core.Processor<core.$ZodOptional> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const def = schema._zod.def as core.$ZodOptionalDef;
  core.process(def.innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = def.innerType;
};

export const lazyProcessor: core.Processor<core.$ZodLazy> = (
  schema,
  ctx,
  _json,
  params,
) => {
  const innerType = (schema as core.$ZodLazy)._zod.innerType;
  core.process(innerType, ctx as any, params);
  const seen = ctx.seen.get(schema)!;
  seen.ref = innerType;
};

// ==================== ALL PROCESSORS ====================

export const allProcessors = {
  string: stringProcessor,
  number: numberProcessor,
  boolean: booleanProcessor,
  bigint: bigintProcessor,
  symbol: symbolProcessor,
  null: nullProcessor,
  undefined: undefinedProcessor,
  void: voidProcessor,
  never: neverProcessor,
  any: anyProcessor,
  unknown: unknownProcessor,
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
  nan: nanProcessor,
  template_literal: templateLiteralProcessor,
  file: fileProcessor,
  success: successProcessor,
  custom: customProcessor,
  function: functionProcessor,
  transform: transformProcessor,
  map: mapProcessor,
  set: setProcessor,
  array: arrayProcessor,
  object: objectProcessor,
  union: unionProcessor,
  intersection: intersectionProcessor,
  tuple: tupleProcessor,
  record: recordProcessor,
  nullable: nullableProcessor,
  nonoptional: nonoptionalProcessor,
  default: defaultProcessor,
  prefault: prefaultProcessor,
  catch: catchProcessor,
  pipe: pipeProcessor,
  readonly: readonlyProcessor,
  promise: promiseProcessor,
  optional: optionalProcessor,
  lazy: lazyProcessor,
};

// ==================== TOP-LEVEL toJSONSchema ====================

export function toJSONSchema<T extends core.$ZodType>(
  schema: T,
  params?: core.ToJSONSchemaParams,
): core.ZodStandardJSONSchemaPayload<T>;
export function toJSONSchema(
  registry: core.$ZodRegistry<{ id?: string | undefined }>,
  params?: core.RegistryToJSONSchemaParams,
): {
  schemas: Record<string, core.ZodStandardJSONSchemaPayload<core.$ZodType>>;
};
export function toJSONSchema(
  input: core.$ZodType | core.$ZodRegistry<{ id?: string | undefined }>,
  params?: core.ToJSONSchemaParams | core.RegistryToJSONSchemaParams,
): any {
  if ("_idmap" in input) {
    // Registry case
    const registry = input as core.$ZodRegistry<{ id?: string | undefined }>;
    const ctx = core.initializeContext({
      ...params,
      processors: allProcessors as any,
    });
    const defs: any = {};

    // First pass: process all schemas to build the seen map
    for (const entry of registry._idmap.entries()) {
      const [_, schema] = entry;
      core.process(schema, ctx as any);
    }

    const schemas: Record<string, core.JSONSchema.BaseSchema> = {};
    const external = {
      registry,
      uri: (params as core.RegistryToJSONSchemaParams)?.uri,
      defs,
    };

    // Update the context with external configuration
    ctx.external = external;

    // Second pass: emit each schema
    for (const entry of registry._idmap.entries()) {
      const [key, schema] = entry;
      core.extractDefs(ctx as any, schema);
      schemas[key] = core.finalize(ctx as any, schema);
    }

    if (Object.keys(defs).length > 0) {
      const defsSegment =
        ctx.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs,
      };
    }

    return { schemas };
  }

  // Single schema case
  const ctx = core.initializeContext({
    ...params,
    processors: allProcessors as any,
  });
  core.process(input, ctx as any);
  core.extractDefs(ctx as any, input);
  return core.finalize(ctx as any, input);
}
