import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreShipmentAgainstRecall,
  rankRecallMatches,
  type ShipmentForMatching,
} from "./match-shipment-recalls";
import type { RegulationEntry } from "@/lib/sources/fetch";

/** Minimal valid RegulationEntry for test fixtures. */
function recall(overrides: Partial<RegulationEntry> = {}): RegulationEntry {
  return {
    sourceId: "us-cpsc-recalls",
    sourceName: "CPSC - recent product recalls",
    domain: "www.saferproducts.gov",
    regulationType: "standards",
    label: "CPSC recall 26-404",
    number: "26-404",
    year: 2026,
    listingTitle: "Supernova Butane Torch Lighters Recalled",
    truncated: false,
    fullTitle:
      "Supernova and Typhoon butane torch lighters recalled for lacking " +
      "required child-resistant mechanism. Recall date 2026-04-09.",
    url: "https://www.cpsc.gov/Recalls/2026/recall-26-404",
    foundInViews: ["cpsc-recalls"],
    ...overrides,
  };
}

test("scoreShipmentAgainstRecall returns null when cargo description is missing", () => {
  const shipment: ShipmentForMatching = {
    cargoDescription: null,
    hsChapter: null,
    consigneeName: "Prestige Import Group",
  };
  assert.equal(scoreShipmentAgainstRecall(shipment, recall()), null);
});

test("scoreShipmentAgainstRecall returns null when there is no word overlap", () => {
  const shipment: ShipmentForMatching = {
    cargoDescription: "Ceramic dinnerware plates and bowls",
    hsChapter: "69",
    consigneeName: "Prestige Import Group",
  };
  assert.equal(scoreShipmentAgainstRecall(shipment, recall()), null);
});

test("scoreShipmentAgainstRecall matches overlapping significant terms", () => {
  const shipment: ShipmentForMatching = {
    cargoDescription: "Butane torch lighters, child-resistant mechanism pending",
    hsChapter: "96",
    consigneeName: "Prestige Import Group",
  };
  const match = scoreShipmentAgainstRecall(shipment, recall());
  assert.ok(match);
  assert.ok(match!.score >= 3);
  assert.ok(match!.matchedTerms.includes("butane"));
  assert.ok(match!.matchedTerms.includes("torch"));
  assert.ok(match!.matchedTerms.includes("lighters"));
  // Noise words must never appear even when literally shared.
  assert.ok(!match!.matchedTerms.includes("for"));
});

test("scoreShipmentAgainstRecall ignores noise words entirely", () => {
  const shipment: ShipmentForMatching = {
    cargoDescription: "Various units of general product cases",
    hsChapter: null,
    consigneeName: null,
  };
  const noiseRecall = recall({
    fullTitle: "Various units of general product cases recalled",
  });
  assert.equal(scoreShipmentAgainstRecall(shipment, noiseRecall), null);
});

test("rankRecallMatches sorts strongest overlap first and drops non-matches", () => {
  const shipment: ShipmentForMatching = {
    cargoDescription: "Butane torch lighters shipment, child-resistant safety pending",
    hsChapter: "96",
    consigneeName: "Prestige Import Group",
  };
  const strongMatch = recall({
    number: "26-404",
    fullTitle: "Butane torch lighters recalled for lacking child-resistant mechanism",
  });
  const weakMatch = recall({
    number: "26-500",
    fullTitle: "Butane lighters recalled for a separate defect",
  });
  const noMatch = recall({
    number: "26-600",
    fullTitle: "Ceramic dinnerware plates recalled for lead content",
  });

  const ranked = rankRecallMatches(shipment, [weakMatch, noMatch, strongMatch]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].recall.number, "26-404");
  assert.ok(ranked[0].score >= ranked[1].score);
});
