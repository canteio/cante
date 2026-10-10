import assert from "node:assert/strict";
import test from "node:test";
import { parseStackRequestRows, MAX_BULK_ROWS } from "@/lib/tariff/bulk";

test("parses hts_code/country_of_origin headers with value, quantity, unit, programme", () => {
  const csv = "hts_code,country_of_origin,value,quantity,unit,programme\n8544.42.90.00,CN,10000,500,kg,S\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    rowNumber: 1,
    htsCode: "8544.42.90.00",
    countryOfOrigin: "CN",
    value: 10000,
    quantity: 500,
    unit: "kg",
    claimedProgramme: "S",
    importDate: null,
    steelContentValue: null,
    aluminumContentValue: null,
    usmcaQualification: null,
  });
});

test("parses an optional import_date column", () => {
  const csv = "hts_code,country_of_origin,import_date\n1234.56.78.90,CN,2026-03-15\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].importDate, "2026-03-15");
});

test("accepts the date header alias for import_date", () => {
  const csv = "hts_code,country_of_origin,date\n1234.56.78.90,CN,2026-03-15\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].importDate, "2026-03-15");
});

test("a malformed import date is reported as a row error rather than silently ignored", () => {
  const csv = "hts_code,country_of_origin,import_date\n1234.56.78.90,CN,not-a-date\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /Import date/);
});

test("accepts common header aliases used by real trade-compliance spreadsheets", () => {
  const csv = "hts,origin\n8544.42.90.00,CN\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].htsCode, "8544.42.90.00");
  assert.equal(rows[0].countryOfOrigin, "CN");
});

test("coo and country are also recognised as the country column", () => {
  for (const header of ["coo", "country"]) {
    const csv = `hts_code,${header}\n1234.56.78.90,VN\n`;
    const { rows, errors } = parseStackRequestRows(csv);
    assert.equal(errors.length, 0, header);
    assert.equal(rows[0].countryOfOrigin, "VN", header);
  }
});

test("rows missing a recognisable HTS or country column are reported as errors, not silently dropped", () => {
  const csv = "sku,description\nABC-123,widget\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 1);
  assert.match(errors[0].reason, /HTS code/);
});

test("a non-numeric value is reported as a row error instead of silently becoming null", () => {
  const csv = "hts_code,country_of_origin,value\n1234.56.78.90,CN,not-a-number\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /not a usable/);
});

test("a negative value is rejected rather than passed through to the duty calculation", () => {
  const csv = "hts_code,country_of_origin,value\n1234.56.78.90,CN,-500\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /non-negative/);
});

test("a negative quantity is rejected the same way", () => {
  const csv = "hts_code,country_of_origin,quantity\n1234.56.78.90,CN,-10\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /non-negative/);
});

test("value accepts currency symbols and thousands separators", () => {
  const csv = "hts_code,country_of_origin,value\n1234.56.78.90,CN,\"$12,500.50\"\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].value, 12500.5);
});

test("rows beyond MAX_BULK_ROWS are not processed, and the file reports an explicit truncation error", () => {
  const header = "hts_code,country_of_origin\n";
  const body = Array.from({ length: MAX_BULK_ROWS + 10 }, (_, i) => `1234.56.78.${String(i).padStart(2, "0")},CN\n`).join("");
  const { rows, errors } = parseStackRequestRows(header + body);
  assert.equal(rows.length, MAX_BULK_ROWS);
  assert.ok(errors.some((e) => e.reason.includes("only the first")));
});

test("a valid row and an invalid row in the same file are both reported independently", () => {
  const csv = "hts_code,country_of_origin\n1234.56.78.90,CN\n,MX\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 2);
});

test("duplicate header columns refuse the whole file rather than silently dropping a column", () => {
  const csv = "hts_code,country,country\n1234.56.78.90,CN,MX\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /repeats column/);
});

test("conflicting country-of-origin aliases on the same row are reported instead of silently preferring one", () => {
  const csv = "hts_code,country,coo\n1234.56.78.90,CN,MX\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /Conflicting country-of-origin/);
});

test("conflicting HTS aliases on the same row are reported instead of silently preferring one", () => {
  const csv = "hts_code,hts,country\n1234.56.78.90,9999.99.99.99,CN\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /Conflicting HTS code/);
});

test("agreeing values under two aliases for the same field are not flagged as a conflict", () => {
  const csv = "hts_code,country,coo\n1234.56.78.90,CN,cn\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].countryOfOrigin, "CN");
});

test("parses metal content values and explicit USMCA audit fields through safe aliases", () => {
  const csv = [
    "hts_code,country,steel_value,aluminium_content_value,usmcaverified,usmca_qualification_decision,usmca_details",
    "9403.99.9020,CA,2000,1000,yes,qualifies,Certificate ABC reviewed",
  ].join("\n");
  const { rows, errors } = parseStackRequestRows(csv);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].steelContentValue, 2000);
  assert.equal(rows[0].aluminumContentValue, 1000);
  assert.deepEqual(rows[0].usmcaQualification, {
    verified: true,
    decision: "qualifies",
    details: "Certificate ABC reviewed",
  });
});

test("conflicting content-value aliases are rejected instead of silently picking one", () => {
  const csv = "hts_code,country,steel_content_value,steel_value\n8450.11.00,VN,2000,3000\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.match(errors[0].reason, /Conflicting steel content value/);
});

test("conflicting USMCA aliases are rejected instead of silently picking one", () => {
  const csv = "hts_code,country,usmca_verified,usmcaverified\n0101.21.00,MX,true,false\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.match(errors[0].reason, /Conflicting USMCA verified/);
});

test("invalid USMCA booleans and decisions are row errors", () => {
  const badBoolean = parseStackRequestRows("hts_code,country,usmca_verified\n0101.21.00,MX,maybe\n");
  assert.equal(badBoolean.rows.length, 0);
  assert.match(badBoolean.errors[0].reason, /true\/false/);

  const badDecision = parseStackRequestRows("hts_code,country,usmca_decision\n0101.21.00,MX,assumed\n");
  assert.equal(badDecision.rows.length, 0);
  assert.match(badDecision.errors[0].reason, /qualifies/);
});

test("content values cannot exceed shipment value separately or together", () => {
  const csv = "hts_code,country,value,steel_content_value,aluminum_content_value\n9403.99.9020,VN,1000,700,400\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.match(errors[0].reason, /cannot individually or together exceed/);
});

test("strict bulk date validation rejects impossible dates", () => {
  const csv = "hts_code,country,import_date\n8450.11.00,VN,2025-02-29\n";
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(rows.length, 0);
  assert.match(errors[0].reason, /Import date/);
});

test("bulk parser rejects numeric decorations that normalize to an empty value", () => {
  for (const header of ["value", "quantity", "steel_content_value", "aluminum_content_value"]) {
    const { rows, errors } = parseStackRequestRows(`hts_code,country,${header}\n8450.11.00,VN,$\n`);
    assert.equal(rows.length, 0, header);
    assert.equal(errors.length, 1, header);
    assert.match(errors[0].reason, /usable, non-negative number/);
  }
});

test("bulk parser bounds fields that reach the upstream URL or audit response", () => {
  const longCode = parseStackRequestRows(`hts_code,country\n${"8".repeat(65)},VN\n`);
  assert.equal(longCode.rows.length, 0);
  assert.match(longCode.errors[0].reason, /64 characters/);

  const longDetails = parseStackRequestRows(`hts_code,country,usmca_details\n0101.21.00,MX,${"a".repeat(2_001)}\n`);
  assert.equal(longDetails.rows.length, 0);
  assert.match(longDetails.errors[0].reason, /2000 characters/);
});

test("bulk parser normalizes unpunctuated HTS codes, natural country names, and decorated currency", () => {
  const csv = [
    "HTS-Code,Made in,Customs Value ($)",
    "8501104060,China,\"$ 1,500.50 USD\"",
    "85011040,Vietnam,2500 USD",
    "8501 10 40 60,United States,3000",
  ].join("\n");
  const { rows, errors } = parseStackRequestRows(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].htsCode, "8501.10.40.60");
  assert.equal(rows[0].countryOfOrigin, "CN");
  assert.equal(rows[0].value, 1500.5);
  assert.equal(rows[1].htsCode, "8501.10.40");
  assert.equal(rows[1].countryOfOrigin, "VN");
  assert.equal(rows[1].value, 2500);
  assert.equal(rows[2].htsCode, "8501.10.40.60");
  assert.equal(rows[2].countryOfOrigin, "US");
  assert.equal(rows[2].value, 3000);
});

