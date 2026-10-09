import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/documents/openapi/route";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { DOCUMENTS_ACTIONS, DOCUMENT_TYPES } from "./contract";
import { buildDocumentsOpenApiSpec } from "./openapi";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/documents/route");
let customerId: string;

beforeEach(async () => {
  // Import the real handler only after selecting throwaway storage. db/client
  // binds its path once, and must never fall through to the user's ledger.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/documents/route");
});

const contract = buildDocumentsOpenApiSpec().paths["/api/documents"];
function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("documents discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildDocumentsOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post"]);
});

test("discovery imports and runs when the configured database path is unusable", () => {
  const script = [
    "const imported = await import(\'./app/api/documents/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/documents']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("discovery and route validation share document actions and types", () => {
  const body: any = contract.post.requestBody.content["application/json"].schema;
  assert.deepEqual(body.oneOf.map((shape: any) => shape.properties.action.const), DOCUMENTS_ACTIONS);
  assert.deepEqual(body.oneOf[0].properties.docType.enum, DOCUMENT_TYPES);
  const multipart: any = contract.post.requestBody.content["multipart/form-data"].schema;
  assert.deepEqual(multipart.properties.docType.enum, DOCUMENT_TYPES);
});

test("real ingest, list, and detail responses match the documented contract", async () => {
  const ingest = await route.POST(jsonRequest({
    customerId,
    action: "ingest",
    docType: "commercial_invoice",
    filename: "invoice.txt",
    text: "Invoice Number: INV-42\nItem 6306.12.00 origin: Mexico 4 pcs USD 120.00",
  }));
  assert.equal(ingest.status, 200);
  const created = await ingest.json();
  // The hosted "ingest" action files the raw text via fileAttachments() ->
  // fileCloudDocument(), NOT the full audit.ts parser (ingestDocument()) —
  // that's intentional, per lib/chat/attachments.ts's own documented design:
  // "customs-grade document auditing still runs in the local worker." So
  // documentNumber/parseStatus here reflect an unparsed filing, not a parsed
  // one; asserting parsed header fields would assert behavior this action
  // was never meant to provide.
  assert.equal(created.document.documentNumber, null);
  assert.equal(created.document.parseStatus, "partial");
  assert.deepEqual(Object.keys(created).sort(), ["caveats", "document", "findings"]);

  const list = await route.GET(new Request(`http://localhost/api/documents?customerId=${customerId}`));
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.equal(listed.documents.length, 1);
  assert.equal(listed.documents[0].id, created.document.id);

  const detail = await route.GET(new Request(`http://localhost/api/documents?customerId=${customerId}&documentId=${created.document.id}`));
  assert.equal(detail.status, 200);
  const detailed = await detail.json();
  assert.equal(detailed.document.id, created.document.id);
  assert.deepEqual(detailed.findings, created.findings);

  const audit = await route.POST(jsonRequest({ customerId, action: "audit", documentId: created.document.id }));
  assert.equal(audit.status, 409);
  assert.match((await audit.json()).error, /trusted worker/);

  const promote = await route.POST(jsonRequest({ customerId, action: "promote", documentId: created.document.id }));
  assert.equal(promote.status, 409);
  assert.match((await promote.json()).error, /trusted worker/);
});

test("primitive JSON gets a documented corrective 400 before storage lookup", async () => {
  for (const body of [null, [], "document"]) {
    const response = await route.POST(jsonRequest(body));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /JSON object/);
    assert.deepEqual(payload.validActions, DOCUMENTS_ACTIONS);
  }
});

test("unknown actions are deferred to the trusted worker, same as any real non-ingest action", async () => {
  const response = await route.POST(jsonRequest({ customerId, action: "guess" }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /trusted worker/);
});
