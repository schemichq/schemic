import { coverage } from "../_kit";
import base from "./01-base";
import comment from "./14-comment";
import composite from "./04-composite";
import count from "./13-count";
import diskann from "./11-diskann";
import diskannTuned from "./12-diskann-tuned";
import fulltextAnalyzer from "./06-fulltext-analyzer";
import fulltextBm25 from "./07-fulltext-bm25";
import fulltextHighlights from "./08-fulltext-highlights";
import hnsw from "./09-hnsw";
import hnswTuned from "./10-hnsw-tuned";
import ifNotExists from "./03-if-not-exists";
import overwrite from "./02-overwrite";
import unique from "./05-unique";

/** Every permutation of the `DEFINE INDEX` statement, in grammar order. Indexes are authored on a table
 *  (`.index(name, fields, spec?)`) or inline on a field (`.$unique()`/`.$index()`/`.$fulltext()`/
 *  `.$hnsw()`/`.$diskann()`), so each item is a minimal table whose emit pins the `DEFINE INDEX …` line. */
export const defineIndexCoverage = coverage("DEFINE INDEX", [
  // [ OVERWRITE | IF NOT EXISTS ] @name ON [ TABLE ] @table [ FIELDS | COLUMNS ] @fields
  base,
  overwrite,
  ifNotExists,
  // [ FIELDS | COLUMNS ] @fields (composite)
  composite,
  // UNIQUE
  unique,
  // FULLTEXT ANALYZER @analyzer [ BM25 [(@k1, @b)] ] [ HIGHLIGHTS ]
  fulltextAnalyzer,
  fulltextBm25,
  fulltextHighlights,
  // HNSW DIMENSION @dimension [ TYPE | DIST | EFC | M ]
  hnsw,
  hnswTuned,
  // DISKANN DIMENSION @dimension [ TYPE | DIST | DEGREE | L_BUILD | ALPHA ]
  diskann,
  diskannTuned,
  // COUNT
  count,
  // COMMENT @string
  comment,
]);
