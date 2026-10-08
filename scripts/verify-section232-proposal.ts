import "./load-env";
import { createServiceClient } from "../lib/supabase/service";
import { completeJson, getProvider } from "../lib/llm";
import { z } from "zod";

/**
 * Independent second-pass verification, per J's confidence-gate correction:
 *
 *   "Have one extraction produce the structured rule and another
 *   validation pass compare that rule against the original official text.
 *   Don't tell the second pass what the first one 'thought' beyond the
 *   proposed structured rule; its job is to find contradictions or
 *   unsupported fields."
 *
 * This script re-reads the proclamation's OWN text pages (fetched fresh
 * from Federal Register, not from the first pass's working files) and
 * asks a fresh model call to independently state what it believes the
 * annex rates/effective date are -- WITHOUT ever being shown
 * ingest-section232-proclamation.ts's extracted result first. Only after
 * that independent answer exists does this script diff it against what
 * is actually stored in section232_tariff_rows for the same document.
 *
 * If the two independent reads agree on every annex's rate, UK rate, and
 * US-content rate, and an effective date was identified, this document's
 * rows become eligible for auto_approve_section232_proposal(). If they
 * disagree on anything, or the independent pass could not find an
 * effective date, the rows stay 'pending' for a human, with the specific
 * disagreement recorded in verification_notes -- never silently resolved
 * in either direction.
 *
 * This script does NOT re-verify the HTS-code-level annex tables (the
 * scanned image pages) -- only the annex-level rate/date facts, which is
 * where a genuinely proclamation-breaking misread (wrong %, wrong date,
 * wrong country) would occur. Re-running the full 59-page vision
 * extraction a second time for every document would be expensive and
 * mostly re-verifies OCR legibility, not legal interpretation -- the
 * actual risk this gate exists for.
 */

const DOCUMENT_NUMBER = process.argv[2];
if (!DOCUMENT_NUMBER) {
  throw new Error("Usage: node --import tsx scripts/verify-section232-proposal.ts <federal-register-document-number>");
}

const IndependentReadSchema = z.object({
  annexes: z.array(
    z.object({
      annex: z.string(),
      ratePercent: z.number().min(0).max(100),
      ukRatePercent: z.number().min(0).max(100).nullable(),
      usContentRatePercent: z.number().min(0).max(100).nullable(),
    }),
  ),
  effectiveDate: z.string().nullable().describe("ISO date the additional duties described take effect, if stated."),
  identifiedCountryExclusions: z
    .array(z.string())
    .describe("Any country explicitly carved out of the base rate with its own rate (e.g. 'GB' for UK), as actually stated in the text."),
});

async function fetchDocumentTextPages(docNumber: string): Promise<string[]> {
  const metaUrl = `https://www.federalregister.gov/api/v1/documents/${docNumber}.json?fields[]=pdf_url`;
  const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(20_000) });
  if (!metaRes.ok) throw new Error(`Federal Register metadata fetch failed: HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const pdfRes = await fetch(meta.pdf_url, { signal: AbortSignal.timeout(60_000) });
  if (!pdfRes.ok) throw new Error(`PDF fetch failed: HTTP ${pdfRes.status}`);
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());

  const path = await import("node:path");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = path.join(process.cwd(), "raw", "section232-verify", docNumber);
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, "source.pdf");
  await writeFile(pdfPath, pdfBytes);

  const { spawnSync } = await import("node:child_process");
  const script = `
import fitz, json
doc = fitz.open(${JSON.stringify(pdfPath)})
pages = []
for i in range(len(doc)):
    raw = doc[i].get_text()
    if "</GPH>" not in raw and "[TIFF OMITTED]" not in raw:
        pages.append(raw.strip())
print(json.dumps(pages))
`;
  const proc = spawnSync("python3", ["-c", script], { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  if (proc.status !== 0) throw new Error(`PDF text extraction failed: ${proc.stderr}`);
  return JSON.parse(proc.stdout);
}

async function independentRead(textPages: string[]): Promise<z.infer<typeof IndependentReadSchema>> {
  const provider = getProvider("api");
  const { value } = await completeJson(
    provider,
    IndependentReadSchema,
    {
      system:
        "You independently read the operative clauses of a real US Presidential Proclamation under Section 232 and state " +
        "what you believe the rate rules are. You have NOT been shown any other extraction of this document -- read only " +
        "what is here and state your own honest, independent reading. Scan the ENTIRE text for every distinct named Annex " +
        "mentioned -- proclamations commonly define 4-6 separate annexes (e.g. Annex I-A, I-B, II, III, IV); do not stop " +
        "after finding the first few. For every named Annex with an explicit duty rate (including an explicit 0% " +
        "exemption, or text saying an annex's products are 'removed from scope' / 'not subject to' duties, or contain no " +
        "covered-metal content), report its base rate, any UK-specific rate, and any US-content-specific rate, exactly as " +
        "the clauses state them -- never estimate or round. Report the effective date the additional duties actually take " +
        "effect, if the text states one. Report any country explicitly given its own carve-out rate. Use a plain hyphen " +
        "('-') in every annex label, never an en-dash or em-dash.",
      prompt: textPages.join("\n\n---PAGE BREAK---\n\n"),
      timeoutMs: 180_000,
    },
  );
  return value;
}

async function main() {
  console.log(`Fetching document ${DOCUMENT_NUMBER} text pages for independent re-read...`);
  const textPages = await fetchDocumentTextPages(DOCUMENT_NUMBER);
  console.log(`Fetched ${textPages.length} text pages.`);

  const independent = await independentRead(textPages);
  console.log("Independent pass result:", JSON.stringify(independent, null, 2));

  const supabase = createServiceClient();
  const { data: storedRows, error } = await supabase
    .from("section232_tariff_rows")
    .select("annex, rate_percent, uk_rate_percent, us_content_rate_percent")
    .eq("source_document_number", DOCUMENT_NUMBER)
    .eq("status", "pending");
  if (error) throw new Error(`Failed to read stored rows: ${error.message}`);
  if (!storedRows?.length) throw new Error(`No pending rows found for document ${DOCUMENT_NUMBER} -- nothing to verify.`);

  const storedAnnexes = new Map(
    [...new Map(storedRows.map((r) => [r.annex, r])).values()].map((r) => [
      r.annex,
      { ratePercent: Number(r.rate_percent), ukRatePercent: r.uk_rate_percent === null ? null : Number(r.uk_rate_percent), usContentRatePercent: r.us_content_rate_percent === null ? null : Number(r.us_content_rate_percent) },
    ]),
  );

  // Normalize hyphen variants before comparing -- confirmed live the two
  // independent model calls can disagree on a plain hyphen ("Annex I-A")
  // vs an en-dash ("Annex I–A") for the SAME real annex, which is a real
  // but purely cosmetic Unicode difference, not a substantive disagreement
  // about the actual rate. Comparing raw strings would make the
  // verification gate permanently unable to pass this document even when
  // every real fact agrees.
  const normalizeDash = (s: string) => s.replace(/[\u2010-\u2015]/g, "-");
  const findStored = (annex: string) => {
    const normalized = normalizeDash(annex);
    for (const [key, value] of storedAnnexes) {
      if (normalizeDash(key) === normalized) return { key, value };
    }
    return null;
  };

  const disagreements: string[] = [];
  const matchedStoredKeys = new Set<string>();
  for (const indep of independent.annexes) {
    const found = findStored(indep.annex);
    if (!found) {
      disagreements.push(`Independent pass found annex "${indep.annex}" with no matching stored annex.`);
      continue;
    }
    matchedStoredKeys.add(found.key);
    const stored = found.value;
    if (stored.ratePercent !== indep.ratePercent) {
      disagreements.push(`Annex ${indep.annex}: stored rate ${stored.ratePercent}% vs independent read ${indep.ratePercent}%.`);
    }
    if ((stored.ukRatePercent ?? null) !== (indep.ukRatePercent ?? null)) {
      disagreements.push(`Annex ${indep.annex}: stored UK rate ${stored.ukRatePercent}% vs independent read ${indep.ukRatePercent}%.`);
    }
    if ((stored.usContentRatePercent ?? null) !== (indep.usContentRatePercent ?? null)) {
      disagreements.push(`Annex ${indep.annex}: stored US-content rate ${stored.usContentRatePercent}% vs independent read ${indep.usContentRatePercent}%.`);
    }
  }
  for (const storedAnnex of storedAnnexes.keys()) {
    if (!matchedStoredKeys.has(storedAnnex)) {
      disagreements.push(`Stored annex "${storedAnnex}" was not found at all by the independent pass.`);
    }
  }
  if (!independent.effectiveDate) {
    disagreements.push("Independent pass could not identify an effective date from the text.");
  }

  const verificationPass = disagreements.length === 0;
  const notes = verificationPass
    ? `Independent second pass corroborated all ${storedAnnexes.size} annex rate(s) and found effective date ${independent.effectiveDate}.`
    : `Independent pass found ${disagreements.length} issue(s): ${disagreements.join(" | ")}`;

  console.log(verificationPass ? "VERIFIED: passes match." : "NOT VERIFIED: disagreements found.");
  console.log(notes);

  const { error: updateError } = await supabase
    .from("section232_tariff_rows")
    .update({
      verification_pass: verificationPass,
      verification_notes: notes,
      effective_date: independent.effectiveDate,
    })
    .eq("source_document_number", DOCUMENT_NUMBER)
    .eq("status", "pending");
  if (updateError) throw new Error(`Failed to write verification result: ${updateError.message}`);

  if (verificationPass) {
    const { data: approvedCount, error: approveError } = await supabase.rpc("auto_approve_section232_proposal", {
      target_document_number: DOCUMENT_NUMBER,
      note: notes,
    });
    if (approveError) throw new Error(`Auto-approve failed: ${approveError.message}`);
    console.log(`AUTO-APPROVED: ${approvedCount} rows for document ${DOCUMENT_NUMBER} are now live.`);
  } else {
    console.log(`Document ${DOCUMENT_NUMBER} remains 'pending' for human review. See pending_section232_proposals().`);
  }
}

main().catch((error) => {
  console.error("Section 232 proposal verification FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
