export type SupplierRegistrationFeedback = {
  kind: "success" | "error";
  message: string;
};

/** Keep a saved registration distinct from the follow-up list refresh. */
export function supplierRegistrationFeedback(
  supplierName: string,
  refreshError: string | null,
): SupplierRegistrationFeedback {
  const saved = `Vendor "${supplierName}" was registered.`;
  if (!refreshError) return { kind: "success", message: saved };

  // The write succeeded, but the visible cards are stale. One alert communicates
  // both facts without replacing the refresh failure with a green success state.
  return {
    kind: "error",
    message: `${saved} Current suppliers could not be refreshed: ${refreshError} Reload before relying on the displayed list.`,
  };
}
