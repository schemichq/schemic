import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DISKANN … DIST | TYPE | DEGREE | L_BUILD | ALPHA (tuned)",
  note: "All DiskANN knobs Schemic authors: `dist`, `type`, `degree`, `l_build`, `alpha`. (The engine's `HASHED_VECTOR` flag has no `s.*` authoring yet.) Emitted as `DIST … TYPE … DEGREE … L_BUILD … ALPHA …`.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD embedding ON TABLE doc TYPE array<number>;
DEFINE INDEX doc_embedding_idx ON TABLE doc FIELDS embedding DISKANN DIMENSION 128 DIST COSINE TYPE F32 DEGREE 32 L_BUILD 64 ALPHA 1.2;`,
  def: defineTable("doc", {
    embedding: s.array(s.number()).$diskann({
      dimension: 128,
      dist: "cosine",
      type: "f32",
      degree: 32,
      l_build: 64,
      alpha: 1.2,
    }),
  }).schemafull(),
});
