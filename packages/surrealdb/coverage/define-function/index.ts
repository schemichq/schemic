import { coverage } from "../_kit";
import base from "./01-base";
import comment from "./09-comment";
import ifNotExists from "./03-if-not-exists";
import noArgs from "./05-no-args";
import overwrite from "./02-overwrite";
import permissionsFull from "./06-permissions-full";
import permissionsNone from "./07-permissions-none";
import permissionsWhere from "./08-permissions-where";
import returns from "./04-returns";

/** Every permutation of the `DEFINE FUNCTION` statement, in grammar order. A function is a standalone
 *  def (`defineFunction(name, args).body(…)`), so each item pins its single `DEFINE FUNCTION …` line.
 *  Schemic authors args / -> return / body / PERMISSIONS / COMMENT + OVERWRITE / IF NOT EXISTS;
 *  GRAPHQL_ALIAS / GRAPHQL_DEPRECATED (new in v3.1.0) have no `s.*` surface yet. */
export const defineFunctionCoverage = coverage("DEFINE FUNCTION", [
  // [ OVERWRITE | IF NOT EXISTS ] fn::@name ( @args ) [ -> @type ] { @body } [ PERMISSIONS ] [ COMMENT ]
  base,
  overwrite,
  ifNotExists,
  // ( @args ) [ -> @type ] { @body }
  returns,
  noArgs,
  // [ PERMISSIONS NONE | FULL | WHERE @condition ]
  permissionsFull,
  permissionsNone,
  permissionsWhere,
  // [ COMMENT @string ]
  comment,
]);
