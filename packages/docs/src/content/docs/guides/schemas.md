---
title: Defining schemas
description: Author tables, fields, and relations with sz.*.
---

:::note[Placeholder]
Scaffold page — real content lands in a later pass.
:::

`sz.*` mirrors `z.*` 1:1, so the Zod you already know carries over: refinements,
defaults, coercion, and `infer` / `input` / `output`. Migrate an existing schema
by find-and-replacing `z.` with `sz.`.

```ts
import { sz, defineTable } from "surreal-zod";

export const Post = defineTable("post", {
  title: sz.string(),
  body: sz.string(),
  author: sz.recordId("user"),
  published: sz.boolean().default(false),
});
```
