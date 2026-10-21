import { posix } from "node:path";
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

export interface ExtractedTable { label: string; rows: string[][]; requiresReview: boolean; issues: string[] }
const csvCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
export interface ExtractedFile {
  tables?: ExtractedTable[];
  text: string;
  format: ExtractedFormat;
  /** Real limits of what was read — surfaced to the user, never swallowed. */
  warnings: string[];
}

// Bound archive metadata before fflate allocates expanded XML buffers.
const MAX_ARCHIVE_EXPANDED_BYTES = 32 * 1024 * 1024;
function unzipBounded(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let entries = 0;
  return unzipSync(bytes, { filter(file) {
    total += file.originalSize;
    entries++;
    if (entries > 1000 || !Number.isSafeInteger(total) || total > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new FileExtractionError("Office archive exceeds the expanded-size or entry-count limit.");
    }
    return true;
  } });
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
    files = unzipBounded(bytes);
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
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

  const sheetLabels=new Map<string,{name:string;hidden:boolean}>();
  if(files["xl/workbook.xml"]&&files["xl/_rels/workbook.xml.rels"]){
    const rels=load(strFromU8(files["xl/_rels/workbook.xml.rels"]),{xmlMode:true});const targets=new Map<string,string>();
    rels("Relationship").each((_,element)=>{const item=rels(element);const target=item.attr("Target")??"";targets.set(item.attr("Id")??"",target.startsWith("/")?target.slice(1):posix.normalize("xl/"+target));});
    const book=load(strFromU8(files["xl/workbook.xml"]),{xmlMode:true});book("sheet").each((_,element)=>{const item=book(element);const target=targets.get(item.attr("r:id")??"");if(target)sheetLabels.set(target,{name:item.attr("name")??target,hidden:["hidden","veryHidden"].includes(item.attr("state")??"")});});
  }
  const sheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a,b)=>{const keys=[...sheetLabels.keys()];return keys.length?(keys.includes(a)?keys.indexOf(a):999)-(keys.includes(b)?keys.indexOf(b):999):a.localeCompare(b,undefined,{numeric:true});});
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
  const tables: ExtractedTable[] = []; let cellCount=0;
  for (const name of sheetNames) {
    const $ = load(strFromU8(files[name]), { xmlMode: true });
    const rows: string[][] = []; const issues: string[] = sheetLabels.get(name)?.hidden?["This worksheet is hidden in the workbook. Confirm it is the intended table."]:[];
    $("row").each((_, row) => {
      const cells: string[] = [];
      $(row)
        .find("c")
        .each((_i, cell) => {
          const $cell = $(cell);
          if(++cellCount>250000)throw new FileExtractionError("Spreadsheet exceeds the 250,000-cell extraction limit. Split the workbook.");
          const ref=$cell.attr("r")?.match(/^([A-Z]+)\d+$/)?.[1];
          const column=ref ? [...ref].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1 : cells.length;
          if(column<0||column>=100)throw new FileExtractionError("Spreadsheet exceeds the 100-column extraction limit.");
          while(cells.length<=column)cells.push("");
          if($cell.find("f").length&&!issues.length)issues.push("Formula cells use saved cached values; formulas are not recalculated. Verify them before checking.");
          const type = $cell.attr("t");
          if (type === "s") {
            // Shared string: <v> holds an index into the table.
            const index = Number($cell.find("v").text());
            cells[column]=sharedStrings[index] ?? "";
          } else if (type === "inlineStr") {
            cells[column]=$cell.find("t").text();
          } else {
            cells[column]=$cell.find("v").text();
          }
        });
      if (cells.some((cell) => cell.trim())) { rows.push(cells); lines.push(cells.map(csvCell).join(",")); }
      if(rows.length>20000)throw new FileExtractionError("A worksheet exceeds the 20,000-row extraction limit. Split it before checking.");
    });
    if(rows.length)tables.push({label:sheetLabels.get(name)?.name??name.replace("xl/worksheets/", "Worksheet "),rows,requiresReview:issues.length>0,issues});
  }

  if (lines.length === 0) {
    throw new FileExtractionError(
      "This spreadsheet opened but every cell was empty. Nothing was imported.",
    );
  }
  return { text: lines.join("\n"), format: "xlsx", warnings, tables };
}

/** Word stores paragraphs as <w:p>; without that split every line runs together. */
function extractDocx(bytes: Uint8Array): ExtractedFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipBounded(bytes);
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
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
  const tables: ExtractedTable[] = [];
  $("w\\:tbl, tbl").each((index,table)=>{
    const rows:string[][]=[];let cells=0;
    $(table).children("w\\:tr, tr").each((_,row)=>{
      const values:string[]=[];
      $(row).children("w\\:tc, tc").each((_,cell)=>{if(++cells>250000)throw new FileExtractionError("Word table exceeds the cell limit.");values.push($(cell).find("w\\:p, p").map((_i,p)=>$(p).find("w\\:t, t").map((_j,t)=>$(t).text()).get().join("")).get().join("\n"));});
      if(values.some(v=>v.trim()))rows.push(values);
    });
    if(rows.length>20000)throw new FileExtractionError("Word table exceeds the row limit.");
    const merged=$(table).find("w\\:gridSpan, gridSpan, w\\:vMerge, vMerge").length>0;
    if(rows.length)tables.push({label:`Word table ${index+1}`,rows,requiresReview:merged,issues:merged?["Merged Word cells require column review."]:[]});
  });
  return { text: paragraphs.join("\n"), format: "docx", warnings: [], tables };
}

/**
 * A PDF with no text layer is the dangerous case: it extracts to "" and would
 * otherwise look like a document that was read and found empty. Most Indonesian
 * PEBs are scans, so this path fires often and has to be unmistakable.
 */
async function extractPdf(bytes: Uint8Array): Promise<ExtractedFile> {
  let text: string;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    if(pdf.numPages>500)throw new FileExtractionError("PDF exceeds the 500-page extraction limit.");
    const lines:string[]=[];
    try {
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();
        const items=content.items.filter((v:any)=>typeof v.str==="string"&&v.str.trim()) as Array<{str:string;transform:number[];width:number}>;
        items.sort((a,b)=>Math.abs(a.transform[5]-b.transform[5])>3?b.transform[5]-a.transform[5]:a.transform[4]-b.transform[4]);
        let y:number|undefined;let end=0;let cells:string[]=[];
        const flush=()=>{if(cells.length)lines.push(cells.join("\t"));cells=[];};
        for(const item of items){const x=item.transform[4];if(y===undefined||Math.abs(y-item.transform[5])>3){flush();y=item.transform[5];end=x;}
          if(cells.length&&x-end<10)cells[cells.length-1]+=" "+item.str;else cells.push(item.str);end=x+item.width;
        }flush();page.cleanup();
        if(lines.length>30000||lines.reduce((n,line)=>n+line.length,0)>16*1024*1024)throw new FileExtractionError("PDF exceeds the extracted-text limit. Split it into smaller documents.");
      }
      text=lines.join("\n");
    }finally{await pdf.loadingTask.destroy();}
  } catch(error) {
    if(error instanceof FileExtractionError)throw error;
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
