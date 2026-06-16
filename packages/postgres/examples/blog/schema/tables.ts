import { defineTable, s, sqlExpr } from "@schemic/postgres";

// A small blog schema authored in Postgres-native vocabulary. Each table lowers to the portable IR
// and emits Postgres DDL; `<table>.record()` makes a typed foreign key to it.

export const author = defineTable("author", {
  email: s.varchar(255).$unique(),
  name: s.text(),
  bio: s.text().optional(),
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});

export const post = defineTable("post", {
  title: s.varchar(200),
  body: s.text(),
  views: s.integer().$default(0).$check("views >= 0"),
  rating: s.numeric(3, 2).optional(),
  meta: s.jsonb(),
  author: author.record({ onDelete: "cascade" }),
  publishedAt: s.timestamptz().optional(),
});

export const tag = defineTable("tag", {
  label: s.text().$unique(),
});

// A composite-primary-key join table (no implicit `id` column).
export const postTag = defineTable("post_tag", {
  post: post.record({ onDelete: "cascade" }),
  tag: tag.record({ onDelete: "cascade" }),
}).primaryKey("post", "tag");
