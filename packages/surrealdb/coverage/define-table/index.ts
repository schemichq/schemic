import { coverage } from "../_kit";
import base from "./01-base";
import changefeed from "./13-changefeed";
import changefeedIncludeOriginal from "./14-changefeed-include-original";
import comment from "./18-comment";
import drop from "./04-drop";
import ifNotExists from "./03-if-not-exists";
import overwrite from "./02-overwrite";
import permissionsForOps from "./17-permissions-for-ops";
import permissionsFull from "./16-permissions-full";
import permissionsNone from "./15-permissions-none";
import relation from "./07-relation";
import relationEndpointsUnion from "./09-relation-endpoints-union";
import relationEnforced from "./10-relation-enforced";
import relationFromTo from "./08-relation-from-to";
import schemaless from "./05-schemaless";
import typeAny from "./06-type-any";
import view from "./11-view";
import viewTyped from "./12-view-typed";

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
