import assert from "node:assert/strict";
import test from "node:test";
import { classifyDirection, detectRegulationLinks } from "@/lib/checks/lifecycle";

test("Indonesian amendment language links a rule to its parent", () => {
  // The real case: Permendag 12/2026 is the fifth amendment to 23/2023, and
  // nothing in the monitor connected them.
  const links = detectRegulationLinks(
    "Peraturan Menteri Perdagangan Nomor 12 Tahun 2026 tentang Perubahan Kelima atas Peraturan Menteri Perdagangan Nomor 23 Tahun 2023 tentang Kebijakan dan Pengaturan Ekspor.",
  );
  const amends = links.find((l) => l.relation === "amends");
  assert.ok(amends, "should detect the amendment relationship");
  assert.match(amends.targetRef, /23 Tahun 2023/);
  assert.match(amends.evidence, /Perubahan Kelima/);
});

test("revocation and supersession are distinguished from amendment", () => {
  const revokes = detectRegulationLinks(
    "Peraturan ini mencabut Peraturan Menteri Perdagangan Nomor 18 Tahun 2021 tentang ekspor.",
  );
  assert.equal(revokes[0]?.relation, "revokes");
  assert.match(revokes[0].targetRef, /18 Tahun 2021/);

  const supersedes = detectRegulationLinks("Ketentuan ini menggantikan Permendag 5 Tahun 2020.");
  assert.equal(supersedes[0]?.relation, "supersedes");
});

test("title capitalisation does not hide an amendment", () => {
  // Titles capitalise what prose does not. Matching only "Perubahan atas" found
  // 1 link across 23 live Kemenperin regulations; 8 were amendments or
  // revocations written "Perubahan Atas" and "Pencabutan".
  const links = detectRegulationLinks(
    "Peraturan Menteri Perindustrian Nomor 4 Tahun 2026 tentang Perubahan Atas Peraturan Menteri Perindustrian Nomor 2 Tahun 2025.",
  );
  assert.equal(links[0]?.relation, "amends");
  assert.match(links[0].targetRef, /2 Tahun 2025/);
});

test("a revocation written as a title noun, even in capitals, is still a revocation", () => {
  const noun = detectRegulationLinks(
    "Peraturan Menteri Perindustrian Nomor 9 Tahun 2026 tentang Pencabutan Peraturan Menteri Perindustrian Nomor 27 Tahun 2020.",
  );
  assert.equal(noun[0]?.relation, "revokes");
  assert.match(noun[0].targetRef, /27 Tahun 2020/);

  const shouted = detectRegulationLinks(
    "PENCABUTAN PERATURAN MENTERI PERINDUSTRIAN NOMOR 15 TAHUN 2019 TENTANG STANDAR.",
  );
  assert.equal(shouted[0]?.relation, "revokes", "an all-capitals title is still a revocation");
});

test("US amendment and revocation language is detected too", () => {
  const amends = detectRegulationLinks("Final rule amending 19 CFR 190.51 to clarify drawback claims.");
  assert.equal(amends[0]?.relation, "amends");
  assert.match(amends[0].targetRef, /19 CFR 190\.51/);

  const revokes = detectRegulationLinks("This notice is revoking Executive Order 13873.");
  assert.equal(revokes[0]?.relation, "revokes");
});

test("a rule that changes nothing produces no links", () => {
  assert.deepEqual(
    detectRegulationLinks("Penetapan Harga Patokan Ekspor atas produk pertambangan."),
    [],
  );
  assert.deepEqual(detectRegulationLinks(""), []);
});

test("direction follows the duty delta when there is one", () => {
  assert.equal(classifyDirection({ dutyDelta: 1200 }), "unfavorable");
  assert.equal(classifyDirection({ dutyDelta: -800 }), "favorable");
  assert.equal(classifyDirection({ dutyDelta: 0 }), "neutral");
});

test("direction falls back to language, and stays unknown when ambiguous", () => {
  assert.equal(classifyDirection({ text: "An exclusion is granted for these articles." }), "favorable");
  assert.equal(classifyDirection({ text: "Additional duties are imposed on these goods." }), "unfavorable");
  assert.equal(classifyDirection({ text: "Pembebasan bea masuk untuk bahan baku." }), "favorable");

  // Both signals present is genuinely ambiguous — not a coin flip.
  assert.equal(
    classifyDirection({ text: "Duties are increased for some lines and reduced for others." }),
    "unknown",
  );
  assert.equal(classifyDirection({ text: "A routine administrative notice." }), "unknown");
  assert.equal(classifyDirection({}), "unknown");
});
