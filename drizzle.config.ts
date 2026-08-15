import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // Must match lib/db/client.ts, or `db:push` writes the schema to one file
  // while the app reads another.
  dbCredentials: { url: process.env.CANTE_DB_PATH || "./cante.db" },
} satisfies Config;
