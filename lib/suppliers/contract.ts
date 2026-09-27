/**
 * Storage-independent supplier evidence values shared by route validation and
 * OpenAPI discovery. Keep this module free of database imports so agents can
 * inspect the contract even when operating storage is unavailable.
 */
export const EVIDENCE_STATUSES = [
  "not_requested",
  "requested",
  "received",
  "expired",
  "rejected",
  "not_applicable",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_TYPES = [
  "certificate_of_origin",
  "material_declaration",
  "reach",
  "rohs",
  "pfas",
  "sni",
  "test_report",
  "other",
] as const;
