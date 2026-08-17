import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";
import type { LlmProvider } from "@/lib/llm/types";
import type { Suggestion } from "@/lib/classification/suggest";

before(async () => {
  await operatingDb();
});

/** A provider that returns exactly what the test wants, with no model call. */
function stubProvider(payload: Partial<Suggestion>): LlmProvider {
  const full: Suggestion = {
    noSuitableCandidate: false,
    recommendedCode: "6306.12.00.00",
    confidence: "medium",
    griApplied: "GRI 1",
    rationale: "Heading 6306 covers tarpaulins of synthetic fibres.",
    alternatives: [{ code: "3921.90.11.00", whyNotChosen: "Coated plastic sheet, not a made-up article." }],
    uncertainties: ["Weight per square metre was not supplied."],
    needsExpertReview: false,
    ...payload,
  };
  return {
    name: "stub",
    available: async () => ({ ok: true, detail: "stub" }),
    complete: async () => ({ text: JSON.stringify(full), durationMs: 1 }),
  } as unknown as LlmProvider;
}

const CANDIDATES = [
  { code: "6306.12.00.00", description: "Tarpaulins of synthetic fibers", generalRate: "8.8%", units: ["kg"] },
  { code: "3921.90.11.00", description: "Plates, sheets of plastics", generalRate: "4.2%", units: ["kg"] },
];

/** Replace network lookups so the guardrail is tested, not the HTS service. */
async function withStubbedSearch<T>(fn: () => Promise<T>): Promise<T> {
  const mod = await import("@/lib/classification/suggest");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("hts.usitc.gov/reststop/search")) {
      return new Response(
        JSON.stringify(
          CANDIDATES.map((c) => ({
            htsno: c.code,
            description: c.description,
            general: c.generalRate,
            units: c.units,
          })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (href.includes("rulings.cbp.gov")) {
      return new Response(JSON.stringify({ rulings: [{ rulingNumber: "N123456", subject: "Tarpaulin" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    void mod;
  }
}

async function seed(customerId: string) {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { product } = upsertProduct(customerId, {
    sku: "SUG-1",
    name: "PVC coated tarpaulin",
    description: "Woven polyester scrim with PVC coating, made up with eyelets",
    materials: ["PVC", "polyester"],
  });
  return product;
}

test("search terms prefer specific phrases and drop noise words", async () => {
  const { searchTermsFor } = await import("@/lib/classification/suggest");
  const terms = searchTermsFor({
    name: "Blue heavy tarpaulin",
    description: "PVC coated polyester",
    materials: [],
  });
  assert.ok(!terms.some((t) => t === "blue" || t === "heavy"), "stopwords should not survive alone");
  assert.ok(terms.some((t) => t.includes("tarpaulin")));
});

test("a suggestion is recorded as a lead and cannot be approved", async () => {
  const { customerId } = await operatingDb();
  const product = await seed(customerId);
  const suggest = await import("@/lib/classification/suggest");
  const { approveClassification, ClassificationApprovalError, resolveProductCodes } = await import(
    "@/lib/catalogue/classifications"
  );

  const result = await withStubbedSearch(() =>
    suggest.suggestClassification(stubProvider({}), { customerId, sku: "SUG-1" }),
  );
  assert.equal(result.suggestion.recommendedCode, "6306.12.00.00");
  assert.match(result.caveats[0], /not a customs ruling/);

  const row = suggest.recordSuggestion(product.id, result);
  assert.equal(row.tier, "lead", "a model suggestion is always a lead");
  assert.equal(row.status, "proposed");
  assert.match(row.basis, /Model suggestion/);
  assert.match(row.rationale ?? "", /GRI 1/);
  assert.match(row.rationale ?? "", /Alternatives considered/);

  // Structurally unapprovable while it is the model's opinion.
  assert.throws(
    () => approveClassification(row.id, "j", "looks right to me"),
    (e: Error) => e instanceof ClassificationApprovalError && /lead-tier/.test(e.message),
  );

  // And it is not the product's current classification.
  assert.equal(resolveProductCodes(product.id, "hts").current, null);
});

test("a code outside the candidate set is rejected, not recorded", async () => {
  const { customerId } = await operatingDb();
  await seed(customerId);
  const suggest = await import("@/lib/classification/suggest");

  await assert.rejects(
    withStubbedSearch(() =>
      // 9999.99 is not among the candidates the model was given.
      suggest.suggestClassification(stubProvider({ recommendedCode: "9999.99.99.99" }), {
        customerId,
        sku: "SUG-1",
      }),
    ),
    (error: Error) =>
      error instanceof suggest.SuggestionError && /not among the .* candidate rows/.test(error.message),
  );
});

test("adopting is a named, reasoned act that unlocks approval", async () => {
  const { customerId } = await operatingDb();
  const product = await seed(customerId);
  const suggest = await import("@/lib/classification/suggest");
  const { approveClassification, resolveProductCodes } = await import(
    "@/lib/catalogue/classifications"
  );

  const result = await withStubbedSearch(() =>
    suggest.suggestClassification(stubProvider({}), { customerId, sku: "SUG-1" }),
  );
  const row = suggest.recordSuggestion(product.id, result);

  assert.throws(
    () => suggest.adoptSuggestion(row.id, "", "because"),
    (e: Error) => /named person/.test(e.message),
  );
  assert.throws(
    () => suggest.adoptSuggestion(row.id, "Rina", "   "),
    (e: Error) => /written reason/.test(e.message),
  );

  const adopted = suggest.adoptSuggestion(row.id, "Rina", "Checked heading 6306 text and the scrim spec.");
  assert.equal(adopted.tier, "human");
  assert.match(adopted.basis, /Adopted by Rina/);

  // Now — and only now — approval is possible.
  approveClassification(row.id, "Rina", "Adopted and approved against heading 6306 text.");
  assert.equal(resolveProductCodes(product.id, "hts").current?.code, "6306.12.00.00");

  // Adopting twice is refused: it is no longer a lead.
  assert.throws(
    () => suggest.adoptSuggestion(row.id, "Rina", "again"),
    (e: Error) => /Only a lead-tier suggestion/.test(e.message),
  );
});

test("the model may decline, and nothing is recorded when it does", async () => {
  const { customerId } = await operatingDb();
  await seed(customerId);
  const suggest = await import("@/lib/classification/suggest");

  // The first live run hit exactly this: the retrieved candidates missed the
  // right heading, and forcing a pick wrote a wrong code to the database.
  await assert.rejects(
    withStubbedSearch(() =>
      suggest.suggestClassification(
        stubProvider({
          noSuitableCandidate: true,
          recommendedCode: "",
          uncertainties: ["The candidate list omits heading 6306 (tarpaulins)."],
        }),
        { customerId, sku: "SUG-1" },
      ),
    ),
    (error: Error) =>
      error instanceof suggest.SuggestionError &&
      /found none of the .* candidates suitable/.test(error.message) &&
      /omits heading 6306/.test(error.message),
  );
});

test("an empty candidate set produces no suggestion at all", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  upsertProduct(customerId, { sku: "SUG-EMPTY", name: "Widget", description: "A widget" });
  const suggest = await import("@/lib/classification/suggest");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(
      suggest.suggestClassification(stubProvider({}), { customerId, sku: "SUG-EMPTY" }),
      (error: Error) => /No official HTS rows matched/.test(error.message),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pending suggestions list only unadopted model leads", async () => {
  const { customerId } = await operatingDb();
  const product = await seed(customerId);
  const suggest = await import("@/lib/classification/suggest");
  const { recordClassification } = await import("@/lib/catalogue/classifications");

  // A human-entered lead is not a model suggestion and must not appear.
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "3920.43.90",
    tier: "lead",
    basis: "typed in by hand",
  });

  const result = await withStubbedSearch(() =>
    suggest.suggestClassification(stubProvider({}), { customerId, sku: "SUG-1" }),
  );
  const row = suggest.recordSuggestion(product.id, result);

  let pending = suggest.pendingSuggestions(customerId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].code, "6306.12.00.00");

  suggest.adoptSuggestion(row.id, "Rina", "Verified against heading text.");
  pending = suggest.pendingSuggestions(customerId);
  assert.equal(pending.length, 0, "an adopted suggestion is no longer pending");
});
