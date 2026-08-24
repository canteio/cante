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
  if (process.env.CANTE_LLM_LOCKED === "true") {
    return Response.json(
      { error: "The production AI provider is fixed by server configuration." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({}));
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
}
