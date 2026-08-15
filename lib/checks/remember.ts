import { z } from "zod";
import { addMemory } from "@/lib/db/queries";
import { completeJson, getProvider, type LlmProviderChoice } from "@/lib/llm";
import type { Memory } from "@/lib/db/schema";

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
          "market",
          "contact",
          "operational",
          "preference",
          "other",
        ]),
        content: z
          .string()
          .describe("The fact, in one short sentence, written to be read months from now."),
        source: z.string().describe('Where it came from, e.g. "user said in chat".'),
      }),
    )
    .describe("Empty array if nothing durable was established. That is the common case."),
});

const SYSTEM = `You extract durable facts about a customer from a chat exchange, for a compliance-monitoring tool's long-term memory.

Save only what would still matter in three months and would change how future checks are run or explained:
- the customer's real HS codes, product details, destination markets
- who to contact and how
- how they operate (shipping terms, certifications, licences, their broker)
- standing preferences about how they want to be told things

Do NOT save:
- anything already obvious from the stored run data
- one-off questions, or facts about regulations rather than about the customer
- anything the user did not actually assert — no guessing, no inference from a question
- restatements of something in the existing memory list

Returning an empty array is the correct and common answer. Never invent a fact to seem useful.`;

export async function extractMemories(input: {
  customerId: string;
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

    for (const m of value.memories) {
      await addMemory({
        customerId: input.customerId,
        kind: m.kind,
        content: m.content,
        source: m.source,
        origin: "chat",
        confirmed: false,
      });
    }
  } catch {
    // Best effort by design — see the note above.
  }
}
