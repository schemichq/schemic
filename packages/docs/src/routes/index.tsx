import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  CheckCheck,
  Database,
  FileCode2,
  Github,
  Lock,
  Radio,
  Shapes,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";

const GITHUB_URL = "https://github.com/msanchezdev/surreal-zod";

const SCHEMA_CODE = `import { sz, table, relation } from "surreal-zod";
import { surql } from "surrealdb";

export const User = table("user", {
  id: sz.string(),
  name: sz.string(),
  email: sz.email(),
  status: sz.string().$default("pending"),
  createdAt: sz.datetime().$default(surql\`time::now()\`).$readonly(),
});

export const Friend = relation("friend", {
  strength: sz.number().$gte(0).$lte(1),
})
  .from(User)
  .to(User);`;

const DDL_CODE = `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD name ON TABLE user TYPE string;
DEFINE FIELD email ON TABLE user TYPE string
  ASSERT string::is_email($value);
DEFINE FIELD status ON TABLE user TYPE string DEFAULT "pending";
DEFINE FIELD createdAt ON TABLE user TYPE datetime
  DEFAULT time::now() READONLY;`;

const RW_CODE = `// write — DB-filled fields are optional, every value validated
await db.query(surql\`CREATE user CONTENT \${User.encode({
  name: "Ada",
  email: "ada@example.com",
})}\`);

// read — rows decoded into your app types
const user = User.decode(row);
user.createdAt; // a real Date, not a string
user.id;        // a RecordId<"user">`;

// Highlight the (static) landing snippets at build time with Shiki — runs on the server
// during prerender, so the page ships pre-highlighted HTML with no client highlighter.
const highlightSnippets = createServerFn({ method: "GET" }).handler(
  async () => {
    const { codeToHtml } = await import("shiki");
    const opts = {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    } as const;
    const [schema, ddl, rw] = await Promise.all([
      codeToHtml(SCHEMA_CODE, { lang: "ts", ...opts }),
      codeToHtml(DDL_CODE, { lang: "sql", ...opts }),
      codeToHtml(RW_CODE, { lang: "ts", ...opts }),
    ]);
    return { schema, ddl, rw };
  },
);

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => highlightSnippets(),
});

function Home() {
  const code = Route.useLoaderData();
  return (
    <HomeLayout {...baseOptions()}>
      <Hero schemaHtml={code.schema} />
      <Pipeline />
      <Features />
      <Walkthrough ddlHtml={code.ddl} rwHtml={code.rw} />
      <Positioning />
      <FinalCta />
      <Footer />
    </HomeLayout>
  );
}

function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-4 ${className}`}>
      {children}
    </section>
  );
}

function Hero({ schemaHtml }: { schemaHtml: string }) {
  return (
    <div className="relative overflow-hidden border-b border-fd-border">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, color-mix(in oklab, var(--color-fd-primary) 14%, transparent), transparent)",
        }}
      />
      <Section className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
            <span className="size-1.5 rounded-full bg-fd-primary" />
            v0.1.0-alpha · Zod 4 · SurrealDB 3.x
          </span>
          <h1 className="text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Author SurrealDB schemas with{" "}
            <span className="text-fd-primary">Zod</span>.
          </h1>
          <p className="text-balance text-lg text-fd-muted-foreground">
            One Zod definition becomes your SurrealQL DDL, your runtime
            validation, and a fully-typed JS⇄DB mapping — no codegen, no
            parallel schema language.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/docs/$"
              params={{ _splat: "getting-started/quick-start" }}
              className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started <ArrowRight className="size-4" />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              <Github className="size-4" /> GitHub
            </a>
          </div>
          <code className="rounded-lg border border-fd-border bg-fd-card px-3 py-2 text-sm text-fd-muted-foreground">
            <span className="text-fd-primary">$</span> bun add surreal-zod
            surrealdb zod
          </code>
        </div>
        <div className="min-w-0">
          <CodeCard title="schema.ts" html={schemaHtml} />
        </div>
      </Section>
    </div>
  );
}

function CodeCard({ title, html }: { title: string; html: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5">
        <span className="size-3 rounded-full bg-red-400/70" />
        <span className="size-3 rounded-full bg-yellow-400/70" />
        <span className="size-3 rounded-full bg-green-400/70" />
        <span className="ml-2 font-mono text-xs text-fd-muted-foreground">
          {title}
        </span>
      </div>
      {/* Pre-highlighted on the server at build time — see highlightSnippets. */}
      <div
        className="sz-shiki"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted build-time Shiki output
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function Pipeline() {
  const steps = [
    {
      icon: <Shapes className="size-5" />,
      title: "sz.*",
      body: "A drop-in for z.* that also carries SurrealQL type metadata.",
    },
    {
      icon: <FileCode2 className="size-5" />,
      title: "defineTable",
      body: "Generate DEFINE TABLE / DEFINE FIELD DDL straight from the schema.",
    },
    {
      icon: <ArrowLeftRight className="size-5" />,
      title: "decode / encode",
      body: "Map rows ⇄ app objects across Zod codecs: DateTime⇄Date, Uuid⇄string, RecordId.",
    },
  ];
  return (
    <Section className="py-16">
      <h2 className="text-center text-2xl font-semibold">
        One definition, three outputs
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-center text-fd-muted-foreground">
        Your <code>sz</code> table is the single source of truth. Everything
        else is derived from it.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.title}
            className="rounded-xl border border-fd-border bg-fd-card p-6"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
              {s.icon}
            </div>
            <h3 className="mt-4 font-mono text-base font-semibold">
              {s.title}
            </h3>
            <p className="mt-2 text-sm text-fd-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Features() {
  const features = [
    {
      icon: <Database className="size-5" />,
      title: "Codec-typed reads & writes",
      body: "encode / encodePartial build create- and patch-shaped payloads; decode restores real app types on the way out.",
    },
    {
      icon: <Lock className="size-5" />,
      title: "Row-level permissions",
      body: "Author table and field PERMISSIONS with WHERE expressions, same-as reuse, and faithful omitted-op defaults.",
    },
    {
      icon: <CheckCheck className="size-5" />,
      title: "Asserts & constraints",
      body: "Format builders bake string::is_* asserts; $-constraints run app-side and push a matching DB fragment.",
    },
    {
      icon: <Boxes className="size-5" />,
      title: "Nested objects",
      body: "sz.object recurses: nested defaults stay create-optional, and encodePartial deep-merges to match MERGE.",
    },
    {
      icon: <Workflow className="size-5" />,
      title: "Graph relations",
      body: "relation(...).from(X).to(Y) defines edge tables with typed in/out endpoints, decoded like any row.",
    },
    {
      icon: <Radio className="size-5" />,
      title: "Live queries",
      body: "A subscription payload is just a row — decode it with the same schema. A typed query layer is on the roadmap.",
    },
  ];
  return (
    <Section className="py-16">
      <h2 className="text-center text-2xl font-semibold">
        Everything from the one schema
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-fd-border bg-fd-card p-6 transition-colors hover:border-fd-primary/40"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
              {f.icon}
            </div>
            <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Walkthrough({ ddlHtml, rwHtml }: { ddlHtml: string; rwHtml: string }) {
  return (
    <div className="border-y border-fd-border bg-fd-muted/30">
      <Section className="py-16">
        <h2 className="text-center text-2xl font-semibold">
          From schema to database
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-fd-muted-foreground">
          The same table definition drives the DDL you apply and the typed
          values you read and write.
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-fd-muted-foreground">
              <FileCode2 className="size-4" /> defineTable(User) →
            </h3>
            <CodeCard title="schema.surql" html={ddlHtml} />
          </div>
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-fd-muted-foreground">
              <ArrowLeftRight className="size-4" /> encode / decode →
            </h3>
            <CodeCard title="app.ts" html={rwHtml} />
          </div>
        </div>
      </Section>
    </div>
  );
}

function Positioning() {
  const rows = [
    [
      "Schema authoring",
      "sz.* — real Zod schemas",
      "A separate query-only type system",
    ],
    ["DDL generation", "Built in (defineTable)", "Not provided"],
    [
      "Reads",
      "Decoded to App types via codecs",
      "Validated, ad-hoc date handling",
    ],
    ["Query builder", "Planned (surreal-zod/orm)", "Available today"],
  ];
  return (
    <Section className="py-16">
      <h2 className="text-center text-2xl font-semibold">Where it fits</h2>
      <p className="mx-auto mt-2 max-w-2xl text-center text-fd-muted-foreground">
        surreal-zod focuses on schemas, DDL, and codec-typed mapping. It's
        complementary to a query builder like{" "}
        <a
          className="text-fd-primary underline-offset-4 hover:underline"
          href="https://github.com/surrealdb/surqlize"
          target="_blank"
          rel="noreferrer"
        >
          surqlize
        </a>
        .
      </p>
      <div className="mt-8 overflow-hidden rounded-xl border border-fd-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-fd-muted/50">
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-semibold">surreal-zod</th>
              <th className="px-4 py-3 font-medium text-fd-muted-foreground">
                Typical query-only ORM
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-t border-fd-border">
                <td className="px-4 py-3 font-medium">{r[0]}</td>
                <td className="px-4 py-3">{r[1]}</td>
                <td className="px-4 py-3 text-fd-muted-foreground">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <Section className="py-20">
      <div className="relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card p-10 text-center">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background:
              "radial-gradient(50% 80% at 50% 0%, color-mix(in oklab, var(--color-fd-primary) 12%, transparent), transparent)",
          }}
        />
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Define once. Use everywhere.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-fd-muted-foreground">
          Schema, DDL, validation, and a typed read/write mapping — all from a
          single Zod definition.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Read the docs <ArrowRight className="size-4" />
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
          >
            <Github className="size-4" /> Star on GitHub
          </a>
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <Section className="flex flex-col items-center justify-between gap-4 py-8 text-sm text-fd-muted-foreground sm:flex-row">
        <span className="font-mono">
          surreal<span className="text-fd-primary">-zod</span>
        </span>
        <div className="flex items-center gap-5">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="hover:text-fd-foreground"
          >
            Docs
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-fd-foreground"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/surreal-zod"
            target="_blank"
            rel="noreferrer"
            className="hover:text-fd-foreground"
          >
            npm
          </a>
        </div>
        <span>MIT Licensed</span>
      </Section>
    </footer>
  );
}
