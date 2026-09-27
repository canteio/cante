import { unzipSync, strFromU8 } from "fflate";
import { load } from "cheerio";
import {
  MAX_EXTRACTED_FILE_BYTES,
  type ExtractedFormat,
} from "./files-extract-contract";

/**
 * Turn an uploaded file into plain text, or refuse it clearly.
 *
 * Everything downstream — `ingestDocument()`, `importProductsCsv()` — already
 * works on text and is well tested. What was missing was only the step that
 * gets text *out of a file*, which is why documents had to be copy-pasted by
 * hand. This module is that step and nothing more: it does not judge, classify
 * or store anything.
 *
 * ## The rule this module exists to protect
 *
 * A file that could not really be read must never produce empty-but-clean
 * output. A scanned PEB yielding "" would sail through the audit and come back
 * with no discrepancies, which reads exactly like a document that was checked
 * and found correct. So every path here either returns text it actually
 * extracted, or throws `FileExtractionError` naming the reason — and the one
 * case that silently looks fine, a PDF with no text layer, is detected
 * explicitly rather than left to produce an empty string.
 *
 * ## Why these dependencies
 *
 * `.xlsx` and `.docx` are ZIP archives of XML. `fflate` unzips (~30KB) and
 * `cheerio` — already a dependency for source parsing — reads the XML, so the
 * two formats cost one small library between them rather than a spreadsheet
 * framework. `unpdf` extracts a PDF's embedded text layer. None of them do OCR,
 * and none of them call out to a network service, so rule 1 is untouched.
 */

export class FileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileExtractionError";
  }
}

export type { ExtractedFormat } from "./files-extract-contract";

export interface ExtractedFile {
  text: string;
  format: ExtractedFormat;
  /** Real limits of what was read — surfaced to the user, never swallowed. */
  warnings: string[];
}

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

/**
 * Excel stores cell text in a shared-string table and references it by index,
 * so a sheet read without that table yields numbers where the words should be.
 */
function extractXlsx(bytes: Uint8Array): ExtractedFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new FileExtractionError(
      "This .xlsx could not be opened. It may be corrupt, password-protected, or actually an older .xls file — re-save it as .xlsx or export it as CSV.",
    );
  }

  const sharedStrings: string[] = [];
  const sharedEntry = files["xl/sharedStrings.xml"];
  if (sharedEntry) {
    const $ = load(strFromU8(sharedEntry), { xmlMode: true });
    $("si").each((_, element) => {
      // A cell's text can be split across several <t> runs by formatting.
      sharedStrings.push($(element).find("t").map((_i, t) => $(t).text()).get().join(""));
    });
  }

  const sheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();
  if (sheetNames.length === 0) {
    throw new FileExtractionError("This .xlsx contains no worksheets.");
  }

  const warnings: string[] = [];
  if (sheetNames.length > 1) {
    warnings.push(
      `The workbook has ${sheetNames.length} sheets and all of them were read, in order. Check that the rows below are the ones you meant.`,
    );
  }

  const lines: string[] = [];
  for (const name of sheetNames) {
    const $ = load(strFromU8(files[name]), { xmlMode: true });
    $("row").each((_, row) => {
      const cells: string[] = [];
      $(row)
        .find("c")
        .each((_i, cell) => {
          const $cell = $(cell);
          const type = $cell.attr("t");
          if (type === "s") {
            // Shared string: <v> holds an index into the table.
            const index = Number($cell.find("v").text());
            cells.push(sharedStrings[index] ?? "");
          } else if (type === "inlineStr") {
            cells.push($cell.find("t").text());
          } else {
            cells.push($cell.find("v").text());
          }
        });
      if (cells.some((cell) => cell.trim())) lines.push(cells.join(","));
    });
  }

  if (lines.length === 0) {
    throw new FileExtractionError(
      "This spreadsheet opened but every cell was empty. Nothing was imported.",
    );
  }
  return { text: lines.join("\n"), format: "xlsx", warnings };
}

/** Word stores paragraphs as <w:p>; without that split every line runs together. */
function extractDocx(bytes: Uint8Array): ExtractedFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new FileExtractionError(
      "This .docx could not be opened. It may be corrupt, password-protected, or an older .doc file — re-save it as .docx.",
    );
  }

  const body = files["word/document.xml"];
  if (!body) {
    throw new FileExtractionError("This .docx has no readable document body.");
  }

  const $ = load(strFromU8(body), { xmlMode: true });
  const paragraphs: string[] = [];
  $("w\\:p, p").each((_, element) => {
    const text = $(element)
      .find("w\\:t, t")
      .map((_i, t) => $(t).text())
      .get()
      .join("");
    if (text.trim()) paragraphs.push(text);
  });

  // Word tables are where a document's line items usually live, and each cell
  // is itself a <w:p> — already captured above, one cell per line.
  if (paragraphs.length === 0) {
    throw new FileExtractionError(
      "This Word file opened but contained no text. If it is a scanned image pasted into Word, it cannot be read — OCR is not supported.",
    );
  }
  return { text: paragraphs.join("\n"), format: "docx", warnings: [] };
}

/**
 * A PDF with no text layer is the dangerous case: it extracts to "" and would
 * otherwise look like a document that was read and found empty. Most Indonesian
 * PEBs are scans, so this path fires often and has to be unmistakable.
 */
async function extractPdf(bytes: Uint8Array): Promise<ExtractedFile> {
  let text: string;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } catch {
    throw new FileExtractionError(
      "This PDF could not be opened. It may be corrupt or password-protected.",
    );
  }

  if (!text.replace(/\s/g, "")) {
    throw new FileExtractionError(
      "This PDF has no text layer — it is a scan or photo, and reading it would need OCR, which is not supported. " +
        "Open it, select the text and paste it, or ask the sender for the original digital file.",
    );
  }
  return { text, format: "pdf", warnings: [] };
}

/**
 * Extract text from an uploaded file. Throws `FileExtractionError` with a
 * user-readable reason for anything it cannot honestly read.
 */
export async function extractTextFromFile(
  filename: string,
  bytes: Uint8Array,
): Promise<ExtractedFile> {
  if (bytes.byteLength === 0) throw new FileExtractionError("That file is empty.");
  if (bytes.byteLength > MAX_EXTRACTED_FILE_BYTES) {
    throw new FileExtractionError(
      `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${MAX_EXTRACTED_FILE_BYTES / 1024 / 1024}MB limit. A trade document this large is usually a scan, which cannot be read anyway.`,
    );
  }

  switch (extensionOf(filename)) {
    case "xlsx":
    case "xlsm":
      return extractXlsx(bytes);
    case "docx":
      return extractDocx(bytes);
    case "pdf":
      return extractPdf(bytes);
    case "csv":
      return { text: strFromU8(bytes), format: "csv", warnings: [] };
    case "txt":
    case "md":
    case "text":
      return { text: strFromU8(bytes), format: "text", warnings: [] };
    case "xls":
      throw new FileExtractionError(
        "Old .xls files are not supported. Open it in Excel and save as .xlsx or CSV.",
      );
    case "doc":
      throw new FileExtractionError(
        "Old .doc files are not supported. Open it in Word and save as .docx.",
      );
    case "":
      throw new FileExtractionError("That file has no extension, so its format is unknown.");
    default:
      throw new FileExtractionError(
        `Files of type .${extensionOf(filename)} are not supported. Use PDF (with real text), .xlsx, .docx, .csv or .txt.`,
      );
  }
}
