import { withRequestLimit } from "@/app/api/request-limits";
import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";
import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { readOriginalUpload } from "../upload-store";
import { fileTables,tablePreviews } from "../tabular";
import { MAX_EXTRACTED_TEXT_CHARS } from "@/lib/documents/files-extract-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Read-only extraction. The chat upload endpoint retains the immutable original;
 * this route returns a bounded preview and table metadata, without approving law,
 * classifications, missing customs facts or computation provenance. */

export async function POST(request: Request) {
  return withRequestLimit(request, "upload", 15794176, handlePOST);
}
async function handlePOST(request: Request) {
  if(request.headers.get("content-type")?.includes("application/json")) {
    const body=await request.json().catch(()=>null);
    if(!isArchiveId(body?.uploadId))return Response.json({error:"Provide a saved uploadId, or send the file as multipart/form-data."},{status:400});
    const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401});
    try {
      const {file,bytes}=await readOriginalUpload(workspace.customerId,body?.uploadId);
      const extracted=await extractTextFromFile(file.filename,new Uint8Array(bytes));
      let originalCsv:string|undefined;
      if(extracted.format==="csv")try{originalCsv=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error("Save this CSV as UTF-8 and attach it again.");}
      const tables=tablePreviews(fileTables(extracted,originalCsv));
      return Response.json({uploadId:file.id,filename:file.filename,format:extracted.format,text:extracted.text.slice(0,MAX_EXTRACTED_TEXT_CHARS),tables,warnings:[...extracted.warnings,...(extracted.text.length>MAX_EXTRACTED_TEXT_CHARS?["Chat uses bounded excerpts. The complete original remains saved; all detected table rows are available to the live checker."]:[])]});
    }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not extract this original file."},{status:400});}
  }
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

  if (form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) return Response.json({ error: "Upload one file at a time." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "Files must be under 15 MiB." }, { status: 413 });

  try {
    const isCsv = /\.csv$/i.test(file.name);
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
