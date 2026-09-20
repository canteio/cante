import {
  addMemory,
  deleteMemory,
  getMemory,
  listMemories,
  resolveCustomerId,
  setMemoryConfirmed,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";
import { MEMORY_KINDS } from "@/lib/memories/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  // Arrays and null otherwise reach property access and can turn a caller error into an HTML 500.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ memories: [] });
  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  return Response.json({ jurisdiction, memories: await listMemories(customerId, jurisdiction) });
}

/** POST — add a memory by hand. Anything typed here is confirmed by definition:
 *  a person entered it deliberately. Model-proposed entries come in via the
 *  chat route and land unconfirmed. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => ({}));
  if (!isJsonObject(body)) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return Response.json({ error: "Empty memory." }, { status: 400 });

  const customerId = await resolveCustomerId(
    typeof body.customerId === "string" ? body.customerId : undefined,
  );
  // Same human/agent-fixable-error bar as profiles/checklist/documents/import-monitor:
  // tell the caller exactly what to pass instead of a bare "No customer."
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 404 }
    );
  }

  const kind = MEMORY_KINDS.includes(body.kind as (typeof MEMORY_KINDS)[number])
    ? (body.kind as string)
    : "other";
  const jurisdiction = normalizeJurisdiction(
    typeof body.country === "string" ? body.country : undefined,
  );
  const memory = await addMemory({
    customerId,
    jurisdiction,
    kind,
    content,
    source: typeof body.source === "string" ? body.source : "entered by hand",
    origin: "manual",
    confirmed: true,
  });

  if (!memory) return Response.json({ error: "Already remembered." }, { status: 409 });
  await refreshChecklistForCustomer(customerId, jurisdiction);
  return Response.json({ memory });
}

/** PATCH — confirm or unconfirm a model-proposed memory. */
export async function PATCH(request: Request) {
  const body: unknown = await request.json().catch(() => ({}));
  if (
    !isJsonObject(body) ||
    typeof body.id !== "string" ||
    !body.id.trim() ||
    typeof body.confirmed !== "boolean"
  ) {
    return Response.json(
      { error: "Pass a JSON object with a non-empty string `id` and boolean `confirmed`." },
      { status: 400 },
    );
  }
  // Route-handler error audit (2026-09-17, continuing the checklist/lanes/
  // conversations/profiles sweep): this PATCH had zero try/catch, so a DB
  // failure in setMemoryConfirmed/refreshChecklistForCustomer fell through
  // to Next's generic HTML error page instead of a parseable JSON {error}
  // body — same AI-agent-API-cleanliness fix applied everywhere else in
  // this sweep.
  try {
    await setMemoryConfirmed(body.id, Boolean(body.confirmed));
    const memory = await getMemory(body.id);
    if (memory) {
      await refreshChecklistForCustomer(
        memory.customerId,
        normalizeJurisdiction(memory.jurisdiction),
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update memory." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No id." }, { status: 400 });
  // Same try/catch fix as PATCH above — deleteMemory/refreshChecklistForCustomer
  // failures should surface as JSON, not an HTML error page.
  try {
    const memory = await getMemory(id);
    await deleteMemory(id);
    if (memory) {
      await refreshChecklistForCustomer(
        memory.customerId,
        normalizeJurisdiction(memory.jurisdiction),
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete memory." },
      { status: 500 },
    );
  }
}
