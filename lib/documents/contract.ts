export const DOCUMENTS_ACTIONS = ["ingest", "audit", "price", "promote"] as const;

export const DOCUMENT_TYPES = [
  "peb",
  "commercial_invoice",
  "packing_list",
  "purchase_order",
  "customs_entry",
  "bill_of_lading",
  "other",
] as const;
