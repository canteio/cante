/**
 * Storage-independent values shared by route validation and OpenAPI discovery.
 * Keeping these outside bom.ts lets tools inspect the API without opening a
 * customer database as a side effect of importing the contract.
 */
export const SUBSTANCES_ACTIONS = ["component", "declare", "load_list"] as const;

export const RESTRICTION_VERDICTS = [
  "over_threshold",
  "present_unknown_amount",
  "below_threshold",
  "undeclared",
] as const;
