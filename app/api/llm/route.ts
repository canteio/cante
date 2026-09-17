import { cookies } from "next/headers";
import {
  getProvider,
  normalizeProviderChoice,
  PROVIDER_COOKIE,
  PROVIDER_OPTIONS,
} from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const locked = process.env.CANTE_LLM_LOCKED === "true";
  const selected = normalizeProviderChoice(
    locked ? process.env.CANTE_LLM : (await cookies()).get(PROVIDER_COOKIE)?.value,
  );
  if (locked) {
    const option = PROVIDER_OPTIONS.find((item) => item.id === selected)!;
    return Response.json({
      selected,
      locked: true,
      providers: [{ ...option, selected: true, ...(await getProvider(selected).available()) }],
    });
  }
  const providers = await Promise.all(
    PROVIDER_OPTIONS.map(async (option) => {
      const provider = getProvider(option.id);
      return {
        ...option,
        selected: option.id === selected,
        ...(await provider.available()),
      };
    }),
  );

  return Response.json({ selected, providers });
}

export async function POST(request: Request) {
  // Wrapped in try/catch so a thrown error (e.g. a provider health-check
  // network failure) returns clean JSON instead of falling through to
  // Next's default HTML error page, which breaks API clients/agents that
  // expect JSON from every response on this route (same fix already
  // applied across the other POST/PUT/DELETE handlers in this sweep).
  try {
    if (process.env.CANTE_LLM_LOCKED === "true") {
      return Response.json(
        { error: "The production AI provider is fixed by server configuration." },
        { status: 409 },
      );
    }
    // `request.json()` happily parses a top-level "null"/"[]"/"42" JSON body
    // without throwing, so `body.provider` below would previously throw a
    // TypeError caught by the outer catch and surfaced as an undifferentiated
    // 500 — indistinguishable from a real server error to a calling agent.
    // Reject any non-plain-object body up front with a 400 that documents
    // the expected shape, matching the same contract already applied to
    // POST /api/workqueue.
    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object, e.g. { \"provider\": \"claude-code\" }." },
        { status: 400 },
      );
    }
    const selected = normalizeProviderChoice(body.provider);
    const provider = getProvider(selected);
    const health = await provider.available();

    if (!health.ok) {
      return Response.json({ selected, health }, { status: 409 });
    }

    (await cookies()).set(PROVIDER_COOKIE, selected, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    return Response.json({
      selected,
      provider: PROVIDER_OPTIONS.find((option) => option.id === selected),
      health,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
