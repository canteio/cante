import { resolveCustomerId } from "@/lib/db/queries";
import {
  auditDocument,
  DocumentInputError,
  getDocument,
  ingestDocument,
  listDocumentFindings,
  listDocuments,
  priceDocumentFindings,
  promoteCodesFromDocument,
} from "@/lib/documents/audit";
import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";
import { getDataBackend } from "@/lib/auth/config";
import { createClient } from "@/lib/supabase/server";
import { fileAttachments } from "@/lib/chat/attachments";
import { normalizeJurisdiction } from "@/lib/countries";
import { DOCUMENTS_ACTIONS } from "@/lib/documents/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function camel(value: any): any {
  if (Array.isArray(value)) return value.map(camel);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camel(item),
    ]),
  );
}

/**
 * Document audit — item 8.
 *
 * Accepts either JSON with pasted text, or a multipart upload of .pdf / .xlsx /
 * .docx / .csv / .txt, which `extractTextFromFile()` converts to text before the
 * existing pipeline runs unchanged. Still no OCR: a scanned PDF is rejected with
 * a reason rather than accepted and turned into an empty, clean-looking audit.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  if (getDataBackend() === "supabase") {
    const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
    if (!customerId) return Response.json({ documents: [] });
    const supabase = await createClient();
    if (documentId) {
      const { data: document, error } = await supabase
        .from("trade_documents")
        .select("*")
        .eq("customer_id", customerId)
        .eq("id", documentId)
        .maybeSingle();
      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
      const { data: findings, error: findingsError } = await supabase
        .from("document_findings")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at");
      if (findingsError) return Response.json({ error: findingsError.message }, { status: 500 });
      return Response.json({ document: camel(document), findings: camel(findings ?? []) });
    }
    const { data, error } = await supabase
      .from("trade_documents")
      .select("*")
      .eq("customer_id", customerId)
      .order("uploaded_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ documents: camel(data ?? []) });
  }
  if (documentId) {
    const document = getDocument(documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    return Response.json({ document, findings: listDocumentFindings(documentId) });
  }

  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ documents: [] });
  return Response.json({ documents: listDocuments(customerId) });
}

export async function POST(request: Request) {
  // A file upload arrives as multipart. Extract the text here, then fall
  // through to exactly the same ingest path a pasted document takes — the
  // parser, audit and tier rules must not learn that files exist.
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
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
    const customerId = await resolveCustomerId(form.get("customerId") as string | null);
    // "No customer." gave a caller nothing to act on; same self-correct-from-response-body
    // bar as profiles/checklist/import-monitor — name the fix, not just the failure.
    if (!customerId) {
      return Response.json(
        { error: "No customer could be resolved. Include a valid `customerId` field in the multipart form data, or omit it to use the default customer if one exists." },
        { status: 400 },
      );
    }

    let extracted;
    try {
      extracted = await extractTextFromFile(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof FileExtractionError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    try {
      if (getDataBackend() === "supabase") {
        const [outcome] = await fileAttachments(
          customerId,
          normalizeJurisdiction(form.get("country") as string | null),
          [{ filename: file.name, format: extracted.format, text: extracted.text }],
        );
        if (!outcome.documentId) {
          return Response.json({ error: outcome.caveats.join(" ") }, { status: 400 });
        }
        const supabase = await createClient();
        const { data: document, error } = await supabase
          .from("trade_documents")
          .select("*")
          .eq("id", outcome.documentId)
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({
          document: camel(document),
          findings: [],
          extraction: { format: extracted.format, warnings: extracted.warnings },
          caveats: outcome.caveats,
        });
      }
      const document = ingestDocument({
        customerId,
        docType: (form.get("docType") as string) ?? "other",
        filename: file.name,
        text: extracted.text,
      });
      const findings = auditDocument(document.id);
      return Response.json({
        document,
        findings,
        // The reader has to know a multi-sheet workbook was flattened, or which
        // format was read — silent normalisation is how wrong rows look right.
        extraction: { format: extracted.format, warnings: extracted.warnings },
      });
    } catch (error) {
      if (error instanceof DocumentInputError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  // Reject primitives before property access so API clients receive the documented 400,
  // not an opaque 500 for JSON such as null or [].
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must be a JSON object.", validActions: DOCUMENTS_ACTIONS },
      { status: 400 },
    );
  }
  const payload = body as Record<string, unknown>;
  const customerId = await resolveCustomerId(payload.customerId as string | undefined);
  // Same fix: tell the caller exactly what to pass instead of a bare "No customer."
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 400 },
    );
  }

  try {
    const action = (payload.action as string) ?? "ingest";

    if (getDataBackend() === "supabase") {
      if (action !== "ingest") {
        return Response.json(
          { error: "Customs-grade audit, pricing, and code promotion run on the trusted worker." },
          { status: 409 },
        );
      }
      const [outcome] = await fileAttachments(
        customerId,
        normalizeJurisdiction(payload.country as string | undefined),
        [{
          filename: (payload.filename as string) ?? "pasted.txt",
          format: "text",
          text: (payload.text as string) ?? "",
        }],
      );
      if (!outcome.documentId) {
        return Response.json({ error: outcome.caveats.join(" ") }, { status: 400 });
      }
      const supabase = await createClient();
      const { data: document, error } = await supabase
        .from("trade_documents")
        .select("*")
        .eq("id", outcome.documentId)
        .single();
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ document: camel(document), findings: [], caveats: outcome.caveats });
    }

    if (action === "ingest") {
      const document = ingestDocument({
        customerId,
        docType: (payload.docType as string) ?? "other",
        filename: (payload.filename as string) ?? "pasted.txt",
        text: (payload.text as string) ?? "",
      });
      // Audit immediately — an uploaded document nobody checked is worth
      // nothing, and the parse status travels with the result either way.
      auditDocument(document.id);
      // Price the mismatches straight away: a code discrepancy without its
      // duty consequence is the compliance half of a business fact.
      await priceDocumentFindings(document.id).catch(() => undefined);
      return Response.json({ document, findings: listDocumentFindings(document.id) });
    }

    if (action === "audit") {
      const documentId = payload.documentId as string;
      if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
      auditDocument(documentId);
      await priceDocumentFindings(documentId).catch(() => undefined);
      return Response.json({ findings: listDocumentFindings(documentId) });
    }

    if (action === "price") {
      const documentId = payload.documentId as string;
      if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
      return Response.json({ findings: await priceDocumentFindings(documentId) });
    }

    if (action === "promote") {
      const documentId = payload.documentId as string;
      if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
      return Response.json(promoteCodesFromDocument(documentId));
    }

    return Response.json(
      { error: `Unknown action "${action}".`, validActions: DOCUMENTS_ACTIONS },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof DocumentInputError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Document processing failed." }, { status: 500 });
  }
}
