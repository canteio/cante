import { getDefaultCustomerId } from "@/lib/db/queries";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Document audit — item 8.
 *
 * Upload posts text, not a binary. PDF/OCR is not implemented, and the error
 * message says so plainly instead of accepting a file and producing an empty,
 * clean-looking audit.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  if (documentId) {
    const document = getDocument(documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    return Response.json({ document, findings: listDocumentFindings(documentId) });
  }

  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ documents: [] });
  return Response.json({ documents: listDocuments(customerId) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const customerId = (payload.customerId as string) ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 400 });

  try {
    const action = (payload.action as string) ?? "ingest";

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

    return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (error) {
    if (error instanceof DocumentInputError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Document processing failed." }, { status: 500 });
  }
}
