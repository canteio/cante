import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";
import { MAX_EXTRACTED_TEXT_CHARS } from "@/lib/documents/files-extract-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn an uploaded file into text for the chat composer.
 *
 * Deliberately does **not** store anything. Dropping a file into a conversation
 * is asking a question about it, not filing it — a PEB becomes evidence only
 * through `/api/documents`, where the audit and the document-tier rules apply.
 * Keeping those separate is what stops "I asked the model about this invoice"
 * from turning into "this invoice is on file as verified".
 */

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return Response.json({ error: "Send the file as multipart/form-data." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "That upload could not be read." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  try {
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv && file.size > 1_000_000) {
      return Response.json({ error: "Chat tariff checks accept CSVs under 1 MB. Split larger files before uploading." }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let originalCsv: string | undefined;
    if (isCsv) {
      try {
        // Preserve BOM, line endings and every row, independently of the text preview.
        originalCsv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        return Response.json({ error: "Save this CSV as UTF-8 and upload it again." }, { status: 400 });
      }
    }
    const extracted = await extractTextFromFile(
      file.name,
      bytes,
    );

    const warnings = [...extracted.warnings];
    let text = extracted.text;
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
      // Truncation has to be stated. A model answering from the first half of a
      // document, with no indication the rest existed, is the same failure as a
      // source that silently parsed only its first page.
      text = text.slice(0, MAX_EXTRACTED_TEXT_CHARS);
      warnings.push(
        originalCsv !== undefined
          ? `The chat preview shows only ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString()} characters. The complete original CSV is included separately for saving and checking when you send it.`
          : `Only the first ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString()} characters were attached; this file is longer, so anything past that point was not read.`,
      );
    }

    return Response.json({
      filename: file.name,
      format: extracted.format,
      text,
      warnings,
      ...(originalCsv !== undefined ? { originalCsv } : {}),
    });
  } catch (error) {
    if (error instanceof FileExtractionError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // Keep unexpected failures machine-readable while preserving the original
    // error in server logs for diagnosis.
    console.error("Unexpected file extraction failure", error);
    return Response.json(
      { error: "The file could not be extracted because of an unexpected server error." },
      { status: 500 },
    );
  }
}
