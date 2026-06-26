import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "HNSW DIMENSION @dimension (minimal vector index)",
  note: "`.$hnsw({ dimension })` — an in-memory HNSW vector index for approximate nearest-neighbour search over a numeric array. `DIMENSION` is the only required option.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD embedding ON TABLE doc TYPE array<number>;
DEFINE INDEX doc_embedding_idx ON TABLE doc FIELDS embedding HNSW DIMENSION 128;`,
  def: defineTable("doc", {
    embedding: s.array(s.number()).$hnsw({ dimension: 128 }),
  }).schemafull(),
});
