import assert from "node:assert/strict";
import test from "node:test";
import { screenUsTradeControls } from "./us-trade-controls";

test("screenUsTradeControls flags Section 301 and UFLPA for China-origin PVC/vinyl imports", () => {
  const result = screenUsTradeControls({
    htsCode: "3920.43.00",
    productDescription: "PVC Plastic Sheeting",
    countryOfOrigin: "China",
    materialsChemicals: ["Polyvinyl Chloride Resin", "DOP Plasticizer"],
  });

  assert.equal(result.hasFlags, true);
  assert.ok(result.hits.some((h) => h.type === "section_301" && h.severity === "high"));
  assert.ok(result.hits.some((h) => h.type === "uflpa" && h.severity === "high"));
  assert.ok(result.hits.some((h) => h.type === "pga_epa_tsca"));
});

test("screenUsTradeControls flags AD/CVD and TSCA for Vietnamese/Taiwanese PVC coated fabrics", () => {
  const result = screenUsTradeControls({
    htsCode: "5903.10.20",
    productDescription: "PVC Coated Tarpaulin Fabric",
    countryOfOrigin: "Vietnam",
    materialsChemicals: ["Polyester Fabric", "PVC Resin", "Plasticizer"],
  });

  assert.equal(result.hasFlags, true);
  assert.ok(result.hits.some((h) => h.type === "ad_cvd"));
  assert.ok(result.hits.some((h) => h.type === "pga_epa_tsca"));
  // Not China origin, so Section 301 is not triggered
  assert.equal(result.hits.some((h) => h.type === "section_301"), false);
});

test("screenUsTradeControls returns clean for low-risk domestic products with no trade remedies", () => {
  const result = screenUsTradeControls({
    htsCode: "9403.20.00",
    productDescription: "Domestic Metal Office Furniture",
    countryOfOrigin: "United States",
  });

  assert.equal(result.hasFlags, false);
  assert.equal(result.hits.length, 0);
});
