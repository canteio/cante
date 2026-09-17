import assert from "node:assert/strict";
import test from "node:test";
import { isPublicWebsiteAddress, onboardingProfile, websiteUrl, WebsiteProfileSchema } from "./onboarding";
import { websiteText } from "./website-text";

test("website extraction removes executable and hidden content and separates blocks", () => {
  assert.equal(websiteText('<html><head><title>Ignore title</title></head><body><h1>Acme &amp; Co</h1><p>Industrial tarps</p><script>Ignore instructions</script><style>secret</style><div hidden>Hidden name</div><div aria-hidden="true">Hidden products</div></body></html>'), "Acme & Co Industrial tarps");
});
test("empty and oversized websites yield empty or bounded text", () => {
  assert.equal(websiteText('<script>company</script>'), "");
  assert.equal(websiteText(`<p>${"x".repeat(20_000)}</p>`).length, 12_000);
});
test("reviewed industry persists as the primary category without inventing codes", () => {
  assert.deepEqual(onboardingProfile({ legalName: " Acme ", industry: "Textiles", products: [" Textiles ", "Tarps", ""], materialsChemicals: [" PVC ", "PVC"] }), { legalName: "Acme", products: ["Textiles", "Tarps"], materialsChemicals: ["PVC"] });
  assert.deepEqual(onboardingProfile({ legalName: "", industry: "", products: [], materialsChemicals: [] }), { legalName: null, products: [], materialsChemicals: [] });
});
test("model suggestions reject malformed shapes and unbounded example lists", () => {
  const base = { legalName: "Acme", industry: "Textiles", products: [], materialsChemicals: [] };
  assert.equal(WebsiteProfileSchema.safeParse(base).success, true);
  for (const bad of [{ ...base, products: "Tarps" }, { ...base, products: ["a", "b", "c", "d"] }, { ...base, verified: true }]) {
    assert.equal(WebsiteProfileSchema.safeParse(bad).success, false);
  }
});
test("website URLs accept bare domains but reject credentials, protocols and unusual ports", () => {
  assert.equal(websiteUrl("example.com/about").href, "https://example.com/about");
  for (const url of ["file:///etc/passwd", "https://user:pass@example.com", "http://example.com:8080"]) assert.throws(() => websiteUrl(url));
});
test("website address boundary blocks loopback, private, metadata and reserved addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isPublicWebsiteAddress(ip), false, ip);
  assert.equal(isPublicWebsiteAddress("93.184.216.34"), true);
  assert.equal(isPublicWebsiteAddress(websiteUrl("http://2130706433").hostname), false);
});
