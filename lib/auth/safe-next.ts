import { DEFAULT_JURISDICTION } from "@/lib/countries";

// Where a completed login should land when there was no `next` redirect param
// (e.g. a bookmarked /login hit directly) or the supplied one looks unsafe
// (open-redirect guard: must be a same-origin path, not a protocol-relative "//" URL).
//
// This used to be hardcoded to "/chat?country=Indonesia" — a stale PT MA pilot
// default. Company plan now targets US-based customers only (PT MA/Indonesia
// deprioritized), and every other jurisdiction-aware route (app/onboarding,
// app/chat via normalizeJurisdiction) already falls back to DEFAULT_JURISDICTION
// ("United States"). That constant had silently drifted out of sync here, so a
// fresh login with no `next` param landed a US customer in Indonesia's chat data.
export function safeNext(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return `/chat?country=${encodeURIComponent(DEFAULT_JURISDICTION)}`;
  }
  return rawNext;
}
