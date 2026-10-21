import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (result.url.endsWith("/app/api/request-limits.ts")) return { ...result, url: new URL("./request-limits-fixture.ts", import.meta.url).href };
  return result;
} });
