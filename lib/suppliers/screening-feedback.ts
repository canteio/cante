export type SupplierScreeningFeedback = {
  kind: "success" | "attention" | "error";
  message: string;
};

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
