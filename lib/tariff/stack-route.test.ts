import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/api/tariff/stack/route";
import { resetTariffCacheForTests } from "@/lib/tariff/rates";

function stubFetch(rows: unknown[]) {
  const original = global.fetch;
  global.fetch = (async () => Response.json(rows)) as typeof global.fetch;
  return () => {
    global.fetch = original;
  };
}

function request(query: string) {
  return new Request(`https://cante.test/api/tariff/stack?${query}`);
}

test.beforeEach(() => {
  resetTariffCacheForTests();
});

test("quick API carries steel content value through to the derivative amount", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const response = await GET(request("code=8450.11.00.90&country=VN&value=10000&steelContentValue=3000&importDate=2025-06-23"));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.components[1].amount, 1500);
    assert.equal(result.components[1].contentRatePercent, 0.5);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, 2000);
  } finally {
    restore();
  }
});

test("quick API exposes a missing derivative content value as unresolved", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const response = await GET(request("code=8450.11.00.90&country=VN&value=10000&importDate=2025-06-23"));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.unresolvedMeasures.length, 1);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, null);
  } finally {
    restore();
  }
});

test("quick API treats a blank content parameter as missing, not verified zero", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const response = await GET(request("code=8450.11.00.90&country=VN&value=10000&steelContentValue=&importDate=2025-06-23"));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.unresolvedMeasures.length, 1);
    assert.equal(result.totalAmount, null);
  } finally {
    restore();
  }
});

test("quick API requests programme S only for a complete verified qualifying decision", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const params = new URLSearchParams({
      code: "0101.21.00.10",
      country: "MX",
      value: "1000",
      usmcaVerified: "true",
      usmcaDecision: "qualifies",
      usmcaDetails: "Signed certificate ABC and product-specific rule review",
    });
    const response = await GET(request(params.toString()));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.components[0].amount, 0);
    assert.equal(result.usmcaQualification.status, "verified");
    assert.equal(result.usmcaQualification.specialRateRequested, true);
  } finally {
    restore();
  }
});

test("quick API suppresses a bare programme S claim", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const response = await GET(request("code=0101.21.00.10&country=MX&value=1000&programme=S"));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.components[0].amount, 20);
    assert.equal(result.usmcaQualification.specialRateRequested, false);
  } finally {
    restore();
  }
});

test("quick API rejects invalid content values and USMCA enums before lookup", async () => {
  const negativeContent = await GET(request("code=8450.11.00&country=VN&steelContentValue=-1"));
  assert.equal(negativeContent.status, 400);
  assert.match((await negativeContent.json()).error, /non-negative/);

  const invalidDecision = await GET(request("code=0101.21.00&country=MX&usmcaDecision=assumed"));
  assert.equal(invalidDecision.status, 400);
  assert.match((await invalidDecision.json()).error, /qualifies/);
});

test("quick API bounds upstream lookup and audit-detail inputs", async () => {
  const longCode = await GET(request(`code=${"8".repeat(65)}&country=VN`));
  assert.equal(longCode.status, 400);
  assert.match((await longCode.json()).error, /64 characters/);

  const longDetails = await GET(request(`code=0101.21.00&country=MX&usmcaDetails=${"a".repeat(2_001)}`));
  assert.equal(longDetails.status, 400);
  assert.match((await longDetails.json()).error, /2000 characters/);
});
