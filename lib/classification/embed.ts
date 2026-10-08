import { z } from "zod";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 384;
// Standard synchronous endpoint, not the discounted Batch API.
export const EMBEDDING_USD_PER_MILLION_TOKENS = 0.02;
export interface EmbeddingUsage { calls: number; tokens: number; unknownUsageCalls: number; }
export const embeddingUsage = (): EmbeddingUsage => ({ calls: 0, tokens: 0, unknownUsageCalls: 0 });

/** UTF-8 bytes upper-bound BPE tokens; deliberately conservative, no truncation. */
export function embeddingBatches<T>(rows: T[], text: (row: T) => string): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [], bytes = 0;
  for (const row of rows) {
    const value = text(row);
    const size = Buffer.byteLength(value, "utf8");
    if (!value.trim() || size > 8000) throw new Error("Embedding input empty or exceeds conservative 8000-token bound");
    if (batch.length && (batch.length >= 75 || bytes + size > 8000)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(row); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function embedTexts(input: string[], options: { signal?: AbortSignal; usage?: EmbeddingUsage } = {}): Promise<number[][]> {
  if (embeddingBatches(input, (s) => s).length !== 1) throw new Error("Pass one bounded embedding batch");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required for HTS embeddings");
  const usage = options.usage ?? embeddingUsage();
  usage.calls++;
  usage.unknownUsageCalls++;
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float", input }),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`OpenAI embeddings HTTP ${response.status}`);
  const raw = await response.json();
  const tokens = z.number().int().nonnegative().parse(raw.usage?.prompt_tokens);
  usage.tokens += tokens;
  usage.unknownUsageCalls--;
  const data = z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
  })).length(input.length).parse(raw.data).sort((a, b) => a.index - b.index);
  if (data.some((row, i) => row.index !== i || !row.embedding.some((v) => v !== 0))) {
    throw new Error("Invalid embedding indexes or zero vector");
  }
  return data.map((row) => row.embedding);
}
