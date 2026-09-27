import {
  getJurisdictionProfile,
  resolveCustomerId,
  upsertJurisdictionProfile,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";
import { JurisdictionProfileInputSchema, profileShapeDocs } from "@/lib/profiles/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Same silent-failure gap fixed in conversations/customers/import-monitor
  // GET handlers: a DB error here previously bubbled up as Next's generic
  // HTML error page instead of JSON, which is unreadable for an API caller
  // (human or agent). Wrap both DB calls so failures come back as {error}.
  try {
    const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
    if (!customerId) return Response.json({ profile: null });
    const country = normalizeJurisdiction(url.searchParams.get("country"));
    return Response.json({ country, profile: await getJurisdictionProfile(customerId, country) });
  } catch {
    return Response.json({ error: "Failed to load jurisdiction profile." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body: unknown = await request.json().catch(() => ({}));
  // A primitive JSON body cannot carry customer, country, or profile fields.
  // Return a corrective client error instead of misreporting property access as storage failure.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must be a JSON object with a `profile` object.", shape: profileShapeDocs },
      { status: 400 },
    );
  }
  const input = body as Record<string, unknown>;
  // Last unguarded mutating route in the POST/PUT/DELETE/PATCH sweep (see
  // route.ts sweep across llm/, substances/, conversations/, customers/,
  // import-monitor/): resolveCustomerId/upsertJurisdictionProfile/
  // refreshChecklistForCustomer all hit the DB and previously had zero
  // try/catch here, so any DB error (bad connection, FK violation, etc.)
  // fell through to Next's generic HTML error page instead of JSON —
  // unreadable for an API client or an agent parsing the response.
  try {
    const customerId = await resolveCustomerId(
      typeof input.customerId === "string" ? input.customerId : undefined,
    );
    // "No customer." gave a caller nothing to act on; spell out the fix inline
    // (same human/agent-fixable-error bar as the import-monitor query params)
    // rather than making the caller go read resolveCustomerId's source.
    if (!customerId) {
      return Response.json(
        { error: "No customer could be resolved. Pass a valid `customerId` in the request body, or omit it to use the default customer if one exists." },
        { status: 404 },
      );
    }
    const country = normalizeJurisdiction(input.country);
    const parsed = JurisdictionProfileInputSchema.safeParse(input.profile);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten(), shape: profileShapeDocs }, { status: 400 });
    }
    const profile = await upsertJurisdictionProfile(customerId, country, parsed.data);
    await refreshChecklistForCustomer(customerId, country);
    return Response.json({ country, profile });
  } catch {
    return Response.json({ error: "Failed to save jurisdiction profile." }, { status: 500 });
  }
}
