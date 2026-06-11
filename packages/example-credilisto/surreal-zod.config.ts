import { defineConfig } from "surreal-zod/config";

export default defineConfig({
  // schema and migrations default to ./database/schema and ./database/migrations
  // schema: "./database/schema",
  // migrations: "./database/migrations",
  db: {
    url: process.env.SURREAL_URL ?? "ws://localhost:8000",
    namespace: process.env.SURREAL_NAMESPACE ?? "app",
    database: process.env.SURREAL_DATABASE ?? "app",
    username: process.env.SURREAL_USER,
    password: process.env.SURREAL_PASS,
    authLevel: "root", // "root" | "namespace" | "database"
  },
});
