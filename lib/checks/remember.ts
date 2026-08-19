import { z } from "zod";
import { addMemory } from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { completeJson, getProvider, type LlmProviderChoice } from "@/lib/llm";
import type { Memory } from "@/lib/db/schema";
import type { JurisdictionName } from "@/lib/countries";

/**
 * Pulls durable facts about the customer out of a finished chat exchange.
 *
 * Runs after the answer has already streamed, so it never delays a reply, and
 * failures are swallowed — missing a memory is a small loss, a broken chat is
 * not.
 *
 * Everything it produces lands `confirmed: false`. The model is inferring from
 * conversation, and this project's whole discipline is that inferred and
 * verified must stay visibly apart. A human promotes it on the Memory page.
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
          "other",
        ]),
        content: z
          .string()
          .describe("The fact, in one short sentence, written to be read months from now."),
        source: z.string().describe('Where it came from, e.g. "user said in chat".'),
        statedByUser: z
          .boolean()
          .describe(
            "True when the USER stated this fact about their own business, or asked for it to be " +
              "remembered. False when you inferred or derived it, or when it came from the " +
              "assistant's own research rather than from the customer.",
          ),
      }),
    )
    .describe("Empty array if nothing durable was established. That is the common case."),
});

const SYSTEM = `You extract durable facts about a customer from a chat exchange, for a compliance-monitoring tool's long-term memory.

Save only what would still matter in three months and would change how future checks are run or explained:
- the customer's real HS codes, product details, destination markets
- U.S. NAICS, facility addresses, materials/SDS, processes, waste streams, distribution states
- labels/claims, HTS/Schedule B, ECCN/EAR99, export destinations, and regulated-product flags
- KBLI, OSS/NIB/licensing status, SNI certificates or product-standard exposure
- factory/legal entity location for regional Perda monitoring
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
      // A fact the customer stated about their own business is theirs to
      // assert — the `human` tier in facts.ts, same reasoning as an uploaded
      // document (rule 5). Only genuinely *inferred* facts stay unconfirmed,
      // which is what the unconfirmed tier was always for. Before this, a
      // customer could say "our KBLI is 22292" and the monitor would keep
      // treating it as a guess forever unless they also clicked confirm.
      const inserted = await addMemory({
        customerId: input.customerId,
        jurisdiction: input.jurisdiction,
        kind: m.kind,
        content: m.content,
        source: m.source,
        origin: m.statedByUser ? "user-stated" : "chat",
        confirmed: m.statedByUser === true,
      });
      if (inserted) changed = true;
    }
    if (changed) await refreshChecklistForCustomer(input.customerId, input.jurisdiction);
  } catch {
    // Best effort by design — see the note above.
  }
}
