import { resolveCustomerId } from "@/lib/db/queries";
import {
  deleteProduct,
  importProductsCsv,
  listProducts,
  upsertProduct,
} from "@/lib/catalogue/products";
import { listClassifications } from "@/lib/catalogue/classifications";
import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";
import { getDataBackend } from "@/lib/auth/config";
import { createClient } from "@/lib/supabase/server";
import { importCloudCatalogue } from "@/lib/chat/attachments";
import { randomUUID } from "node:crypto";

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
 * The product catalogue — item 2.
 *
 * POST accepts either one product or a CSV body. The CSV path returns the full
 * per-row outcome rather than a count, because "imported 388 of 400" without
 * naming the 12 is exactly the kind of useful-looking output rule 2 forbids.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ products: [] });

  if (getDataBackend() === "supabase") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*, product_classifications(*)")
      .eq("customer_id", customerId)
      .order("name");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      products: (data ?? []).map((row: any) => ({
        ...camel(row),
        classifications: camel(row.product_classifications ?? []).filter(
          (item: any) => !item.supersededAt,
        ),
      })),
    });
  }

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
    const customerId = await resolveCustomerId(form.get("customerId") as string | null);
    // Human/agent-fixable-error audit (final sweep): tell the caller exactly what
    // to pass instead of a bare "No customer." — matches lanes/suppliers/workqueue/etc.
    if (!customerId) {
      return Response.json(
        { error: "No customer could be resolved. Pass a valid `customerId` form field, or omit it to use the default customer if one exists." },
        { status: 400 }
      );
    }

    try {
      const extracted = await extractTextFromFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      const summary =
        getDataBackend() === "supabase"
          ? await importCloudCatalogue(customerId, extracted.text)
          : importProductsCsv(customerId, extracted.text);
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
  const customerId = await resolveCustomerId(payload.customerId as string | undefined);
  // Human/agent-fixable-error audit (final sweep): tell the caller exactly what
  // to pass instead of a bare "No customer." — matches lanes/suppliers/workqueue/etc.
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 400 }
    );
  }

  if (typeof payload.csv === "string") {
    const summary =
      getDataBackend() === "supabase"
        ? await importCloudCatalogue(customerId, payload.csv)
        : importProductsCsv(customerId, payload.csv);
    return Response.json({ summary });
  }

  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!sku || !name) {
    return Response.json({ error: "Both sku and name are required." }, { status: 400 });
  }

  const input = {
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
  };

  if (getDataBackend() === "supabase") {
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("products")
      .select("id")
      .eq("customer_id", customerId)
      .eq("sku", sku)
      .maybeSingle();
    if (readError) return Response.json({ error: readError.message }, { status: 500 });
    const values = {
      customer_id: customerId,
      sku,
      name,
      description: input.description ?? null,
      materials: input.materials,
      origin_country: input.originCountry ?? null,
      unit_of_measure: input.unitOfMeasure ?? null,
      unit_value: input.unitValue ?? null,
      currency: input.currency || "USD",
      product_class: input.productClass || "unknown",
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    };
    const query = existing
      ? supabase.from("products").update(values).eq("id", existing.id).select("*").single()
      : supabase.from("products").insert({ id: randomUUID(), ...values }).select("*").single();
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ product: camel(data), outcome: existing ? "updated" : "created" });
  }

  const result = upsertProduct(customerId, input);

  return Response.json(result);
}

export async function DELETE(request: Request) {
  // try/catch sweep (item 40+): createClient()/supabase calls below can throw
  // (bad env, network) rather than reject with a `.error` field — without this
  // guard that throw falls through to Next's HTML error page instead of JSON,
  // breaking any API client/agent parsing the response (same fix as logout,
  // lanes, memories, checklist, conversations routes).
  try {
    const url = new URL(request.url);
    const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
    const productId = url.searchParams.get("productId");
    if (!customerId || !productId) {
      return Response.json({ error: "customerId and productId are required." }, { status: 400 });
    }
    if (getDataBackend() === "supabase") {
      const supabase = await createClient();
      const { error, count } = await supabase
        .from("products")
        .delete({ count: "exact" })
        .eq("customer_id", customerId)
        .eq("id", productId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ deleted: Boolean(count) });
    }
    return Response.json({ deleted: deleteProduct(customerId, productId) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete product." },
      { status: 500 },
    );
  }
}
