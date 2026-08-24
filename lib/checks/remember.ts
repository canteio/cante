import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addMemory } from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { completeJson, getProvider, type LlmProviderChoice } from "@/lib/llm";
import { db } from "@/lib/db/client";
import { kbliRecords, suppliers, type Memory } from "@/lib/db/schema";
import { upsertProduct } from "@/lib/catalogue/products";
import type { JurisdictionName } from "@/lib/countries";
import { getDataBackend } from "@/lib/auth/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Pulls durable facts about the customer out of a finished chat exchange.
 *
 * Runs after the answer has already streamed, so it never delays a reply, and
 * failures are swallowed — missing a memory is a small loss, a broken chat is
 * not.
 *
 * Automatically populates the Customer Profile, Checklist, Catalogue, and
 * Operations records with facts stated during chat conversations.
 */

const ExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        kind: z.enum([
          "product",
          "hs_code",
          "naics",
          "material",
          "process",
          "waste",
          "distribution_state",
          "label_claim",
          "export_classification",
          "product_flag",
          "kbli",
          "market",
          "location",
          "license",
          "sni",
          "tax",
          "contact",
          "operational",
          "preference",
          "supplier",
          "other",
        ]),
        content: z
          .string()
          .describe("The fact, in one short sentence, written to be read months from now."),
        source: z.string().describe("Where it came from, e.g. \"user said in chat\"."),
        statedByUser: z
          .boolean()
          .describe(
            "True when the USER stated this fact about their own business, or asked for it to be " +
              "remembered. False when you inferred or derived it, or when it came from the " +
              "assistant\x27s own research rather than from the customer.",
          ),
      }),
    )
    .describe("Empty array if nothing durable was established. That is the common case."),
});

const SYSTEM = `You extract durable facts about a customer from a chat exchange, for a compliance-monitoring tool\x27s long-term memory.

Save only what would still matter in three months and would change how future checks are run or explained:
- the customer\x27s real HS codes, product details, destination markets
- U.S. NAICS, facility addresses, materials/SDS, processes, waste streams, distribution states
- labels/claims, HTS/Schedule B, ECCN/EAR99, export destinations, and regulated-product flags
- KBLI, OSS/NIB/licensing status, SNI certificates or product-standard exposure
- factory/legal entity location for regional Perda monitoring
- suppliers, vendors, and raw material origins
- who to contact and how
- how they operate (shipping terms, certifications, licences, their broker)
- standing preferences about how they want to be told things

Do NOT save:
- anything already obvious from the stored run data
- one-off questions, or facts about regulations rather than about the customer
- anything the user did not actually assert — no guessing, no inference from a question
- restatements of something in the existing memory list

Set statedByUser truthfully — it decides whether the fact is trusted immediately or waits for a human to confirm it. The customer is the authority on their own business, so anything they told you about themselves is true: their codes, their locations, their markets, their products, and anything they asked you to remember. Set it false only when the fact came from your own inference or research rather than from them.

Returning an empty array is the correct and common answer. Never invent a fact to seem useful.`;

export async function extractMemories(input: {
  customerId: string;
  jurisdiction: JurisdictionName;
  question: string;
  answer: string;
  existing: Memory[];
  providerChoice?: LlmProviderChoice;
}): Promise<void> {
  try {
    const provider = getProvider(input.providerChoice);
    const existingList = input.existing.length
      ? input.existing.map((m) => `  - ${m.content}`).join("\n")
      : "  (nothing yet)";

    const { value } = await completeJson(provider, ExtractionSchema, {
      system: SYSTEM,
      prompt:
        `## Already remembered — do not repeat these\n\n${existingList}\n\n` +
        `## The exchange\n\n**User:** ${input.question}\n\n**Assistant:** ${input.answer}\n\n` +
        `Extract any durable new facts about the customer.`,
      timeoutMs: 120_000,
    });

    let changed = false;
    for (const m of value.memories) {
      const inserted = await addMemory({
        customerId: input.customerId,
        jurisdiction: input.jurisdiction,
        kind: m.kind === "supplier" ? "contact" : m.kind,
        content: m.content,
        source: m.source,
        origin: m.statedByUser ? "user-stated" : "chat",
        confirmed: m.statedByUser === true,
      });
      if (inserted) {
        changed = true;

        // Auto-sync into operations tables if stated by user
        if (m.statedByUser && getDataBackend() === "supabase") {
          try {
            const supabase = await createClient();
            if (m.kind === "product" || m.kind === "material") {
              const skuSeed = m.content.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "-").toUpperCase();
              const sku = skuSeed.length >= 3 ? skuSeed : `SKU-${Date.now().toString().slice(-4)}`;
              const { data: existing } = await supabase
                .from("products")
                .select("id")
                .eq("customer_id", input.customerId)
                .eq("sku", sku)
                .maybeSingle();
              if (!existing) {
                await supabase.from("products").insert({
                  id: randomUUID(),
                  customer_id: input.customerId,
                  sku,
                  name: m.content,
                  materials: m.kind === "material" ? [m.content] : [],
                });
              }
            }
            if (m.kind === "kbli") {
              const code = m.content.match(/\b\d{5}\b/)?.[0];
              if (code) {
                const { data: existing } = await supabase
                  .from("kbli_records")
                  .select("id")
                  .eq("customer_id", input.customerId)
                  .eq("code", code)
                  .maybeSingle();
                if (!existing) {
                  await supabase.from("kbli_records").insert({
                    id: randomUUID(),
                    customer_id: input.customerId,
                    code,
                    title: m.content,
                    confirmed: true,
                    status: "confirmed",
                    source: "chat",
                  });
                }
              }
            }
            if (m.kind === "supplier" || m.content.toLowerCase().includes("supplier")) {
              await supabase.from("suppliers").insert({
                id: randomUUID(),
                customer_id: input.customerId,
                name: m.content.slice(0, 60),
                country: input.jurisdiction === "Indonesia" ? "ID" : "US",
              });
            }
          } catch {
            // The memory itself is already durable; operations sync is best effort.
          }
        } else if (m.statedByUser) {
          // 1. Sync Products and Raw Materials into Catalogue
          if (m.kind === "product" || m.kind === "material") {
            try {
              const skuSeed = m.content.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "-").toUpperCase();
              const sku = skuSeed.length >= 3 ? skuSeed : `SKU-${Date.now().toString().slice(-4)}`;
              upsertProduct(input.customerId, {
                sku,
                name: m.content,
                materials: m.kind === "material" ? [m.content] : undefined,
              });
            } catch {
              // Non-blocking
            }
          }

          // 2. Sync KBLI records
          if (m.kind === "kbli") {
            try {
              const codeMatch = m.content.match(/\b\d{5}\b/);
              if (codeMatch) {
                db.insert(kbliRecords)
                  .values({
                    id: randomUUID(),
                    customerId: input.customerId,
                    code: codeMatch[0],
                    title: m.content,
                    confirmed: true,
                    status: "confirmed",
                    source: "chat",
                  })
                  .onConflictDoNothing()
                  .run();
              }
            } catch {
              // Non-blocking
            }
          }

          // 3. Sync Suppliers
          if (m.kind === "supplier" || m.content.toLowerCase().includes("supplier")) {
            try {
              db.insert(suppliers)
                .values({
                  id: randomUUID(),
                  customerId: input.customerId,
                  name: m.content.slice(0, 60),
                  country: input.jurisdiction === "Indonesia" ? "ID" : "US",
                })
                .onConflictDoNothing()
                .run();
            } catch {
              // Non-blocking
            }
          }
        }
      }
    }
    if (changed && getDataBackend() === "sqlite") {
      await refreshChecklistForCustomer(input.customerId, input.jurisdiction);
    }
  } catch {
    // Best effort by design — see the note above.
  }
}
