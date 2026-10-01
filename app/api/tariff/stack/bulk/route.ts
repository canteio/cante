import { parseStackRequestRows, MAX_BULK_ROWS, type StackRequestRow } from "@/lib/tariff/bulk";
import { computeStackedDuty, type StackedDutyResult } from "@/lib/tariff/stack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bulk tariff-stacking — the spreadsheet-upload workflow Kate Chang (Toro)
 * described: a CSV/XLSX-exported-as-CSV with HTS codes and countries of
 * origin in, a per-row stacked rate and plain-English derivation out.
 *
 * `POST /api/tariff/stack/bulk` with `Content-Type: text/csv` (or
 * `text/plain`) and the file body. One request processes at most
 * MAX_BULK_ROWS rows and looks them up with bounded concurrency so a large
 * file cannot hammer the USITC endpoint or hang the request.
 */
const CONCURRENCY = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB — generous for a few thousand rows, bounded regardless.

class RequestBodyTooLargeError extends Error {}

/**
 * Reads the request body as a stream and aborts the moment it exceeds
 * MAX_BODY_BYTES, instead of buffering the whole thing first and checking
 * after. Content-Length is attacker-controlled (chunked transfer or a
 * false/omitted header defeats a header-only check), so this is the actual
 * enforcement; the Content-Length check below is only a cheap early exit.
 */
async function readBoundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_BODY_BYTES) {
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
  return new TextDecoder("utf-8").decode(body);
}

export interface BulkStackRowResult {
  rowNumber: number;
  input: Pick<StackRequestRow, "htsCode" | "countryOfOrigin">;
  result: StackedDutyResult | null;
  error: string | null;
}

async function runBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: `File exceeds the ${MAX_BODY_BYTES / (1024 * 1024)} MiB upload limit.` }, { status: 413 });
  }

  const text = await readBoundedText(request).catch((error) => {
    if (error instanceof RequestBodyTooLargeError) return null;
    throw error;
  });
  if (text === null) {
    return Response.json({ error: `File exceeds the ${MAX_BODY_BYTES / (1024 * 1024)} MiB upload limit.` }, { status: 413 });
  }
  if (!text.trim()) {
    return Response.json({ error: "Upload a CSV with hts_code and country_of_origin columns." }, { status: 400 });
  }

  const { rows, errors } = parseStackRequestRows(text);
  if (rows.length === 0) {
    return Response.json(
      { error: "No usable rows were found.", rowErrors: errors },
      { status: 400 },
    );
  }

  const rowResults = await runBounded<StackRequestRow, BulkStackRowResult>(rows, CONCURRENCY, async (row) => {
    try {
      const result = await computeStackedDuty({
        htsCode: row.htsCode,
        countryOfOrigin: row.countryOfOrigin,
        value: row.value,
        quantity: row.quantity,
        unit: row.unit,
        claimedProgramme: row.claimedProgramme,
      });
      return {
        rowNumber: row.rowNumber,
        input: { htsCode: row.htsCode, countryOfOrigin: row.countryOfOrigin },
        result,
        error: result ? null : `No published HTS row matched ${row.htsCode}.`,
      };
    } catch (error) {
      return {
        rowNumber: row.rowNumber,
        input: { htsCode: row.htsCode, countryOfOrigin: row.countryOfOrigin },
        result: null,
        error: error instanceof Error ? error.message : "Tariff stacking lookup failed.",
      };
    }
  });

  return Response.json({
    rows: rowResults,
    rowErrors: errors,
    processedCount: rows.length,
    maxRows: MAX_BULK_ROWS,
  });
}
