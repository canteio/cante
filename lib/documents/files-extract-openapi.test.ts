import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { GET as discover } from "../../app/api/files/extract/openapi/route";
import { POST as extract } from "../../app/api/files/extract/route";
import {
  EXTRACTED_FILE_FORMATS,
  MAX_EXTRACTED_TEXT_CHARS,
} from "./files-extract-contract";
import { buildFilesExtractOpenApiSpec } from "./files-extract-openapi";

const operation: any = buildFilesExtractOpenApiSpec().paths["/api/files/extract"].post;

test("file extraction discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildFilesExtractOpenApiSpec());
  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "400", "500"]);
});

test("discovery imports without customer storage or document parsers", () => {
  const script = [
    "const { GET } = await import('./app/api/files/extract/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/files/extract']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DATA_BACKEND: "sqlite", CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("discovery shares the real format and truncation contract", () => {
  const success = operation.responses["200"].content["application/json"].schema;
  assert.deepEqual(success.properties.format.enum, EXTRACTED_FILE_FORMATS);
  assert.equal(success.properties.text.maxLength, MAX_EXTRACTED_TEXT_CHARS);
});

test("the real route extracts a text file and reports truncation", async () => {
  const form = new FormData();
  form.set("file", new File(["x".repeat(MAX_EXTRACTED_TEXT_CHARS + 1)], "evidence.txt", { type: "text/plain" }));
  const response = await extract(new Request("http://localhost/api/files/extract", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.filename, "evidence.txt");
  assert.equal(payload.format, "text");
  assert.equal(payload.text.length, MAX_EXTRACTED_TEXT_CHARS);
  assert.match(payload.warnings[0], /anything past that point was not read/);
});

test("the real route returns corrective JSON for malformed uploads", async () => {
  const wrongType = await extract(new Request("http://localhost/api/files/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }));
  assert.equal(wrongType.status, 400);
  assert.match((await wrongType.json()).error, /multipart\/form-data/);

  const emptyForm = await extract(new Request("http://localhost/api/files/extract", {
    method: "POST",
    body: new FormData(),
  }));
  assert.equal(emptyForm.status, 400);
  assert.match((await emptyForm.json()).error, /No file was attached/);
});
