import "./load-env";
import { createServiceClient } from "../lib/supabase/service";
import { searchSemanticHeadings, unionCandidates } from "../lib/classification/semantic";
import { searchCandidateHeadings, searchTermsFor } from "../lib/classification/suggest";
import { embeddingUsage, EMBEDDING_USD_PER_MILLION_TOKENS } from "../lib/classification/embed";

const cases = [
  { name: "Black ABS 3mm Filament, 5lb Reel", description: "3D printer filament, ABS plastic, 3mm diameter", expected: /^3916\.90\.30(?:\.|$)/ },
  { name: "Female 8 pin Molex Connector Housing", description: "Plastic electrical connector housing, 8 position, for wire harness", expected: /^853[68]\./ },
  { name: "24AWG Stranded Wire - Purple", description: "Insulated stranded copper hookup wire, 24 AWG, no connector", expected: /^8544\.49(?:\.|$)/ },
];
async function main() {
  const client = createServiceClient();
  const usage = embeddingUsage();
  for (const item of cases) {
    const product = { name: item.name, description: item.description, materials: [] };
    try {
      const semantic = await searchSemanticHeadings(client, product, { usage });
      const keyword = await searchCandidateHeadings(searchTermsFor(product));
      const candidates = unionCandidates(keyword, semantic);
      const matches = candidates.filter((row) => item.expected.test(row.code)).map((row) => row.code);
      console.log(JSON.stringify({ ...product, passed: matches.length > 0, matches,
        semanticCodes: semantic.map((r) => r.code), candidateCodes: candidates.map((r) => r.code) }));
      if (!matches.length) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ ...product, verified: false, error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify({ ...usage, costUsdFromReportedUsage: usage.tokens * EMBEDDING_USD_PER_MILLION_TOKENS / 1_000_000 }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
