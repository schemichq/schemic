/** A small relational domain exercising the driver's most advanced authoring at once. */
import { defineTable, s, sqlExpr } from "../../src/authoring";
import type { ExampleGroup } from "./_kit";

const customer = defineTable("customer", {
  email: s.text().$unique().$check(sqlExpr("email ~* '^[^@]+@[^@]+$'")),
  name: s.text(),
});

const order = defineTable("order", {
  customer: customer.record({ onDelete: "cascade" }),
  quantity: s.integer().$check(sqlExpr("quantity > 0")),
  unitPrice: s.numeric(10, 2),
  total: s.numeric(12, 2).$generated('quantity * "unitPrice"'),
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});

export const group: ExampleGroup = {
  file: "06-relations.ts",
  about:
    "Depth — relations, checks, numeric precision, defaults, and a generated column together",
  examples: [
    {
      title: "customer / order: FK + CHECK + generated column + unique index",
      defs: [customer, order],
      ddl: `CREATE TABLE "customer" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL CHECK (email ~* '^[^@]+@[^@]+$'),
  "name" text NOT NULL
);
CREATE TABLE "order" (
  "id" text PRIMARY KEY,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "customer" text NOT NULL,
  "quantity" integer NOT NULL CHECK (quantity > 0),
  "total" numeric(12, 2) NOT NULL GENERATED ALWAYS AS (quantity * "unitPrice") STORED,
  "unitPrice" numeric(10, 2) NOT NULL
);
CREATE UNIQUE INDEX "customer_email_key" ON "customer" ("email");
ALTER TABLE "order" ADD CONSTRAINT "order_customer_fkey" FOREIGN KEY ("customer") REFERENCES "customer" ("id") ON DELETE CASCADE;`,
    },
  ],
};
