import { NextRequest, NextResponse } from "next/server";
import { hashWaitlistIp, joinWaitlist, parseWaitlistRequest } from "@/lib/waitlist";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

class RequestBodyTooLargeError extends Error {}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ message: "Request body is too large." }, { status: 413 });
    }
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }

  if (
    body &&
    typeof body === "object" &&
    "website" in body &&
    typeof body.website === "string" &&
    body.website.length > 0
  ) {
    return NextResponse.json({ message: "You're on the list. We'll be in touch." });
  }

  const parsed = parseWaitlistRequest(body);
  if (!parsed) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }

  const salt = process.env.WAITLIST_HASH_SALT;
  if (!salt) {
    console.error("WAITLIST_HASH_SALT is not configured");
    return NextResponse.json({ message: "The waitlist is not available yet." }, { status: 503 });
  }

  const result = await joinWaitlist(
    parsed.email,
    hashWaitlistIp(clientIp(request), salt),
    request.headers.get("user-agent") || "unknown",
  );

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  return NextResponse.json({ message: "You're on the list. We'll be in touch." });
}
