import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "HNSW … DIST | TYPE | EFC | M (tuned)",
  note: "All HNSW knobs: `dist` (distance metric), `type` (vector element type), `efc` (ef_construction), `m` (max connections). Emitted as `DIST … TYPE … EFC … M …` (the canonical 3.1.x order).",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD embedding ON TABLE doc TYPE array<number>;
DEFINE INDEX doc_embedding_idx ON TABLE doc FIELDS embedding HNSW DIMENSION 128 DIST COSINE TYPE F32 EFC 150 M 12;`,
  def: defineTable("doc", {
    embedding: s
      .array(s.number())
      .$hnsw({ dimension: 128, dist: "cosine", type: "f32", efc: 150, m: 12 }),
  }).schemafull(),
});
