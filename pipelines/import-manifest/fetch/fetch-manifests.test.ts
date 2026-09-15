import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseM01VesselLine,
  parseP01PortLine,
  deriveShipperCountryCode,
} from "./fetch-manifests";

// Sample line built from the CBP CAMIR M01 spec: pos 1-3 "M01", 4-7 SCAC,
// 8-9 mode, 10-11 country, 12-34 vessel name, 35-39 voyage number.
function padTo(s: string, len: number) {
  return (s + " ".repeat(len)).slice(0, len);
}

test("parseM01VesselLine extracts SCAC, vessel name, voyage number", () => {
  const line =
    "M01" + // control id, pos 1-3
    "MAEU" + // carrier SCAC, pos 4-7
    "11" + // mode of transportation, pos 8-9
    "DK" + // vessel country, pos 10-11
    padTo("MAERSK ESSEX", 23) + // vessel name, pos 12-34
    padTo("42E1", 5); // voyage number, pos 35-39
  const parsed = parseM01VesselLine(line);
  assert.equal(parsed.carrierScac, "MAEU");
  assert.equal(parsed.vesselName, "MAERSK ESSEX");
  assert.equal(parsed.voyageNumber, "42E1");
});

test("parseM01VesselLine returns nulls for a non-M01 line", () => {
  const parsed = parseM01VesselLine("P01SOMETHING");
  assert.deepEqual(parsed, {
    carrierScac: null,
    vesselName: null,
    voyageNumber: null,
  });
});

test("parseP01PortLine extracts SCAC and port of unlading", () => {
  const line = "P01" + "MAEU" + "4601"; // control id, SCAC, CBP port code
  const parsed = parseP01PortLine(line);
  assert.equal(parsed.carrierScac, "MAEU");
  assert.equal(parsed.portOfUnladingCode, "4601");
});

// "Foreign-shipper mirror" — see fetch-manifests.ts for the legal rationale
// (China/Indonesia have no legal public company-level customs data of their
// own; the US inward manifest's shipper field is the legal substitute).
test("deriveShipperCountryCode identifies a Chinese shipper address", () => {
  assert.equal(
    deriveShipperCountryCode("No. 88 Wenzhou Road, Ningbo, China"),
    "CN"
  );
});

test("deriveShipperCountryCode identifies an Indonesian shipper address", () => {
  assert.equal(
    deriveShipperCountryCode("Jl. Industri Raya 12, Tangerang, Indonesia"),
    "ID"
  );
});

test("deriveShipperCountryCode returns null for an unrecognized/US address", () => {
  assert.equal(
    deriveShipperCountryCode("400 Main St, Newark, NJ, USA"),
    null
  );
});

test("deriveShipperCountryCode returns null for missing address", () => {
  assert.equal(deriveShipperCountryCode(null), null);
  assert.equal(deriveShipperCountryCode(undefined), null);
});
