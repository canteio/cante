import type { HsCodeTier } from "@/lib/checks/facts";

/**
 * Storage-free classification values shared by request validation and OpenAPI
 * discovery. Keep database imports out so agents can discover the contract
 * before a deployment configures its operating-data store.
 */
export const CLASSIFICATION_TIERS = ["document", "human", "lead", "guess"] as const satisfies readonly HsCodeTier[];
export const DIRECT_CLASSIFICATION_TIERS = ["human", "lead", "guess"] as const satisfies readonly HsCodeTier[];
export const CLASSIFICATION_STATUSES = ["proposed", "approved", "rejected", "superseded"] as const;
export const CLASSIFICATION_PATCH_ACTIONS = ["approve", "reject"] as const;
