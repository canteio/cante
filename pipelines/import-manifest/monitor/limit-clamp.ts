/**
 * Pure helper for the "Results per page" control on the import-monitor panel.
 *
 * Extracted out of app/import-monitor/panel.tsx (2026-09-16 run fixed a bug
 * there: `Number(limit) || 50` treated an explicit 0 as falsy and silently
 * fell back to 50 for local paging state while the raw string was still sent
 * to the API, which rejects limit<1 with 400 — Previous/Next could then step
 * by a size the server never actually used). That fix landed inline in the
 * client component, which the test suite cannot exercise (no DOM/React
 * runtime in this repo's `node --test` setup — see monitor.test.ts and
 * status-labels.test.ts for the existing pattern of pulling UI logic out
 * into a plain function specifically so it gets unit coverage).
 *
 * This mirrors the server's `monitorQuery` schema in query.ts (limit is an
 * integer, min 1, max 100, default 50) so the client can never construct a
 * request the server would reject for this field, and the exact same
 * clamping is now testable in isolation instead of only reachable through a
 * rendered form submission.
 */
export function clampLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}
