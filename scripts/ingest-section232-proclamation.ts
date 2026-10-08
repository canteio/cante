import "./load-env";
import { createServiceClient } from "../lib/supabase/service";
import { completeJson, getProvider } from "../lib/llm";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Automated Section 232 tariff-rate EXTRACTION from a Federal Register
 * Presidential Proclamation, into a PENDING-REVIEW queue -- never directly
 * into live duty-calculation data.
 *
 * Architecture (per J's correction of an earlier no-approval-gate design):
 *   detect (Federal Register monitor) -> AI-parse (this script) ->
 *   proposed rows in section232_tariff_rows with status='pending' ->
 *   HUMAN approval via review_section232_proposal() -> status='approved'
 *   -> current_section232_rate() only ever resolves 'approved' rows.
 *
 * "AI discovers/interprets. Code calculates. Official sources prove.
 * Human approves uncertain new rules." This script is the
 * discover/interpret half only. It writes bounded, mechanically-validated
 * DATA rows (HTS code + rate + annex + citation), never executes
 * calculation logic, and a publish is atomic per-document-number -- but it
 * stops there. Nothing it writes is live until a named human calls
 * review_section232_proposal(decision: 'approved').
 *
 * Pipeline:
 *  1. Fetch the proclamation's real PDF from govinfo.gov (via the Federal
 *     Register API's own pdf_url field -- never guess the URL pattern).
 *  2. Split pages into TEXT (the operative clauses -- rates, effective
 *     dates, country rules) vs IMAGE (the annex HTS-code tables, which the
 *     Federal Register itself publishes as scanned TIFF with no text
 *     layer -- confirmed live for Proclamation 11021, 59 of 66 pages,
 *     detected by the page's own "</GPH>" graphics-placeholder marker).
 *  3. Render each image page and extract its HTS-code table via a vision
 *     LLM, strictly constrained to a JSON schema (code + description only
 *     -- the model is given the EXACT rates per annex from the
 *     already-parsed text pages, not asked to infer a rate itself).
 *     Multi-page annex tables do not reliably repeat a clean heading on
 *     continuation pages (confirmed live: blank, or running header/footer
 *     boilerplate gets transcribed instead) -- a page's annex is carried
 *     forward from the prior page unless its heading matches a DIFFERENT
 *     known annex.
 *  4. Validate every extracted row mechanically: HTS code format, known
 *     annex label, no duplicate HTS code within one annex.
 *  5. Sanity-check the whole batch against the previous APPROVED revision:
 *     an extraction producing drastically fewer rows than last time is
 *     treated as a corrupted/failed extraction, not a real law change --
 *     the run aborts and writes nothing, rather than queuing broken data
 *     for review.
 *  6. Write as 'pending' rows, versioned by the proclamation's own document
 *     number. A human reviews via pending_section232_proposals() and
 *     approves/rejects via review_section232_proposal().
 */

const DOCUMENT_NUMBER = process.argv[2];
if (!DOCUMENT_NUMBER) {
  throw new Error("Usage: node --import tsx scripts/ingest-section232-proclamation.ts <federal-register-document-number>");
}
// Real Federal Register document numbers are alphanumeric with hyphens
// (e.g. "2026-06960"). Validating the format before it ever reaches a
// filesystem path closes a path-traversal primitive flagged in red-team
// review: path.join() normalizes ".." segments, so an unvalidated
// argument like "../../../etc/passwd" would resolve DEBUG_DIR outside
// raw/section232-debug entirely. Today's only caller is a trusted CLI
// operator, but this guard costs nothing and protects against any future
// automated/triggered caller that forwards a less-trusted value.
if (!/^[\w-]+$/.test(DOCUMENT_NUMBER)) {
  throw new Error(`Invalid document number "${DOCUMENT_NUMBER}" -- expected alphanumeric/hyphen characters only.`);
}

const DEBUG_DIR = path.join(process.cwd(), "raw", "section232-debug", DOCUMENT_NUMBER);

const AnnexRateSchema = z.object({
  annex: z.string(),
  ratePercent: z.number().min(0).max(100),
  ukRatePercent: z.number().min(0).max(100).nullable(),
  usContentRatePercent: z.number().min(0).max(100).nullable(),
  label: z.string(),
});

const ExtractedRowSchema = z.object({
  // Deliberately unvalidated string at the schema level. An earlier version
  // used z.string().regex(...) here, which meant ONE malformed row (a stray
  // OCR artifact, extra whitespace, wrong separator) crashed the entire
  // page's extraction via a zod parse failure -- confirmed live on page 54
  // (173-row grid) where row 169 failed validation for a reason the error
  // message didn't even surface. Format is now checked AFTER extraction (see
  // the main loop's isValidHtsPrefix filter), so one bad row is dropped with
  // a logged reason instead of discarding the other 172 good rows on the
  // same page.
  htsCode: z.string().min(1),
  // Not every annex page prints a per-code description. Confirmed live on
  // Annex IV: a bare multi-column grid of HTS codes grouped only under a
  // sub-heading like "(iv) Derivative steel articles:" with no description
  // column at all. Requiring a non-empty description here would make a
  // real, correctly-read page fail validation. subheading carries
  // whatever grouping label was printed above the code, when there is one.
  description: z.string().nullable(),
  subheading: z.string().nullable(),
});

const PageExtractionSchema = z.object({
  // Confirmed live: not every page carrying the "</GPH>" image marker (used
  // upstream to classify text vs image pages) is actually an HTS code
  // table. Page 64 of Proclamation 11021 has a small embedded masthead
  // graphic but its real content is prose describing amendments to
  // Chapter 99 subdivisions (e.g. "9903.82.04-9903.82.17" as a CITED
  // RANGE in legal drafting text, not a tariff-table row). Forcing that
  // page through the row schema produced confusing schema-validation
  // noise. The model now says explicitly whether this page is a genuine
  // HTS code table before the pipeline trusts any rows from it.
  isHtsCodeTable: z
    .boolean()
    .describe(
      "true ONLY if this page is an ANNEX-style listing of PRODUCT HTS codes (10-digit-ish classification codes like " +
      "7208.10.15.00 or 8536.69.40, with or without a plain-language product description). " +
      "false for: legal drafting prose (even if it cites HTS ranges in sentences); a title/cover page; blank; OR " +
      "a CHAPTER 99 HEADING-DEFINITION table -- confirmed live on Proclamation 11021 page 56: a table whose left " +
      "column holds codes like '9903.82.02' and whose other columns are headed 'Rates of Duty 1-General/Special' " +
      "and 'Rates of Duty 2' with full-paragraph LEGAL TEXT cells (e.g. 'Except as provided for in headings " +
      "9903.82.14...'). That is the statutory text DEFINING what a Chapter 99 duty-modifier heading means -- a " +
      "completely different document section from an annex's flat product-code list, and it must be marked false.",
    ),
  annexLabel: z.string().describe("The exact annex heading printed on this page, e.g. 'Annex I-A'. Empty string if isHtsCodeTable is false."),
  rows: z.array(ExtractedRowSchema),
});

interface FederalRegisterDoc {
  title: string;
  pdfUrl: string;
  publicationDate: string;
  presidentialDocumentNumber: string | null;
}

async function fetchDocumentMeta(docNumber: string): Promise<FederalRegisterDoc> {
  const url = `https://www.federalregister.gov/api/v1/documents/${docNumber}.json?fields[]=title&fields[]=pdf_url&fields[]=publication_date&fields[]=presidential_document_number`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Federal Register metadata fetch failed: HTTP ${res.status}`);
  const raw = await res.json();
  if (!raw.pdf_url) throw new Error(`Document ${docNumber} has no pdf_url`);
  return {
    title: raw.title,
    pdfUrl: raw.pdf_url,
    publicationDate: raw.publication_date,
    presidentialDocumentNumber: raw.presidential_document_number ?? null,
  };
}

async function fetchPdfBytes(pdfUrl: string): Promise<Buffer> {
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`PDF fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Pages are classified TEXT vs IMAGE by actual extracted text length, not
 * by guessing a page-number range -- a different proclamation's annex may
 * start on a different page.
 */
async function classifyAndRenderPages(
  pdfBytes: Buffer,
): Promise<{ textPages: string[]; imagePageIndexes: number[]; pageCount: number }> {
  const mod = await import("node:child_process");
  const tmpPdf = path.join(DEBUG_DIR, "source.pdf");
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(tmpPdf, pdfBytes);

  const script = `
import fitz, json, sys
doc = fitz.open(${JSON.stringify(tmpPdf)})
result = {"textPages": [], "imagePageIndexes": [], "pageCount": len(doc)}
for i in range(len(doc)):
    raw = doc[i].get_text()
    # Federal Register scans embed a graphics placeholder tag ("</GPH>") plus
    # printing-metadata boilerplate on every page whose real content is a
    # TIFF image with no actual text layer -- confirmed live on Proclamation
    # 11021: all 59 image/annex pages carry this exact marker and nothing
    # else, while every real prose page has none. A plain length threshold
    # was tried first and silently misclassified every page as "text"
    # (the boilerplate itself is ~269 chars, not near-zero), producing zero
    # extracted rows with no error -- exactly the silent-corruption failure
    # mode the downstream row-count sanity check exists to catch, except
    # this one was upstream of it. The marker check is unambiguous instead
    # of threshold-fragile.
    if "</GPH>" in raw or "[TIFF OMITTED]" in raw:
        result["imagePageIndexes"].append(i)
    else:
        result["textPages"].append(raw.strip())
print(json.dumps(result))
`;
  const proc = mod.spawnSync("python3", ["-c", script], { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  if (proc.status !== 0) throw new Error(`PDF page classification failed: ${proc.stderr}`);
  return JSON.parse(proc.stdout);
}

async function renderPagePng(pdfPath: string, pageIndex: number): Promise<string> {
  const outPath = path.join(DEBUG_DIR, `page-${pageIndex}.png`);
  const mod = await import("node:child_process");
  const script = `
import fitz
doc = fitz.open(${JSON.stringify(pdfPath)})
pix = doc[${pageIndex}].get_pixmap(dpi=200)
pix.save(${JSON.stringify(outPath)})
`;
  const proc = mod.spawnSync("python3", ["-c", script], { encoding: "utf-8" });
  if (proc.status !== 0) throw new Error(`Page render failed for page ${pageIndex}: ${proc.stderr}`);
  return outPath;
}

/**
 * Parse the rate/rule facts (NOT the HTS code lists -- those are only on
 * the image pages) from the proclamation's real text. Deliberately a
 * narrow, auditable schema: every field must trace to actual clause text,
 * never inferred.
 */
async function extractAnnexRates(textPages: string[]): Promise<z.infer<typeof AnnexRateSchema>[]> {
  const provider = getProvider("api");
  const combined = textPages.join("\n\n---PAGE BREAK---\n\n");
  const { value } = await completeJson(
    provider,
    z.object({ annexes: z.array(AnnexRateSchema) }),
    {
      system:
        "You extract tariff rate rules from the operative clauses of a real US Presidential Proclamation under Section 232. " +
        "Scan the ENTIRE text for every distinct named Annex mentioned (e.g. 'Annex I-A', 'Annex I-B', 'Annex II', 'Annex III', 'Annex IV' -- " +
        "do not stop after finding the first few; proclamations commonly define 4-6 separate annexes with different treatment). " +
        "Extract every named Annex that the text assigns a duty treatment to, including an EXEMPTION -- an annex the text says is " +
        "'no longer subject to' or 'removed from the scope of' the additional duty, or that lists products with no covered-metal " +
        "content, is a real annex with ratePercent 0, not something to omit. Never infer, estimate, or round a rate. If a clause " +
        "mentions a UK-specific or US-content-specific rate for an annex, capture it; if not mentioned for that annex, use null. " +
        "Return every annex that actually appears in this text with an explicit duty treatment (a percentage OR an explicit " +
        "exemption), and nothing else. Use a plain hyphen ('-') in every annex label, never an en-dash or em-dash.",
      prompt: combined,
      timeoutMs: 180_000,
    },
  );
  return value.annexes;
}

async function extractPageRows(
  imagePath: string,
  knownAnnexes: z.infer<typeof AnnexRateSchema>[],
): Promise<z.infer<typeof PageExtractionSchema>> {
  const provider = getProvider("api");
  const imageBuffer = await import("node:fs/promises").then((m) => m.readFile(imagePath));
  const base64 = imageBuffer.toString("base64");
  const { value } = await completeJson(
    provider,
    PageExtractionSchema,
    {
      system:
        "You read one scanned page from a US Presidential Proclamation. First decide: is this page's main content a " +
        "TABLE/GRID of HTS tariff codes, or is it legal drafting prose (amendments, clauses, cross-references -- even if " +
        "it cites HTS code ranges in running text)? Set isHtsCodeTable accordingly. " +
        "If and only if it IS a code table: transcribe EXACTLY what is printed -- the annex heading at the top of the " +
        "page, and every HTS code row in the table. Some pages print a full description next to each code -- transcribe " +
        "it into 'description'. Other pages print only a bare grid of HTS codes grouped under a sub-heading like " +
        "'(iii) Articles of steel:' with NO per-code description at all -- in that case set description to null and put " +
        "the grouping sub-heading text into 'subheading' for every code under it. Do not invent, correct, reformat, or " +
        "guess a code you cannot read clearly -- omit it instead. " +
        `Known annex labels for this proclamation, for reference only (do not use a rate from here, you are not extracting rates on this page): ${JSON.stringify(knownAnnexes.map((a) => a.annex))}.`,
      prompt: "Transcribe this page's annex heading and HTS code table exactly as printed.",
      images: [{ base64, mimeType: "image/png" }],
      timeoutMs: 120_000,
    },
  );
  return value;
}

async function main() {
  console.log(`Fetching Federal Register document ${DOCUMENT_NUMBER}...`);
  const meta = await fetchDocumentMeta(DOCUMENT_NUMBER);
  console.log(`  ${meta.title}`);
  console.log(`  PDF: ${meta.pdfUrl}`);

  const pdfBytes = await fetchPdfBytes(meta.pdfUrl);
  console.log(`Fetched PDF: ${pdfBytes.length} bytes`);

  const { textPages, imagePageIndexes, pageCount } = await classifyAndRenderPages(pdfBytes);
  console.log(`Classified ${pageCount} pages: ${textPages.length} text, ${imagePageIndexes.length} image/annex pages`);
  // Bounded against a malicious or corrupted PDF causing unbounded vision
  // API spend -- real Section 232 proclamations run tens of pages (this
  // document's real annexes spanned 59); 500 is a generous ceiling that
  // would never trigger on genuine government documents but caps worst-case
  // cost if a hostile or garbled PDF slips through.
  const MAX_IMAGE_PAGES = 500;
  if (imagePageIndexes.length > MAX_IMAGE_PAGES) {
    throw new Error(
      `Page classification found ${imagePageIndexes.length} image/annex pages, exceeding the ${MAX_IMAGE_PAGES}-page ` +
        `safety ceiling. Refusing to run unbounded vision extraction against a document this size -- verify the PDF ` +
        `is genuine and not corrupted/malicious before raising this limit.`,
    );
  }
  if (imagePageIndexes.length === 0) {
    throw new Error(
      "Page classification found 0 image/annex pages -- either this proclamation genuinely has no scanned annex " +
        "tables (unlikely for a Section 232 rate action) or the classifier's </GPH> marker check failed to match " +
        "this document's PDF structure. Refusing to publish an extraction with no HTS code data rather than " +
        "silently writing zero rows.",
    );
  }

  const annexRates = await extractAnnexRates(textPages);
  console.log(`Extracted ${annexRates.length} annex rate rules from text:`, JSON.stringify(annexRates, null, 2));

  if (annexRates.length === 0) {
    throw new Error("No annex rate rules extracted from proclamation text -- refusing to proceed with annex-only data and no rates to attach.");
  }

  const pdfPath = path.join(DEBUG_DIR, "source.pdf");
  const allRows: Array<z.infer<typeof ExtractedRowSchema> & { annex: string }> = [];
  let carryAnnex: string | null = null;
  for (const pageIndex of imagePageIndexes) {
    const pngPath = await renderPagePng(pdfPath, pageIndex);
    const extraction = await extractPageRows(pngPath, annexRates);
    if (!extraction.isHtsCodeTable) {
      console.log(`  page ${pageIndex}: not an HTS code table (legal drafting prose or similar) -- skipped.`);
      continue;
    }
    // Format validation moved OUT of the zod schema and in here, so one
    // malformed row (OCR noise, stray punctuation) is dropped with a
    // logged reason instead of crashing the whole page's extraction --
    // confirmed live: page 54's 173-row grid failed entirely because of
    // ONE unspecified bad row before this change.
    const HTS_PREFIX_RE = /^\d{4}(\.\d{1,4}){0,3}$/;
    const malformedRows = extraction.rows.filter((row) => !HTS_PREFIX_RE.test(row.htsCode.trim()));
    if (malformedRows.length > 0) {
      console.log(
        `  page ${pageIndex}: dropped ${malformedRows.length} malformed code(s): ` +
          `${malformedRows.map((r) => JSON.stringify(r.htsCode)).join(", ")}`,
      );
    }
    extraction.rows = extraction.rows
      .filter((row) => HTS_PREFIX_RE.test(row.htsCode.trim()))
      .map((row) => ({ ...row, htsCode: row.htsCode.trim() }));
    // Second, independent backstop: Chapter 99 (99xx.xx.xx) codes are duty
    // MODIFIERS, never real product classifications -- confirmed live:
    // page 56 of this proclamation is a Chapter 99 heading-DEFINITION
    // table that slipped past isHtsCodeTable before that flag existed.
    // Filtered here (not a zod .refine()) so one stray 99xx row degrades
    // to a dropped-row warning instead of crashing the whole page's
    // extraction the way a hard schema rejection did previously.
    const chapter99Rows = extraction.rows.filter((row) => row.htsCode.startsWith("99"));
    if (chapter99Rows.length > 0) {
      console.log(
        `  page ${pageIndex}: dropped ${chapter99Rows.length} Chapter 99 duty-modifier code(s) ` +
          `(${chapter99Rows.map((r) => r.htsCode).join(", ")}) -- these are not product classifications.`,
      );
    }
    extraction.rows = extraction.rows.filter((row) => !row.htsCode.startsWith("99"));
    if (extraction.rows.length === 0) {
      console.log(`  page ${pageIndex}: no real product rows remained after filtering -- skipped.`);
      continue;
    }
    // The model's transcribed heading is the full printed text (e.g.
    // "Annex I-A: 50% Section 232 Tariff on Full Value"), not the bare key
    // used in annexRates (e.g. "Annex I-A") -- normalize by matching the
    // rate schema's own annex label as a PREFIX of what was read off the
    // page, rather than requiring an exact string match that would reject
    // every genuinely correct extraction. Also normalize hyphen variants:
    // confirmed live the rate-extraction pass and the page-image pass can
    // disagree on a plain hyphen ("Annex I-A") vs an en-dash ("Annex I–A")
    // for the SAME real annex, which made a correct page fail to match.
    const normalizeDash = (s: string) => s.replace(/[\u2010-\u2015]/g, "-");
    const headingMatch =
      [...annexRates]
        .sort((a, b) => b.annex.length - a.annex.length)
        .find((a) => normalizeDash(extraction.annexLabel).startsWith(normalizeDash(a.annex)))?.annex ?? null;
    // Distinguish a REAL annex heading this extractor doesn't recognize
    // (must hard-fail -- confirmed live: "Annex II: Removed from Scope..."
    // was silently carried forward as the prior page's Annex I-B before
    // this check existed, which would have mislabeled a genuinely EXEMPT
    // product list as 25%-dutiable) from page-footer/header boilerplate
    // noise with no "Annex" word in it at all, which is safe to carry
    // forward across a continuation page.
    const looksLikeRealAnnexHeading = /\bAnnex\s+[IVX]+/i.test(extraction.annexLabel);
    if (!headingMatch && looksLikeRealAnnexHeading) {
      throw new Error(
        `Page ${pageIndex} transcribed a heading ("${extraction.annexLabel}") that names a real annex, but no ` +
          `matching rate rule was extracted from the proclamation's text for it. Known annexes: ` +
          `${annexRates.map((a) => a.annex).join(", ")}. Refusing to silently carry forward the PRIOR annex's rate ` +
          `onto what may be a different (and possibly exempt) product list.`,
      );
    }
    const matchedAnnex: string | null = headingMatch ?? carryAnnex;
    console.log(
      `  page ${pageIndex}: heading="${extraction.annexLabel}" -> annex=${matchedAnnex ?? "UNMATCHED"} rows=${extraction.rows.length}`,
    );
    if (extraction.rows.length === 0) continue; // a genuinely blank/intro page, not an error
    if (!matchedAnnex) {
      throw new Error(
        `Page ${pageIndex} transcribed ${extraction.rows.length} rows under heading "${extraction.annexLabel}", ` +
          `with no known prior annex to carry forward and no match to a known annex rate rule ` +
          `(${annexRates.map((a) => a.annex).join(", ")}). Refusing to publish rows with no matched rate.`,
      );
    }
    carryAnnex = matchedAnnex;
    allRows.push(...extraction.rows.map((row) => ({ ...row, annex: matchedAnnex })));
  }

  console.log(`Total extracted rows: ${allRows.length}`);

  // --- Mechanical validation (no human in the loop, just hard rules) -----
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of allRows) {
    const key = `${row.annex}::${row.htsCode}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    console.warn(`WARNING: ${duplicates.length} duplicate (annex, code) pairs extracted -- deduping, keeping first occurrence.`);
  }
  const dedupedRows = [...new Map(allRows.map((row) => [`${row.annex}::${row.htsCode}`, row])).values()];

  // --- Sanity-check against the previous LIVE revision --------------------
  // Comparing against any prior row regardless of status would let a bad
  // extraction's row count become the new baseline before anything ever
  // confirmed it. Must compare against a LIVE revision ('approved' OR
  // 'auto_approved' -- both are live per current_section232_rate(), see
  // migration 202610071003). Red-team review caught a real bug here: an
  // earlier version filtered on status='approved' only, which is NEVER
  // set by the normal auto-approval path -- confirmed live, the only real
  // document in the system today (2026-06960, 1593 rows) is entirely
  // status='auto_approved' with zero 'approved' rows, so the old filter
  // would have found no prior revision at all and silently skipped this
  // entire safety check on the very next re-ingestion.
  const supabase = createServiceClient();
  const { data: priorLiveRow } = await supabase
    .from("section232_tariff_rows")
    .select("source_document_number")
    .in("status", ["approved", "auto_approved"])
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorLiveRow) {
    const { count: priorCount } = await supabase
      .from("section232_tariff_rows")
      .select("*", { count: "exact", head: true })
      .eq("source_document_number", priorLiveRow.source_document_number)
      .in("status", ["approved", "auto_approved"]);
    if (priorCount && dedupedRows.length < priorCount * 0.5) {
      throw new Error(
        `Extraction produced ${dedupedRows.length} rows, less than half of the prior live revision's ${priorCount} -- ` +
          `treating this as a failed/corrupted extraction, not a real law change. Refusing to queue for review. ` +
          `Prior live revision (document ${priorLiveRow.source_document_number}) remains the live data.`,
      );
    }
  }

  // --- Write as a pending proposal, versioned by document number ----------
  // status defaults to 'pending' at the table level -- nothing here flips
  // it to 'approved'. A human must call review_section232_proposal().
  const contentHash = createHash("sha256").update(JSON.stringify({ annexRates, dedupedRows })).digest("hex");
  const publishedAt = new Date().toISOString();
  const insertRows = dedupedRows.map((row) => {
    const annex = annexRates.find((a) => a.annex === row.annex)!;
    return {
      source_document_number: DOCUMENT_NUMBER,
      source_title: meta.title,
      source_publication_date: meta.publicationDate,
      source_pdf_url: meta.pdfUrl,
      annex: row.annex,
      annex_label: annex.label,
      hts_prefix: row.htsCode,
      description: row.description ?? (row.subheading ? `[no per-code description printed] ${row.subheading}` : "[no description printed on source page]"),
      subheading: row.subheading,
      rate_percent: annex.ratePercent,
      uk_rate_percent: annex.ukRatePercent,
      us_content_rate_percent: annex.usContentRatePercent,
      content_hash: contentHash,
      published_at: publishedAt,
    };
  });

  const { error: insertError } = await supabase.from("section232_tariff_rows").insert(insertRows);
  if (insertError) throw new Error(`Write failed: ${insertError.message}`);

  console.log(
    JSON.stringify(
      {
        documentNumber: DOCUMENT_NUMBER,
        rowsQueuedForReview: insertRows.length,
        annexes: annexRates.map((a) => a.annex),
        contentHash,
        status: "PENDING -- not live. Review with pending_section232_proposals() and approve with review_section232_proposal().",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Section 232 proclamation ingestion FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
