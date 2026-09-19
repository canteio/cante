export type SupplierEmptyState = {
  kind: "empty" | "no_match";
  message: string;
};

/** Distinguish an empty supplier list from a filter with no matches. */
export function supplierEmptyState(
  totalSuppliers: number,
  search: string,
): SupplierEmptyState {
  if (totalSuppliers === 0) {
    return {
      kind: "empty",
      message: "No suppliers registered yet. Add a vendor above or tell the AI Copilot in chat.",
    };
  }

  return {
    kind: "no_match",
    message: `No vendors match "${search.trim()}".`,
  };
}
