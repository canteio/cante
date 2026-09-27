import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { GET as discover } from "../../app/api/conversations/openapi/route";
import { buildConversationsOpenApiSpec } from "./openapi";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/conversations/route");
let database: typeof import("../db/client");

before(async () => {
  route = await import("../../app/api/conversations/route");
  database = await import("../db/client");
  database.db.$client.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL,
      city TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, jurisdiction TEXT NOT NULL,
      title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, activity TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO customers VALUES ('customer-1', 'Acme', 'United States', NULL, '2026-09-19T00:00:00Z');
    INSERT INTO conversations VALUES ('conversation-1', 'customer-1', 'United States', 'Import question', '2026-09-19T00:00:00Z', '2026-09-19T01:00:00Z');
    INSERT INTO chat_messages VALUES ('message-1', 'conversation-1', 'user', 'Is this legal?', '[]', '2026-09-19T00:01:00Z');
  `);
});

after(() => database.db.$client.close());

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
    env: { ...process.env, CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the real GET route returns the documented list and detail shapes", async () => {
  const listResponse = await route.GET(new Request("http://localhost/api/conversations?customerId=customer-1&country=US"));
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.jurisdiction, "United States");
  assert.deepEqual(list.conversations.map((item: { id: string }) => item.id), ["conversation-1"]);

  const detailResponse = await route.GET(new Request("http://localhost/api/conversations?id=conversation-1"));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.conversation.id, "conversation-1");
  assert.deepEqual(detail.messages.map((item: { id: string }) => item.id), ["message-1"]);

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
