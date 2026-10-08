import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

// Load .env in every test-runner child process. Node's --test glob isolates
// each test FILE in its own process by default, so a single file loading
// .env (e.g. via lib/test-support/supabase-test-db.ts) does not make the
// variables visible to any other file -- any test file that never imports
// that fixture directly runs with Supabase/OpenAI credentials genuinely
// unset. That silently degrades lookupSection232Live()'s createClient()
// call to a thrown error, which stack.ts correctly treats as "unresolved"
// and falls back to the historical static table -- not a crash, just a
// quietly wrong (stale) duty calculation in the one test file that doesn't
// happen to pull in the env-loading fixture. Loading .env here, once, in
// the loader every test file already imports, closes that gap for every
// test file regardless of which fixtures it uses.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Matches scripts/load-env.ts: a real exported env var always wins, and
    // a missing/unreadable .env must never crash the test run itself.
  }
}

// Replace only Next's request-cookie adapter in the test process. All queries,
// constraints and RPCs still execute against the real Supabase project.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.endsWith("/lib/supabase/server.ts")) {
      return { ...result, url: new URL("./supabase-test-server.ts", import.meta.url).href };
    }
    return result;
  },
});
