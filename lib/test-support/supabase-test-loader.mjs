import { registerHooks } from "node:module";

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
