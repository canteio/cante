import assert from "node:assert/strict";
import test from "node:test";
import { resetTariffCacheForTests } from "@/lib/tariff/rates";
import { POST } from "@/app/api/tariff/stack/bulk/route";

function stubFetch(rows: unknown[], status = 200) {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => rows,
  })) as unknown as typeof global.fetch;
  return () => {
    global.fetch = original;
  };
}

function csvRequest(body: string) {
  return new Request("https://cante.test/api/tariff/stack/bulk", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body,
  });
}

test.beforeEach(() => {
  resetTariffCacheForTests();
});

test("rejects an empty upload", async () => {
  const response = await POST(csvRequest("   \n"));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /country_of_origin/);
});

test("rejects a file with no usable rows and reports exactly why", async () => {
  const response = await POST(csvRequest("sku,description\nABC,widget\n"));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.rowErrors.length, 1);
});

test("computes every row independently and reports per-row status", async () => {
  const restore = stubFetch([
    { htsno: "8544.42.90.00", general: "2.6%", additionalDuties: "See 9903.88.03" },
    { htsno: "0101.21.00.10", general: "Free" },
  ]);
  try {
    const csv = "hts_code,country_of_origin,value\n8544.42.90.00,CN,10000\n0101.21.00.10,MX,5000\n";
    const response = await POST(csvRequest(csv));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.processedCount, 2);
    assert.equal(data.rows.length, 2);

    const first = data.rows[0];
    assert.equal(first.result.components.length, 2);
    assert.equal(first.result.totalRatePercent, 0.276);

    const second = data.rows[1];
    assert.equal(second.result.totalRatePercent, 0);
  } finally {
    restore();
  }
});

test("a row with no published HTS match reports its own error without failing the whole batch", async () => {
  const restore = stubFetch([{ htsno: "9999.99.99.99", general: "Free" }]);
  try {
    const csv = "hts_code,country_of_origin\n0000.00.00.00,CN\n";
    const response = await POST(csvRequest(csv));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.rows[0].result, null);
    assert.match(data.rows[0].error, /No published HTS row/);
  } finally {
    restore();
  }
});

test("rejects an upload over the body size limit via Content-Length", async () => {
  const request = new Request("https://cante.test/api/tariff/stack/bulk", {
    method: "POST",
    headers: { "Content-Type": "text/csv", "Content-Length": String(3 * 1024 * 1024) },
    body: "hts_code,country_of_origin\n1234.56.78.90,CN\n",
  });
  const response = await POST(request);
  assert.equal(response.status, 413);
});

test("rejects an oversized body even without a usable Content-Length header, by actually reading the stream", async () => {
  // Node's fetch Request recomputes Content-Length from the real body, so to
  // exercise the streamed-enforcement path (not just the header short-circuit)
  // this builds the request from a ReadableStream directly — the one shape
  // where Content-Length is genuinely absent, same as a real chunked upload.
  const oversized = "hts_code,country_of_origin\n" + "1234.56.78.90,CN\n".repeat(200_000); // well over 2 MiB
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversized));
      controller.close();
    },
  });
  const request = new Request("https://cante.test/api/tariff/stack/bulk", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    // @ts-expect-error - duplex is required by the Fetch spec for streaming bodies but missing from older lib.dom types
    duplex: "half",
    body: stream,
  });
  assert.equal(request.headers.get("content-length"), null, "test setup must not leak a Content-Length");
  const response = await POST(request);
  assert.equal(response.status, 413);
});
