import { STATES_LIST } from "./actions";

/**
 * Machine-readable contract for /api/workqueue, mirroring the pattern already
 * established in pipelines/import-manifest/monitor/openapi.ts: a standard
 * OpenAPI 3.1 discovery document served at /api/workqueue/openapi so an AI
 * agent consuming this endpoint doesn't have to reverse-engineer the shape
 * from source or trial-and-error requests. GET/POST both went undocumented
 * this way despite the monitor route already setting the bar — this closes
 * that gap (see cante/company-plan "Next undone step" note, 2026-09-17).
 *
 * Kept hand-written (not derived from the drizzle/TS types) for the same
 * reason the monitor spec is hand-written: a stable, prose-friendly contract
 * that survives internal refactors. Keep in sync with lib/workflow/actions.ts
 * (ActionState/FindingWithAction), lib/impact/assess.ts (AssessmentDraft),
 * and lib/workflow/draft.ts (GeneratedActionDrafts) if their shapes change.
 */

const actionStateSchema = { type: "string", enum: STATES_LIST } as const;

const findingSchema = {
  type: "object",
  description: "The immutable regulatory finding this queue item is about.",
  properties: {
    id: { type: "string" },
    checkRunId: { type: "string" },
    customerId: { type: "string" },
    sourceId: { type: "string", nullable: true },
    regulationRef: { type: "string", nullable: true },
    title: { type: "string" },
    url: { type: "string", nullable: true },
    enactedOn: { type: "string", nullable: true, format: "date" },
    relevance: { type: "string", enum: ["flagged", "noted", "baseline", "clear"] },
    reasoning: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "checkRunId", "customerId", "title", "relevance", "createdAt"],
} as const;

const findingActionSchema = {
  type: "object",
  description: "The mutable human-workflow row for a finding; null until the first transition. See lib/workflow/actions.ts for why this is a separate table from `finding`.",
  properties: {
    id: { type: "string" },
    findingId: { type: "string" },
    customerId: { type: "string" },
    state: actionStateSchema,
    assignee: { type: "string", nullable: true },
    forwardedTo: { type: "string", nullable: true, description: "Broker, supplier, or internal recipient the finding was forwarded to." },
    dueAt: { type: "string", nullable: true, format: "date-time" },
    brokerDecision: { type: "string", nullable: true, description: "The broker's or advisor's answer, recorded verbatim." },
    brokerDecidedAt: { type: "string", nullable: true, format: "date-time" },
    note: { type: "string", nullable: true },
    closedAt: { type: "string", nullable: true, format: "date-time" },
  },
  required: ["id", "findingId", "customerId", "state"],
} as const;

const impactAssessmentSchema = {
  type: "object",
  description: "One product/lane impact estimate for this finding. See lib/impact/assess.ts AssessmentDraft.",
  properties: {
    productId: { type: "string", nullable: true },
    laneId: { type: "string", nullable: true },
    matchKind: { type: "string", enum: ["exact_code", "code_prefix", "material", "origin", "destination", "catalogue_wide"] },
    matchReason: { type: "string" },
    effectiveOn: { type: "string", nullable: true, format: "date" },
    nextAffectedShipmentAt: { type: "string", nullable: true, format: "date-time" },
    dutyRateBefore: { type: "number", nullable: true, description: "Fraction, e.g. 0.05 = 5%." },
    dutyRateAfter: { type: "number", nullable: true },
    estimatedAnnualExposure: { type: "number", nullable: true },
    estimatedMonthlyExposure: { type: "number", nullable: true },
    currency: { type: "string" },
    delayRisk: { type: "string" },
    basis: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["verified", "estimated", "indicative"] },
    annualDutyAtRisk: { type: "number", nullable: true },
    tariffCode: { type: "string", nullable: true },
    tariffBasis: { type: "string", nullable: true },
  },
  required: ["matchKind", "matchReason", "currency", "delayRisk", "basis", "confidence"],
} as const;

const actionDraftsSchema = {
  type: "object",
  description: "Three pre-written communication drafts for this finding. See lib/workflow/draft.ts GeneratedActionDrafts.",
  properties: {
    brokerDraft: {
      type: "object",
      properties: {
        recipient: { type: "string" },
        channel: { type: "string", enum: ["whatsapp", "email"] },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["recipient", "channel", "body"],
    },
    internalOpsDraft: {
      type: "object",
      properties: {
        title: { type: "string" },
        checklist: { type: "array", items: { type: "string" } },
        body: { type: "string" },
      },
      required: ["title", "checklist", "body"],
    },
    supplierDraft: {
      type: "object",
      properties: {
        recipient: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["recipient", "subject", "body"],
    },
  },
  required: ["brokerDraft", "internalOpsDraft", "supplierDraft"],
} as const;

const queueItemSchema = {
  type: "object",
  properties: {
    finding: findingSchema,
    action: { ...findingActionSchema, nullable: true },
    state: actionStateSchema,
    overdue: { type: "boolean", description: "True if dueAt has passed and the item is not in a terminal state." },
    impact: { type: "array", items: impactAssessmentSchema },
    drafts: actionDraftsSchema,
  },
  required: ["finding", "action", "state", "overdue", "impact", "drafts"],
} as const;

const summarySchema = {
  type: "object",
  description: "Count of queue items per state, keyed by ActionState. Always carries every state, zero-filled.",
  properties: Object.fromEntries(STATES_LIST.map((s) => [s, { type: "integer" }])),
  required: [...STATES_LIST],
} as const;

const errorResponseSchema = { type: "object", properties: { error: { type: "string" } }, required: ["error"] } as const;

export function buildWorkQueueOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Work Queue API",
      version: "1.0.0",
      description:
        "The action workflow (transition state machine) joined to impact estimates and " +
        "pre-written communication drafts for each flagged/noted finding. GET lists the " +
        "queue for a customer; POST either records an impact assessment (action: 'assess') " +
        "or transitions a finding's workflow state.",
    },
    paths: {
      "/api/workqueue": {
        get: {
          summary: "List the work queue for a customer.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Defaults to the workspace's default customer if omitted." },
            { name: "country", in: "query", required: false, schema: { type: "string" }, description: "Jurisdiction name used to pick the right draft language/format." },
            { name: "includeResolved", in: "query", required: false, schema: { type: "string", enum: ["true", "false"] }, description: "Include irrelevant/closed items. Any other value is rejected with 400 so a typo never silently hides resolved tasks." },
          ],
          responses: {
            "200": {
              description: "Queue and per-state summary for the resolved customer (empty queue/summary if no customer resolves).",
              content: { "application/json": { schema: { type: "object", properties: { queue: { type: "array", items: queueItemSchema }, summary: summarySchema }, required: ["queue", "summary"] } } },
            },
            "400": { description: "Invalid includeResolved value.", content: { "application/json": { schema: errorResponseSchema } } },
          },
        },
        post: {
          summary: "Record an impact assessment, or transition a finding's workflow state.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Assess mode: store a fresh impact estimate for this finding.",
                      properties: {
                        customerId: { type: "string" },
                        findingId: { type: "string" },
                        action: { type: "string", enum: ["assess"] },
                        effectiveOn: { type: "string", format: "date", nullable: true },
                        duty: { type: "object", nullable: true, properties: { before: { type: "number", nullable: true }, after: { type: "number", nullable: true } } },
                      },
                      required: ["findingId", "action"],
                    },
                    {
                      type: "object",
                      description: "Transition mode: move a finding to a new workflow state.",
                      properties: {
                        customerId: { type: "string" },
                        findingId: { type: "string" },
                        state: actionStateSchema,
                        assignee: { type: "string", nullable: true },
                        forwardedTo: { type: "string", nullable: true },
                        dueAt: { type: "string", nullable: true, format: "date-time" },
                        brokerDecision: { type: "string", nullable: true },
                        note: { type: "string", nullable: true },
                        reopen: { type: "boolean", description: "Required to leave a terminal state (irrelevant/closed)." },
                      },
                      required: ["findingId", "state"],
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Assess mode returns { impact }; transition mode returns { action }.",
              content: { "application/json": { schema: { type: "object", properties: { impact: { type: "array", items: impactAssessmentSchema }, action: findingActionSchema } } } },
            },
            "400": {
              description:
                "Malformed body, missing findingId, no customer could be resolved, or (transition mode) a WorkflowError: unknown `state` value, finding not found, finding belongs to a different customer, a required field missing for the target state (assignee/forwardedTo/note), or leaving a terminal state without `reopen: true`. WorkflowError always reports status 400 and its message lists valid next states/fields so an agent can self-correct without reading source.",
              content: { "application/json": { schema: errorResponseSchema } },
            },
            "403": { description: "Assess mode only: the finding belongs to a different customer.", content: { "application/json": { schema: errorResponseSchema } } },
            "404": { description: "Assess mode only: finding not found.", content: { "application/json": { schema: errorResponseSchema } } },
            "500": { description: "Transition mode: an unexpected (non-WorkflowError) failure updating the finding.", content: { "application/json": { schema: errorResponseSchema } } },
          },
        },
      },
    },
  };
}
