import { z } from "zod";

// Keep discovery independent of database initialization while sharing API validation.
export const checklistStatusSchema = z.enum([
  "unknown", "required", "not_required", "completed", "expiring", "blocked",
  "needs_review", "verified", "needs_evidence", "monitored", "not_applicable",
  "source_failed", "requires_expert_review",
]);
