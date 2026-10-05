import { createServiceClient } from "@/lib/supabase/service";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/conversations/openapi/route";
import { buildConversationsOpenApiSpec } from "./openapi";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/conversations/route");
let customerId: string;
let conversationId: string;
let messageId: string;

beforeEach(async () => {
  route = await import("../../app/api/conversations/route");
  ({ customerId } = await operatingDb());
  conversationId = `conversation-${customerId}`;
  messageId = `message-${customerId}`;
  const client = createServiceClient();
  const conversation = await client.from("conversations").insert({
    id: conversationId, customer_id: customerId, jurisdiction: "United States", title: "Import question",
  });
  assert.ifError(conversation.error);
  const message = await client.from("chat_messages").insert({
    id: messageId, conversation_id: conversationId, role: "user", content: "Is this legal?",
  });
  assert.ifError(message.error);
});


const contract: any = buildConversationsOpenApiSpec().paths["/api/conversations"];

test("conversation discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildConversationsOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "delete"]);
});

test("conversation discovery imports without initializing storage", () => {
  const script = [
    "const { GET } = await import('./app/api/conversations/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/conversations']?.get || !spec.paths?.['/api/conversations']?.delete) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the real GET route returns the documented list and detail shapes", async () => {
  const listResponse = await route.GET(new Request(`http://localhost/api/conversations?customerId=${customerId}&country=US`));
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.jurisdiction, "United States");
  assert.deepEqual(list.conversations.map((item: { id: string }) => item.id), [conversationId]);

  const detailResponse = await route.GET(new Request(`http://localhost/api/conversations?id=${conversationId}`));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.conversation.id, conversationId);
  assert.deepEqual(detail.messages.map((item: { id: string }) => item.id), [messageId]);

  const success = contract.get.responses["200"].content["application/json"].schema.oneOf;
  assert.deepEqual(success[1].required, ["conversations"]);
  assert.deepEqual(success[0].required, Object.keys(detail));
});

test("the real routes return documented corrective errors", async () => {
  const missing = await route.GET(new Request("http://localhost/api/conversations?id=missing"));
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /call GET \/api\/conversations/);

  const noId = await route.DELETE(new Request("http://localhost/api/conversations", { method: "DELETE" }));
  assert.equal(noId.status, 400);
  assert.match((await noId.json()).error, /Missing `id` query parameter/);
  assert.deepEqual(Object.keys(contract.get.responses["404"].content["application/json"].schema.properties), ["error"]);
  assert.deepEqual(Object.keys(contract.delete.responses["400"].content["application/json"].schema.properties), ["error"]);
});
