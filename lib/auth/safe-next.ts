import { DEFAULT_JURISDICTION } from "@/lib/countries";

// Where a completed login should land when there was no `next` redirect param
// (e.g. a bookmarked /login hit directly) or the supplied one looks unsafe
// (open-redirect guard: must be a same-origin path, not a protocol-relative "//" URL).
export function safeNext(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    // Previous broad app landing: `/chat?country=${encodeURIComponent(DEFAULT_JURISDICTION)}`
    return "/tariff";
  }
  return rawNext;
}
