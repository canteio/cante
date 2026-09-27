export type SupplierScreeningFeedback = {
  kind: "success" | "attention" | "error";
  message: string;
};

/** Give repeated card actions a unique name and announce the active state. */
export function supplierScreenActionLabel(name: string, busy: boolean): string {
  return busy
    ? `Screening ${name} against sanctions watchlists`
    : `Screen ${name} against sanctions watchlists`;
}

/** Keep a failed post-screen refresh distinct from the screening outcomes. */
export function supplierBatchRefreshError(total: number, failed: number, refreshError: string | null): string | null {
  if (!refreshError) return null;

  return `Screening requests finished (${total - failed} completed, ${failed} failed), but current results could not be refreshed: ${refreshError} Reload before relying on the displayed results.`;
}

/** Preserve the mutation outcome while warning that the visible supplier card is stale. */
export function supplierScreenRefreshError(
  feedback: SupplierScreeningFeedback | null,
  refreshError: string | null,
): string | null {
  if (!refreshError) return null;

  const outcome = feedback?.message ?? "Screening request finished.";
  return `${outcome} Current results could not be refreshed: ${refreshError} Reload before relying on the displayed result.`;
}

/**
 * Confirm that a batch item produced a completed persisted screening.
 * Matches still count as completed; stored errors and unknown shapes must be
 * retried instead of being hidden behind the batch's success message.
 */
export function supplierBatchScreenCompleted(payload: Record<string, unknown>): boolean {
  const row = payload.row;
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;

  const outcome = (row as Record<string, unknown>).outcome;
  return outcome === "clear" || outcome === "match";
}

/** Turn the supplier screen route's persisted `row` into user-facing feedback. */
export function supplierScreeningFeedback(payload: Record<string, unknown> | null): SupplierScreeningFeedback | null {
  const row = payload?.row;
  if (!row || typeof row !== "object") return null;

  const result = row as Record<string, unknown>;
  if (result.outcome === "error") {
    const detail = typeof result.errorMessage === "string" && result.errorMessage.trim()
      ? `: ${result.errorMessage}`
      : ".";
    return { kind: "error", message: `Screening could not be completed${detail}` };
  }

  if (result.outcome === "match") {
    const count = typeof result.matchCount === "number" ? result.matchCount : 0;
    return {
      kind: "attention",
      message: `Screening found ${count} potential watchlist match${count === 1 ? "" : "es"}. Review before proceeding.`,
    };
  }

  if (result.outcome === "clear") {
    return {
      kind: "success",
      message: "Screening completed with no exact watchlist match. This is not a clearance decision.",
    };
  }

  return null;
}
