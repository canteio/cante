import assert from "node:assert/strict";
import test from "node:test";
import { readSupplierPostResponse } from "./post-response";

test("supplier POST responses preserve valid JSON payloads and API errors", async () => {
  const success = new Response(JSON.stringify({ row: { outcome: "clear" }, clear: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await readSupplierPostResponse(success), {
    row: { outcome: "clear" },
    clear: true,
  });

  const failure = new Response(JSON.stringify({ error: "Supplier does not exist." }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(readSupplierPostResponse(failure), /Supplier does not exist\./);
});

test("supplier POST responses turn malformed bodies into actionable errors", async () => {
  const malformedSuccess = new Response("<html>not json</html>", { status: 200 });
  await assert.rejects(
    readSupplierPostResponse(malformedSuccess),
    /Supplier service returned an invalid response\. Try again\./,
  );

  const malformedFailure = new Response("Bad gateway", { status: 502 });
  await assert.rejects(
    readSupplierPostResponse(malformedFailure),
    /Supplier request failed \(status 502\)\./,
  );
});
