import assert from "node:assert/strict";
import test from "node:test";
import { renderBriefings, type BriefedFinding } from "@/lib/checks/briefing";

/**
 * "PP 20/2026 — worth a look" makes the reader do all the work. These pin the
 * shape that replaced it, and the honesty rules that keep it from becoming a
 * confident invention.
 */

function briefed(overrides: Partial<BriefedFinding> = {}): BriefedFinding {
  return {
    regulationRef: "PP 20 Tahun 2026",
    title: "Perubahan atas PP 55 Tahun 2022",
    url: "https://example.go.id/1",
    amends: "Peraturan Pemerintah Nomor 55 Tahun 2022",
    relation: "amends",
    briefing: {
      whatItIs: "Mengatur tarif PPh final 0,5% untuk UMKM.",
      changes: [
        { topic: "Orang pribadi", before: "maksimal 7 tahun", after: "tanpa batas waktu" },
        { topic: "PT biasa & CV", before: "boleh pakai", after: "tidak boleh lagi" },
      ],
      affectsCustomer: "Cek bentuk badan usaha MA dulu.",
      sourcesRead: ["https://example.go.id/1"],
      confidence: "sourced",
    },
    ...overrides,
  };
}

test("the rendered block is a scannable before → after list, not prose", () => {
  const out = renderBriefings([briefed()], "id");
  assert.match(out, /Rincian perubahan/);
  assert.match(out, /mengubah Peraturan Pemerintah Nomor 55 Tahun 2022/);
  assert.match(out, /• Orang pribadi: maksimal 7 tahun → tanpa batas waktu/);
  assert.match(out, /• PT biasa & CV: boleh pakai → tidak boleh lagi/);
  assert.match(out, /Buat kamu:/);
});

test("a partial comparison warns next to the table, not in a distant footnote", () => {
  // A reader who sees a confident before/after must learn it may be incomplete
  // at the moment they read it, not three sections later.
  const out = renderBriefings([briefed({
    briefing: { ...briefed().briefing, confidence: "partial" },
  })], "id");
  assert.match(out, /belum tentu utuh/);
  const warnIndex = out.indexOf("belum tentu utuh");
  const tableIndex = out.indexOf("Orang pribadi");
  assert.ok(warnIndex > tableIndex, "the warning sits with the comparison it qualifies");
});

test("a fully sourced comparison carries no warning", () => {
  const out = renderBriefings([briefed()], "id");
  assert.ok(!out.includes("belum tentu utuh"));
});

test("when no differences could be read, it says so instead of showing an empty table", () => {
  const out = renderBriefings([briefed({
    briefing: { ...briefed().briefing, changes: [], confidence: "partial" },
  })], "id");
  assert.match(out, /belum bisa dibaca dari dokumen resmi/);
  assert.ok(!out.includes("→"), "no arrows without differences behind them");
});

test("nothing to brief renders nothing at all", () => {
  assert.equal(renderBriefings([], "id"), "");
});

test("English rendering is used for the US jurisdiction", () => {
  const out = renderBriefings([briefed()], "en");
  assert.match(out, /What changed/);
  assert.match(out, /For you:/);
});
