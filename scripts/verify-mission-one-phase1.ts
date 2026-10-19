import "./load-env";
import { applyStackingRules } from "../lib/tariff/stacking-rules";

async function main() {
  const resolved = await applyStackingRules("9903.03.12", { section_232_matched: true }, "2026-09-20");
  console.log("With section_232_matched=true:", JSON.stringify(resolved, null, 2));
  const needsReview = await applyStackingRules("9903.03.12", { section_232_matched: false }, "2026-09-20");
  console.log("With section_232_matched=false:", JSON.stringify(needsReview, null, 2));
  const unflagged = await applyStackingRules("unregistered_measure", {}, "2026-09-20");
  console.log("An unseeded measure:", JSON.stringify(unflagged, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
