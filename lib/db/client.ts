import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "@/lib/db/schema";

/**
 * Single SQLite file at the repo root. Cached on globalThis so Next's dev
 * hot-reload doesn't open a new handle on every module reload.
 *
 * Lazy by design: this module is imported by lib/db/queries.ts even when
 * running in Supabase/cloud mode (CANTE_DATA_BACKEND=supabase), where no
 * writable cante.db exists on the deploy filesystem (e.g. Vercel's
 * read-only serverless functions). Opening the file eagerly at module
 * evaluation time crashed every page that imports queries.ts in production
 * with SqliteError/SQLITE_CANTOPEN, even though cloud-mode code paths never
 * touch `db` at all. A Proxy defers the real `new Database(...)` open
 * until the first property access, which only ever happens on an actual
 * sqlite-mode query.
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

function getDb() {
  if (!globalForDb.canteDb) {
    globalForDb.canteDb = create();
  }
  return globalForDb.canteDb;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
