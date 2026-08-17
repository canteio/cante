import {
  CslUpstreamError,
  ScreeningInputError,
  screenExactNames,
} from "@/lib/screening/csl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }

  try {
    return Response.json(await screenExactNames(body), { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof ScreeningInputError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    if (error instanceof CslUpstreamError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    return Response.json(
      { error: "Screening failed." },
      { status: 500, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
}
