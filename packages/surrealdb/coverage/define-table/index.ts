import { coverage } from "../_kit";
import base from "./base";
import changefeed from "./changefeed";
import changefeedIncludeOriginal from "./changefeed-include-original";
import comment from "./comment";
import drop from "./drop";
import ifNotExists from "./if-not-exists";
import overwrite from "./overwrite";
import permissionsForOps from "./permissions-for-ops";
import permissionsFull from "./permissions-full";
import permissionsNone from "./permissions-none";
import relation from "./relation";
import relationEndpointsUnion from "./relation-endpoints-union";
import relationEnforced from "./relation-enforced";
import relationFromTo from "./relation-from-to";
import schemaless from "./schemaless";
import typeAny from "./type-any";
import view from "./view";
import viewTyped from "./view-typed";

/** Every permutation of the `DEFINE TABLE` statement, in grammar order. */
export const defineTableCoverage = coverage("DEFINE TABLE", [
  // [ OVERWRITE | IF NOT EXISTS ] @name
  base,
  overwrite,
  ifNotExists,
  // [ DROP ]
  drop,
  // [ SCHEMAFULL | SCHEMALESS ]
  schemaless,
  // [ TYPE [ ANY | NORMAL | RELATION [ IN|FROM ] @table [ OUT|TO ] @table [ ENFORCED ] ] ]
  typeAny,
  relation,
  relationFromTo,
  relationEndpointsUnion,
  relationEnforced,
  // [ AS SELECT … ]  (the SELECT body — WHERE/GROUP — is query-builder territory, not table-builder syntax)
  view,
  viewTyped,
  // [ CHANGEFEED … ]
  changefeed,
  changefeedIncludeOriginal,
  // [ PERMISSIONS … ]
  permissionsNone,
  permissionsFull,
  permissionsForOps,
  // [ COMMENT … ]
  comment,
]);
