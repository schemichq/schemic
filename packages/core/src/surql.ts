import {
  BoundQuery,
  escapeIdent,
  escapeIdPart,
  surql,
  Table,
  toSurqlString as baseToSurqlString,
} from "surrealdb";
import * as core from "zod/v4/core";
import * as _schema_ from "./zod/schema.js";
import * as _core_ from "./zod/core.js";
import dedent from "dedent";

const OPEN_ISSUE_FOR_SUPPORT =
  " If you need this, please open an issue on the repository so we can look into your use case and possible implementation. https://github.com/msanchezdev/surreal-zod/issues";

/////////////////////////////////////
/////////////////////////////////////
//////////                 //////////
//////////      Table      //////////
//////////                 //////////
/////////////////////////////////////
/////////////////////////////////////

export function tableToSurql(
  table: _schema_.ZodSurrealTable,
  statement: "define",
  defineOptions?: DefineTableOptions,
): BoundQuery<[undefined]>;
export function tableToSurql(
  table: _schema_.ZodSurrealTable,
  statement: "remove",
  removeOptions?: RemoveTableOptions,
): BoundQuery<[undefined]>;
export function tableToSurql(
  table: _schema_.ZodSurrealTable,
  statement: "info",
): BoundQuery<[TableInfo]>;
export function tableToSurql(
  table: _schema_.ZodSurrealTable,
  statement: "structure",
): BoundQuery<[TableStructure]>;
export function tableToSurql(
  table: _schema_.ZodSurrealTable,
  statement: "define" | "info" | "structure" | "remove",
  options?: DefineTableOptions | RemoveTableOptions,
): BoundQuery<[TableInfo | TableStructure]> {
  if (statement === "define") {
    return defineTable(table, options as DefineTableOptions);
  }
  if (statement === "info") {
    return infoTable(table);
  }
  if (statement === "structure") {
    return structureTable(table);
  }
  if (statement === "remove") {
    return removeTable(table, options as RemoveTableOptions);
  }
  throw new Error(`Invalid statement: ${statement}`);
}

export type RemoveTableOptions = {
  /**
   * What to do if the table is missing.
   * - "ignore": Ignore the error and continue.
   * - "error": Throw an error if the table is missing.
   * @default "error"
   */
  missing?: "ignore" | "error";
};

export function removeTable(
  table: _schema_.ZodSurrealTable,
  options?: RemoveTableOptions,
): BoundQuery<[undefined]> {
  const name = table._zod.def.name;
  const query = surql`REMOVE TABLE`;
  const removeOptions = options as RemoveTableOptions;
  if (removeOptions?.missing === "ignore") {
    query.append(" IF EXISTS");
  }
  query.append(` ${escapeIdent(name)}`);
  query.append(";");
  return query;
}

export interface TableInfo {
  events: Record<string, string>;
  fields: Record<string, string>;
  indexes: Record<string, string>;
  lives: Record<string, string>;
  tables: Record<string, string>;
}

export function infoTable(
  table: _schema_.ZodSurrealTable,
): BoundQuery<[TableInfo]> {
  const name = table._zod.def.name;
  const query = surql`INFO FOR TABLE`;
  query.append(` ${escapeIdent(name)}`);
  query.append(";");
  return query;
}

export interface TableStructure {
  events: unknown[];
  fields: FieldStructure[];
  indexes: unknown[];
  lives: unknown[];
  tables: unknown[];
}

export interface FieldStructure {
  name: string;
  kind: string;
  permissions: {
    create: boolean;
    select: boolean;
    update: boolean;
  };
  readonly: boolean;
  what: string;
}

export function structureTable(
  table: _schema_.ZodSurrealTable,
): BoundQuery<[TableStructure]> {
  const name = table._zod.def.name;
  const query = surql`INFO FOR TABLE`;
  query.append(` ${escapeIdent(name)}`);
  query.append(" STRUCTURE;");
  return query;
}

export type DefineTableOptions = {
  exists?: "ignore" | "error" | "overwrite";
  fields?: boolean;
};

export function defineTable(
  schema: _schema_.ZodSurrealTable,
  options?: DefineTableOptions,
): BoundQuery<[undefined, ...undefined[]]> {
  const def = schema._zod.def;
  const surreal = schema._zod.def.surreal;
  const table = new Table(def.name);

  const query = surql`DEFINE TABLE`;

  if (options?.exists === "ignore") {
    query.append(" IF NOT EXISTS");
  } else if (options?.exists === "overwrite") {
    query.append(" OVERWRITE");
  }
  // Looks like passing Table instance is not supported yet
  query.append(` ${escapeIdPart(table.name)}`);
  query.append(` TYPE ${surreal.tableType.toUpperCase()}`);

  if (isRelationTable(schema)) {
    const fromTables = schema._zod.def.fields.in._zod.def.table;
    if (fromTables) {
      query.append(` FROM ${fromTables.map(escapeIdent).join(" | ")}`);
    }
    const toTables = schema._zod.def.fields.out._zod.def.table;
    if (toTables) {
      query.append(` TO ${toTables.map(escapeIdent).join(" | ")}`);
    }
  }

  if (surreal.drop) {
    query.append(" DROP");
  }

  if (surreal.schemafull) {
    query.append(" SCHEMAFULL");
  } else {
    query.append(" SCHEMALESS");
  }

  if (surreal.comment) {
    query.append(surql` COMMENT ${surreal.comment}`);
  }

  query.append(";\n");

  if (options?.fields) {
    for (const [fieldName, fieldSchema] of Object.entries(def.fields) as [
      string,
      _core_.$ZodSurrealType,
    ][]) {
      let defaultValue: DefineFieldOptions["default"];
      let comment: DefineFieldOptions["comment"];
      let readonly: DefineFieldOptions["readonly"];
      let assert: DefineFieldOptions["assert"];
      let value: DefineFieldOptions["value"];
      if (fieldSchema instanceof _schema_.ZodSurrealField) {
        defaultValue = fieldSchema._zod.def.surreal.field?.default;
        comment = fieldSchema._zod.def.surreal.field?.comment;
        readonly = fieldSchema._zod.def.surreal.field?.readonly;
        assert = fieldSchema._zod.def.surreal.field?.assert;
        value = fieldSchema._zod.def.surreal.field?.value;
      }

      query.append(
        defineField(
          fieldName,
          table.name,
          fieldName === "id"
            ? (fieldSchema as _schema_.ZodSurrealdRecordId)._zod.def.innerType
            : fieldSchema,
          {
            exists: options.exists,
            schemafull: surreal.schemafull,
            default: defaultValue,
            comment,
            readonly,
            assert,
            value,
            // @ts-expect-error - @internal
            // We need to add the table schema to the fullParents set to avoid
            // infinite recursion. Child fields keep a separate context from
            // the table or other fields.
            // The resting point for fullParents is in the inferSurrealType function,
            // on the switch case for the "lazy" type.
            fullParents: new Set([schema]),
          },
        ),
      );
    }
  }

  return query;
}

export function isRelationTable(
  table: unknown,
): table is _schema_.ZodSurrealTable<
  string,
  {
    [K in "in" | "out" | "id"]: _schema_.ZodSurrealdRecordId;
  },
  _schema_.SurrealZodTableConfig,
  "relation"
> {
  return (
    table instanceof _schema_.ZodSurrealTable &&
    table._zod.def.surreal.tableType === "relation"
  );
}

export interface ZodToSurqlOptions<S extends _schema_.ZodSurrealObject> {
  table: string | Table;
  schemafull?: boolean;
  exists?: "ignore" | "error" | "overwrite";
  drop?: boolean;
  comment?: string;
  schema: S;
}

export type DefineFieldOptions = {
  exists?: "ignore" | "error" | "overwrite";
  schemafull?: boolean;
  default?: {
    value: BoundQuery;
    always?: boolean;
    prase?: boolean;
  };
  comment?: string;
  readonly?: boolean;
  assert?: BoundQuery;
  value?: BoundQuery;
  // @internal
  // fullParents?: Set<core.$ZodType>;
};

export function defineField(
  name: string,
  table: string,
  schema: _core_.$ZodSurrealType,
  options?: DefineFieldOptions,
) {
  const query = surql`DEFINE FIELD`;

  if (options?.exists === "ignore") {
    query.append(" IF NOT EXISTS");
  } else if (options?.exists === "overwrite") {
    query.append(" OVERWRITE");
  }

  query.append(` ${name} ON TABLE ${escapeIdent(table)}`);

  const context: ZodSurrealTypeContext = {
    type: new Set(),
    depth: 0,
    parents: new Set(),
    // @ts-expect-error - @internal
    fullParents: options?.fullParents ?? new Set(),
    children: [],
    flexible: false,
  };
  query.append(` TYPE ${inferSurrealType(schema, context).type}`);
  if (options?.schemafull && context.flexible) {
    query.append(" FLEXIBLE");
  }

  if (options?.readonly) {
    query.append(" READONLY");
  }

  if (options?.default) {
    query.append(
      options.default.always
        ? ` DEFAULT ALWAYS ${formatQuery(inlineQueryParameters(options.default.value))}`
        : ` DEFAULT ${formatQuery(inlineQueryParameters(options.default.value))}`,
    );
  }

  if (options?.value) {
    query.append(` VALUE ${inlineQueryParameters(options.value)}`);
  }

  if (options?.assert) {
    query.append(` ASSERT ${inlineQueryParameters(options.assert)}`);
  }

  if (options?.comment) {
    query.append(` COMMENT ${JSON.stringify(options.comment)}`);
  }

  // const type =
  //   name === "id"
  //     ? inferSurrealType(
  //         (schema as unknown as ZodSurrealRecordId)._zod.def.innerType,
  //         [],
  //         context,
  //       )
  //     : inferSurrealType(schema, [], context);

  // query.append(` TYPE ${type}`);

  // if (context.default) {
  //   query.append(
  //     context.default.always
  //       ? ` DEFAULT ALWAYS ${JSON.stringify(context.default.value)}`
  //       : ` DEFAULT ${JSON.stringify(context.default.value)}`,
  //   );
  // }

  // if (context.transforms.length > 0) {
  //   query.append(` VALUE {\n`);
  //   for (const transform of context.transforms) {
  //     query.append(
  //       dedent.withOptions({ alignValues: true })`
  //         //
  //             ${transform}\n`.slice(3),
  //     );
  //   }
  //   query.append(`}`);
  // }

  // if (context.asserts.length > 0) {
  //   query.append(` ASSERT {\n`);
  //   for (const assert of context.asserts) {
  //     query.append(
  //       dedent.withOptions({ alignValues: true })`
  //         //
  //             ${assert}\n`.slice(3),
  //     );
  //   }
  //   query.append(`}`);
  // }

  query.append(`;\n`);

  if (context.children.length > 0) {
    context.fullParents.add(schema);
    for (const { name: childName, type: childType } of context.children) {
      query.append(
        defineField(
          `${escapeIdent(name)}.${childName === "*" ? childName : escapeIdent(childName)}`,
          table,
          childType as _core_.$ZodSurrealType,
          {
            exists: options?.exists,
            // @ts-expect-error - @internal
            fullParents: context.fullParents,
          },
        ),
      );
    }
  }

  return query;
}

type ZodSurrealTypeContext = {
  // name: string;
  // table: Table;
  // rootSchema: z4.$ZodType;
  // children: ZodSurrealChildType[];
  // asserts: string[];
  // transforms: string[];
  // default?: { value: any; always: boolean };
  type: Set<string>;
  parents: Set<_core_.$ZodSurrealType>;
  fullParents: Set<_core_.$ZodSurrealType>;
  depth: number;
  children: ZodSurrealChildType[];
  flexible: boolean;
};
type ZodSurrealChildType = { name: string; type: core.$ZodType };

function createContext(
  override?: Partial<ZodSurrealTypeContext>,
): ZodSurrealTypeContext {
  return {
    type: new Set<string>(),
    depth: 0,
    parents: new Set<_core_.$ZodSurrealType>(),
    fullParents: new Set<_core_.$ZodSurrealType>(),
    children: [],
    flexible: false,
    ...override,
  };
}

export function inferSurrealType(
  type: _core_.$ZodSurrealType,
  context?: ZodSurrealTypeContext,
): { type: string; context: ZodSurrealTypeContext } {
  context ??= createContext();

  function enter(
    type: _core_.$ZodSurrealType,
    ctx?: Omit<Partial<ZodSurrealTypeContext>, "parents"> | true,
  ) {
    context ??= createContext();
    if (context.parents.has(type)) {
      console.warn("Recursive type detected", type._zod.def.type);
      context.type.add("any");
      // throw new Error("Recursive type detected");
      return { type: "any", context };
    }

    const newContext = ctx
      ? {
          children: [],
          flexible: false,
          type: new Set<string>(),
          depth: context.depth + 1,
          ...(typeof ctx === "object" ? ctx : {}),
          parents: context.parents,
          fullParents: context.fullParents,
        }
      : context;
    context.parents.add(type);
    context.fullParents.add(type);
    const result = inferSurrealType(type, newContext);
    context.fullParents.delete(type);
    context.parents.delete(type);
    return result;
  }

  const schema = type as _schema_.ZodSurrealTypes;
  if (!("_zod" in schema)) {
    throw new Error("Invalid schema provided, make sure you are using zod v4+");
  }

  // console.log(schema);

  const def = schema._zod.def;
  // const checks = getChecks(schema);
  // parseChecks(context.name, checks, context, def.type);
  // console.log(zodToSexpr(type));
  // console.log(def);
  if (def.surreal.type) {
    context.type.add(def.surreal.type);
  } else
    switch (/* isSurrealZodSchemaDef(def) ? */ def.type /*: def.type*/) {
      // case "record_id": {
      //   const table = (def as ZodSurrealdRecordId["_zod"]["def"]).table;
      //   if (table) {
      //     context.type.add(`record<${table.map(escapeIdent).join(" | ")}>`);
      //   } else {
      //     context.type.add("record");
      //   }
      //   break;
      // }
      // case "uuid": {
      //   context.type.add("uuid");
      //   break;
      // }
      // case "table": {
      //   throw new Error(
      //     `Table type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
      //   );
      // }

      // case "void":
      // case "never":
      // case "undefined": {
      //   context.type.add("none");
      //   break;
      // }
      case "optional": {
        enter(def.innerType);
        context.type.add("none");
        break;
      }
      case "nonoptional": {
        enter(def.innerType);

        if (context.type.size > 1 && context.type.has("none")) {
          context.type.delete("none");
        }
        break;
      }
      case "nullable": {
        enter(def.innerType);
        context.type.add("null");
        break;
      }
      // case "boolean": {
      //   context.type.add("bool");
      //   break;
      // }
      // case "string": {
      //   // Needs override, this will not work with original zod types
      //   // if (isStringFormat(def)) {
      //   //   switch (def.format) {
      //   //     case "uuid":
      //   //     case "guid":
      //   //       context.type.add("uuid");
      //   //       break TYPE_CHECK;
      //   //   }
      //   // }

      //   context.type.add("string");
      //   break;
      // }
      // case "bigint": {
      //   if (!isBigIntFormat(def as core.$ZodBigIntFormatDef)) {
      //     context.type.add("int");
      //     break;
      //   }

      //   switch ((def as core.$ZodBigIntFormatDef).format) {
      //     case "int64":
      //     case "uint64":
      //       context.type.add("int");
      //       break;
      //     default:
      //       throw new Error(
      //         `Unsupported bigint format: ${(def as core.$ZodBigIntFormatDef).format}`,
      //       );
      //   }
      //   break;
      // }
      // case "number": {
      //   if (!isNumberFormat(def as core.$ZodNumberDef)) {
      //     context.type.add("number");
      //     break;
      //   }

      //   switch ((def as core.$ZodNumberFormatDef).format) {
      //     case "uint32":
      //     case "safeint":
      //     case "int32":
      //       context.type.add("int");
      //       break;
      //     case "float64":
      //     case "float32":
      //       context.type.add("float");
      //       break;
      //     default:
      //       throw new Error(
      //         `Unsupported number format: ${(def as core.$ZodNumberFormatDef).format}. ${OPEN_ISSUE_FOR_SUPPORT}`,
      //       );
      //   }
      //   break;
      // }
      // case "date": {
      //   context.type.add("datetime");
      //   break;
      // }
      case "object": {
        const shape = (def as core.$ZodObjectDef).shape;
        const catchall = (def as core.$ZodObjectDef).catchall;
        const isStrict = catchall?._zod.traits.has("$ZodNever");
        const isLoose = catchall?._zod.traits.has("$ZodUnknown");

        // buggy syntax
        // if (isStrict) {
        //   let type = "{";
        //   if (Object.keys(shape).length > 0) {
        //     type += "\n";
        //   }
        //   for (const [key, value] of Object.entries(shape)) {
        //     const childContext: ZodSurrealTypeContext = {
        //       type: new Set(),
        //       depth: context.depth + 1,
        //       children: [],
        //     };
        //     type += `${childIndent}${escapeIdent(key)}: ${inferSurrealType(value, childContext).inner},\n`;
        //   }
        //   type += "}";
        //   context.type.add(type);
        //   break;
        // }

        context.type.add("object");
        if (isLoose) context.flexible = true;
        for (const [key, value] of Object.entries(shape)) {
          context.children.push({ name: key, type: value as core.$ZodType });
        }
        break;
      }
      case "array": {
        const { type: element } = enter(def.element, true);
        if (element === "any") {
          context.type.add("array");
          break;
        }

        context.type.add(`array<${element}>`);
        break;
      }
      case "set": {
        const { type: element } = enter(def.valueType, true);
        if (element === "any") {
          context.type.add("array");
          break;
        }

        context.type.add(`array<${element}>`);
        break;
      }
      case "enum": {
        const values = def.entries;
        for (const key in values) {
          const value = values[key];
          context.type.add(toSurqlString(value));
        }
        break;
      }
      case "union": {
        for (const option of def.options) {
          // context.type.add(inferSurrealType(option, context).inner);
          enter(option);
        }
        break;
      }
      // case "intersection": {
      //   // TODO: Find a way to handle intersections
      //   // Maybe a new function where we build a new object schema (or primitive one)
      //   // And keep track of all the types that are used in the intersection
      //   //
      //   // const left = def.left;
      //   // const right = def.right;
      //   // inferSurrealType(left, context);
      //   // inferSurrealType(right, context);
      //   // inferSurrealType(z.never(), context);
      //   // context.type.add("any");
      //   context.type.add("any");
      //   break;
      // }
      case "tuple": {
        if (def.rest) {
          context.type.add("array");
          break;
        }

        const types = new Set<string>();
        for (const item of def.items) {
          types.add(enter(item, true).type);
        }
        context.type.add(`[${Array.from(types).join(", ")}]`);
        break;
      }
      // case "record": {
      //   context.type.add("object");
      //   // Currently there is no way to restrict the key type of an object, so we just use *
      //   // context.children.push({ name: "*", type: def.keyType });
      //   // All commented out code is because of this. Check is only done in JS side.
      //   enter((def as core.$ZodRecordDef).keyType, true);
      //   /* const isPartial =
      //     def.keyType._zod.values === undefined &&
      //     !keyContext.type.has("string") &&
      //     !keyContext.type.has("number") &&
      //     !keyContext.type.has("int") &&
      //     !keyContext.type.has("float") &&
      //     !keyContext.type.has("decimal"); */
      //   context.children.push({
      //     name: "*",
      //     type: /* isPartial ? z.optional(def.valueType) : */ (
      //       def as core.$ZodRecordDef
      //     ).valueType,
      //   });
      //   break;
      // }
      // case "map": {
      //   context.type.add("object");
      //   // Currently there is no way to restrict the key type of an object, so we just use *
      //   // Surreal doesnt have a map type, so we use object instead. We cant really support non PropertyKey values
      //   // unless we serialize the keys to strings.
      //   const { context: keyContext } = enter(
      //     (def as core.$ZodMapDef).keyType,
      //     true,
      //   );
      //   for (const key of keyContext.type) {
      //     if (!["string", "number", "float", "int", "decimal"].includes(key)) {
      //       throw new Error(`Unsupported key type: ${key}`);
      //     }
      //   }
      //   context.children.push({
      //     name: "*",
      //     type: (def as core.$ZodMapDef).valueType,
      //   });
      //   break;
      // }
      case "literal": {
        for (const value of (def as core.$ZodLiteralDef<any>).values) {
          context.type.add(toSurqlString(value));
        }
        break;
      }
      case "file": {
        throw new Error(
          `File type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
        );
      }
      case "transform": {
        break;
      }
      case "readonly":
      case "catch":
      case "prefault":
      case "default": {
        enter(def.innerType);
        break;
      }
      case "success": {
        context.type.add("string");
        break;
      }
      case "nan": {
        context.type.add("number");
        break;
      }
      case "pipe": {
        enter(def.in);
        enter(def.out);
        break;
      }
      case "template_literal": {
        context.type.add("string");
        break;
      }
      case "lazy": {
        const innerType = def.getter();
        // All that cascading to get here, we dont want to keep complex types if
        // recursive.
        if (context.fullParents.has(type) || context.parents.has(type)) {
          context.type.add("any");
        } else {
          enter(innerType);
        }
        break;
      }
      case "promise": {
        // We will not support promises for now, this can be uncommented after
        // support is added
        // const { inner: innerType } =
        // enter(def.innerType);
        // context.type.add(innerType);
        throw new Error(
          `Promise type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
        );
      }
      case "function": {
        throw new Error(
          `Function type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
        );
      }
      case "custom": {
        throw new Error(
          `Custom type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
        );
      }
      case "symbol": {
        throw new Error(
          `Symbol type cannot be used as a field type.${OPEN_ISSUE_FOR_SUPPORT}`,
        );
      }
    }

  const inner =
    context.type.has("any") || context.type.size === 0
      ? "any"
      : Array.from(context.type).join(" | ");

  return { type: inner, context };
}

// function isSurrealZodSchemaDef(
//   def: core.$ZodTypeDef | ZodSurrealTypeDef,
// ): def is ZodSurrealTypeDef {
//   return "surreal" in def && def.surreal.type !== undefined;
// }

// function isStringFormat(
//   def: core.$ZodStringDef,
// ): def is core.$ZodStringFormatTypes["_zod"]["def"] {
//   return def.type === "string" && "format" in def;
// }

// function isBigIntFormat(
//   def: core.$ZodBigIntDef,
// ): def is core.$ZodBigIntFormatDef {
//   return def.type === "bigint" && "format" in def;
// }

// function isNumberFormat(
//   def: core.$ZodNumberDef,
// ): def is core.$ZodNumberFormatDef {
//   return def.type === "number" && "format" in def;
// }

// // function getChecks(_schema: z4.$ZodType | SurrealZodType) {
// //   const schema = _schema as z4.$ZodTypes | SurrealZodTypes;
// //   const checks = schema._zod.def.checks ?? [];
// //   if ("check" in schema._zod.def) {
// //     checks.unshift(schema as z4.$ZodCheck);
// //   }
// //   return checks;
// // }

// // function parseChecks(
// //   name: string,
// //   checks: z4.$ZodCheck[],
// //   context: ZodSurrealTypeContext,
// //   type: ZodTypeName | SurrealZodTypeName,
// // ) {
// //   for (const check of checks) {
// //     const { transform, assert } = parseCheck(name, check, type);
// //     if (transform) {
// //       context.transforms.push(transform);
// //     }
// //     if (assert) {
// //       context.asserts.push(assert);
// //     }
// //   }
// // }

// // export const checkMap = {
// //   never(name: string) {
// //     return `THROW 'Field "${name}" must never be present'`;
// //   },
// //   min_length(name: string, value: number, type: ZodTypeName) {
// //     if (type === "array") {
// //       return `$value.len() >= ${value} || { THROW 'Field "${name}" must have at least ${value} ${value === 1 ? "item" : "items"}' };`;
// //     }

// //     if (type === "string") {
// //       return `$value.len() >= ${value} || { THROW 'Field "${name}" must be at least ${value} ${value === 1 ? "character" : "characters"} long' };`;
// //     }

// //     throw new Error(`Invalid type: ${type}`);
// //   },
// //   max_length(name: string, value: number, type: ZodTypeName) {
// //     if (type === "array") {
// //       return `$value.len() <= ${value} || { THROW 'Field "${name}" must have at most ${value} ${value === 1 ? "item" : "items"}' };`;
// //     }

// //     if (type === "string") {
// //       return `$value.len() <= ${value} || { THROW 'Field "${name}" must be at most ${value} ${value === 1 ? "character" : "characters"} long' };`;
// //     }

// //     throw new Error(`Invalid type: ${type}`);
// //   },
// //   greater_than(name: string, value: z4.util.Numeric, inclusive: boolean) {
// //     return `$value ${inclusive ? ">=" : ">"} ${value} || { THROW 'Field "${name}" must be greater than ${inclusive ? "or equal to" : ""} ${value}' };`;
// //   },
// //   less_than(name: string, value: z4.util.Numeric, inclusive: boolean) {
// //     return `$value ${inclusive ? "<=" : "<"} ${value} || { THROW 'Field "${name}" must be less than ${inclusive ? "or equal to" : ""} ${value}' };`;
// //   },
// //   length_equals(name: string, value: number, type: ZodTypeName = "string") {
// //     if (type === "array") {
// //       return `$value.len() == ${value} || { THROW 'Field "${name}" must have exactly ${value} ${value === 1 ? "item" : "items"}' };`;
// //     }

// //     if (type === "string") {
// //       return `$value.len() == ${value} || { THROW 'Field "${name}" must be exactly ${value} ${value === 1 ? "character" : "characters"} long' };`;
// //     }

// //     throw new Error(`Invalid type: ${type}`);
// //   },

// //   string_format: {
// //     email: (name: string) => {
// //       const regex =
// //         /^[A-Za-z0-9'_+-]+(?:\.[A-Za-z0-9'_+-]+)*@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
// //       return `string::matches($value, ${regex}) || { THROW "Field '${name}' must be a valid email address" };`;
// //     },
// //     url: (
// //       name: string,
// //       def?: Pick<z4.$ZodCheckURLParams, "hostname" | "protocol" | "normalize">,
// //     ) => {
// //       return dedent`
// //         LET $url = {
// //             scheme: parse::url::scheme($value),
// //             host: parse::url::host($value),
// //             domain: parse::url::domain($value),
// //             path: parse::url::path($value),
// //             port: parse::url::port($value),
// //             query: parse::url::query($value),
// //             hash: parse::url::fragment($value),
// //         };
// //         $url.scheme || { THROW "Field '${name}' must be a valid URL" };
// //         ${
// //           def?.hostname
// //             ? `($url.host ?? "").matches(${def.hostname}) || { THROW "Field '${name}' must match hostname ${def.hostname.toString().replace(/\\/g, "\\\\")}" };`
// //             : ""
// //         }
// //         ${
// //           def?.protocol
// //             ? `($url.scheme ?? "").matches(${def.protocol}) || { THROW "Field '${name}' must match protocol ${def.protocol.toString().replace(/\\/g, "\\\\")}" };`
// //             : ""
// //         }
// //         $url.scheme + "://" + ($url.host ?? "") + (
// //             IF $url.port && (
// //                 ($url.scheme == "http" && $url.port != 80) ||
// //                 ($url.scheme == "https" && $url.port != 443)
// //             ) { ":" + <string>$url.port } ?? ""
// //         )
// //         + ($url.path ?? "")
// //         + (IF $url.query { "?" + $url.query } ?? "")
// //         + (IF $url.fragment { "#" + $url.fragment } ?? "");
// //       `;
// //     },
// //   },
// // };

// // function parseCheck(
// //   name: string,
// //   _check: z4.$ZodCheck,
// //   type: ZodTypeName,
// // ): { transform?: string; assert?: string } {
// //   const check = _check as z4.$ZodChecks;
// //   const def = check._zod.def;
// //   switch (def.check) {
// //     case "min_length":
// //       return { assert: checkMap.min_length(name, def.minimum, type) };
// //     case "max_length":
// //       return { assert: checkMap.max_length(name, def.maximum, type) };
// //     case "greater_than":
// //       return { assert: checkMap.greater_than(name, def.value, def.inclusive) };
// //     case "less_than":
// //       return { assert: checkMap.less_than(name, def.value, def.inclusive) };
// //     case "length_equals":
// //       return { assert: checkMap.length_equals(name, def.length, type) };
// //     case "string_format":
// //       return assertionForStringFormat(name, check);
// //     default:
// //       return { assert: `THROW 'Unknown check: ${def.check}';` };
// //   }
// // }

// // // Remove look-around, look-behind, and look-ahead as they are not supported by SurrealDB
// // function assertionForStringFormat(
// //   name: string,
// //   _check: z4.$ZodCheck,
// // ): { transform?: string; assert?: string } {
// //   const check = _check as z4.$ZodStringFormatChecks;
// //   const def = check._zod.def;

// //   switch (def.format) {
// //     case "email": {
// //       return { assert: checkMap.string_format.email(name) };
// //     }
// //     case "url": {
// //       const code = checkMap.string_format.url(name, def);
// //       return def.normalize ? { transform: code } : { assert: code };
// //     }
// //     default:
// //       return { assert: `THROW 'Unsupported string format: ${def.format}';` };
// //   }
// // }

const SurrealQLStatements = [
  "ACCESS",
  "ALTER",
  "BEGIN",
  "BREAK",
  "CANCEL",
  "COMMIT",
  "CONTINUE",
  "CREATE",
  "DEFINE",
  "DELETE",
  "FOR",
  "IF",
  "INFO",
  "INSERT",
  "KILL",
  "LET",
  "LIVE",
  "REBUILD",
  "RELATE",
  "REMOVE",
  "RETURN",
  "SELECT",
  "SHOW",
  "SLEEP",
  "THROW",
  "UPDATE",
  "UPSERT",
  "USE",
  "EXPLAIN",
  "FETCH",
];

function hasMultipleStatements(query: string): boolean {
  let inString: false | "'" | '"' = false;
  let escaping = false;
  let statements = 0;
  let buffer = "";

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const nextBuffer = `${buffer}${ch}`;

    if (ch === "\n") return true;
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === inString) {
        inString = false;
        continue;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === " ") {
      if (SurrealQLStatements.includes(buffer.toUpperCase())) {
        return true;
      }
      continue;
    }
    if (
      ch === ";" ||
      // Single line Comments
      nextBuffer === "--" ||
      nextBuffer === "//" ||
      ch === "#"
    ) {
      statements++;
      buffer = "";
      continue;
    }

    buffer = nextBuffer;

    if (statements > 1) return true;
  }
  if (statements > 0 && (buffer || inString || escaping)) return true;
  return statements > 1;
}

export function formatQuery(query: string) {
  if (hasMultipleStatements(query)) {
    return `{\n  ${dedent.withOptions({ alignValues: true })`  ${query.trimStart()}`}\n}`;
  }

  return query.trim();
}

export function inlineQueryParameters(query: BoundQuery): string {
  let value = query.query;
  for (const [paramName, paramValue] of Object.entries(query.bindings ?? {})) {
    value = value.replace(
      new RegExp(`\\$${paramName}\\b`, "g"),
      toSurqlString(paramValue),
    );
  }
  return value;
}

function toSurqlString(value: unknown): string {
  return baseToSurqlString(value).replace(/^s"/g, '"');
}
