/**
 * UI/UX fix: the import-monitor panel used to render `source.status`
 * ("ok" | "blocked" | "error" | "sample") verbatim to a logged-in customer,
 * e.g. "Shipments: blocked" with zero context on what "blocked" means or
 * what to do about it. A non-technical user has no way to know that
 * "blocked" means "no shipment source is configured" versus a transient
 * problem. Pulled out as a pure, unit-tested mapping (rather than inline
 * JSX ternaries) so the copy is testable and reusable if another surface
 * (e.g. an email digest) needs the same human-readable status later.
 */
import type { SourceStatus } from "./model";

export function describeSourceStatus(status: SourceStatus["status"]): string {
  switch (status) {
    case "ok":
      return "Live";
    case "sample":
      return "Sample data only (not a real discovery)";
    case "blocked":
      return "Not configured — no data source is connected yet";
    case "error":
      return "Fetch failed — showing last known good data";
    default:
      // Exhaustiveness guard: if SourceStatus grows a new status value,
      // fail loudly in tests/tsc instead of silently showing "undefined"
      // to a customer.
      return status satisfies never;
  }
}
