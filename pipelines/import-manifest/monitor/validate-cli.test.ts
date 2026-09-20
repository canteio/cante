import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const command = ["--import", "tsx", "scripts/validate-import-shipments.ts"];

test("imports:validate checks a snapshot without storage or network access", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    ...command,
    "pipelines/import-manifest/fixtures/sample-export.json",
  ], { cwd: process.cwd() });
  assert.deepEqual(JSON.parse(stdout), {
    valid: true,
    observedAt: "2026-09-14T00:00:00.000Z",
    shipmentCount: 1,
    sample: true,
  });
});

test("imports:validate exits nonzero with the contract error for a bad snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cante-import-validate-"));
  const file = join(dir, "bad.json");
  try {
    await writeFile(file, JSON.stringify({ sourceType: "authorized_export", shipments: [] }));
    await assert.rejects(
      execFileAsync(process.execPath, [...command, file], { cwd: process.cwd() }),
      error => {
        const failure = error as Error & { code?: number; stderr?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /sourceRef|observedAt/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
