import { coverage } from "../_kit";
import base from "./01-base";
import comment from "./08-comment";
import fn from "./04-function";
import filters from "./07-filters";
import ifNotExists from "./03-if-not-exists";
import overwrite from "./02-overwrite";
import tokenizersMultiple from "./06-tokenizers-multiple";
import tokenizersSingle from "./05-tokenizers-single";

/** Every permutation of the `DEFINE ANALYZER` statement, in grammar order:
 *  DEFINE ANALYZER [OVERWRITE|IF NOT EXISTS] name [FUNCTION fn::…] [TOKENIZERS …] [FILTERS …] [COMMENT …] */
export const defineAnalyzerCoverage = coverage("DEFINE ANALYZER", [
  // [ OVERWRITE | IF NOT EXISTS ] @name
  base,
  overwrite,
  ifNotExists,
  // [ FUNCTION @function ]
  fn,
  // [ TOKENIZERS @tokenizers ]
  tokenizersSingle,
  tokenizersMultiple,
  // [ FILTERS @filters ]
  filters,
  // [ COMMENT @string ]
  comment,
]);
