import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DISKANN DIMENSION @dimension (minimal vector index)",
  note: "`.$diskann({ dimension })` — a disk-based ANN vector index (lower memory than HNSW). `DIMENSION` is the only required option.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD embedding ON TABLE doc TYPE array<number>;
DEFINE INDEX doc_embedding_idx ON TABLE doc FIELDS embedding DISKANN DIMENSION 128;`,
  def: defineTable("doc", {
    embedding: s.array(s.number()).$diskann({ dimension: 128 }),
  }).schemafull(),
});
