import { defineConfig } from "@schemic/core/config";

export default defineConfig({
  db: {
    url: process.env.SURREAL_URL ?? "ws://localhost:8000",
    namespace: process.env.SURREAL_NAMESPACE ?? "app",
    database: process.env.SURREAL_DATABASE ?? "app",
    username: process.env.SURREAL_USER,
    password: process.env.SURREAL_PASS,
  },
});
