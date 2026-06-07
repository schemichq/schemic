import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { transformerTwoslash } from "fumadocs-twoslash";
import ts from "typescript";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      // Shiki can't lazy-load langs inside Twoslash popups — declare them up front.
      langs: ["ts", "tsx", "js", "jsx", "bash", "sql", "json"],
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash({
          // Type-check samples against the real surreal-zod public types. Bundler
          // resolution honors the `exports` maps of zod/surrealdb (and surreal-zod).
          twoslashOptions: {
            compilerOptions: {
              moduleResolution: ts.ModuleResolutionKind.Bundler,
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ESNext,
              strict: true,
              skipLibCheck: true,
            },
          },
        }),
      ],
    },
  },
});
