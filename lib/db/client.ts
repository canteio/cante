import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "@/lib/db/schema";

/**
 * Single SQLite file at the repo root. Cached on globalThis so Next's dev
 * hot-reload doesn't open a new handle on every module reload.
 */
const globalForDb = globalThis as unknown as {
  canteDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function create() {
  const file = process.env.CANTE_DB_PATH || path.join(process.cwd(), "cante.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.canteDb ?? create();

if (process.env.NODE_ENV !== "production") globalForDb.canteDb = db;

export { schema };
