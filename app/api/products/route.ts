import { getDefaultCustomerId } from "@/lib/db/queries";
import {
  deleteProduct,
  importProductsCsv,
  listProducts,
  upsertProduct,
} from "@/lib/catalogue/products";
import { listClassifications } from "@/lib/catalogue/classifications";
import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The product catalogue — item 2.
 *
 * POST accepts either one product or a CSV body. The CSV path returns the full
 * per-row outcome rather than a count, because "imported 388 of 400" without
 * naming the 12 is exactly the kind of useful-looking output rule 2 forbids.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ products: [] });

  const products = listProducts(customerId);
  const withCodes = products.map((product) => ({
    ...product,
    classifications: listClassifications(product.id).filter((c) => !c.supersededAt),
  }));
  return Response.json({ products: withCodes });
}

export async function POST(request: Request) {
  // An .xlsx of SKUs and HS codes is the realistic way a catalogue arrives.
  // It is converted to CSV text and handed to the same importer, so the tier
  // rule still holds: a spreadsheet can only ever produce `lead` codes.
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
    const customerId = (form.get("customerId") as string) || (await getDefaultCustomerId());
    if (!customerId) return Response.json({ error: "No customer." }, { status: 400 });

    try {
      const extracted = await extractTextFromFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      const summary = importProductsCsv(customerId, extracted.text);
      return Response.json({
        summary,
        extraction: { format: extracted.format, warnings: extracted.warnings },
      });
    } catch (error) {
      if (error instanceof FileExtractionError) {
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

  const payload = body as Record<string, unknown>;
  const customerId = (payload.customerId as string) ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 400 });

  if (typeof payload.csv === "string") {
    const summary = importProductsCsv(customerId, payload.csv);
    return Response.json({ summary });
  }

  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!sku || !name) {
    return Response.json({ error: "Both sku and name are required." }, { status: 400 });
  }

  const result = upsertProduct(customerId, {
    sku,
    name,
    description: payload.description as string | null,
    materials: Array.isArray(payload.materials) ? (payload.materials as string[]) : [],
    originCountry: payload.originCountry as string | null,
    unitOfMeasure: payload.unitOfMeasure as string | null,
    unitValue: typeof payload.unitValue === "number" ? payload.unitValue : null,
    currency: payload.currency as string | null,
    productClass: payload.productClass as string | null,
    notes: payload.notes as string | null,
  });

  return Response.json(result);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  const productId = url.searchParams.get("productId");
  if (!customerId || !productId) {
    return Response.json({ error: "customerId and productId are required." }, { status: 400 });
  }
  return Response.json({ deleted: deleteProduct(customerId, productId) });
}
