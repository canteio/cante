import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  componentSubstances,
  productComponents,
  restrictedSubstanceEntries,
  restrictedSubstanceLists,
  substances,
  type ProductComponent,
  type Substance,
} from "@/lib/db/schema";
import { listProducts } from "@/lib/catalogue/products";

/**
 * Bill of materials and substance matching.
 *
 * `products.materials` is a string array — enough to say "PVC coated
 * polyester", useless for PFAS, REACH or RoHS. Those rules restrict a
 * *substance*, at a *concentration*, inside a *component*, and a flat product
 * cannot answer the only question they ask: does any part of this article
 * contain a listed substance at or above threshold?
 *
 * Two disciplines carry over from the rest of the codebase:
 *
 * - **Tiers.** A substance declared on a supplier's material declaration is
 *   `document`; one a person entered is `human`; one inferred from a material
 *   keyword is `lead`. A keyword guess must never read like a declaration.
 * - **Unknown ≠ absent.** A component with no declaration is not a clean
 *   component. `assessRestrictions()` reports those separately as
 *   `undeclared`, because "we never asked" and "they said it's not in there"
 *   are the same distinction `lib/suppliers/evidence.ts` exists to preserve.
 */

export interface ComponentInput {
  productId: string;
  name: string;
  parentComponentId?: string | null;
  partNumber?: string | null;
  supplierId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  massGrams?: number | null;
  notes?: string | null;
}

export function addComponent(input: ComponentInput): ProductComponent {
  const row = {
    id: randomUUID(),
    productId: input.productId,
    parentComponentId: input.parentComponentId ?? null,
    name: input.name.trim(),
    partNumber: input.partNumber?.trim() || null,
    supplierId: input.supplierId ?? null,
    quantity: input.quantity ?? null,
    unit: input.unit?.trim() || null,
    massGrams: input.massGrams ?? null,
    notes: input.notes?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  db.insert(productComponents).values(row).run();
  return row as ProductComponent;
}

export function listComponents(productId: string): ProductComponent[] {
  return db
    .select()
    .from(productComponents)
    .where(eq(productComponents.productId, productId))
    .all();
}

/** Components as a tree, so an assembly reads the way an engineer drew it. */
export interface ComponentNode extends ProductComponent {
  children: ComponentNode[];
}

export function componentTree(productId: string): ComponentNode[] {
  const rows = listComponents(productId);
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] as ComponentNode[] }]));
  const roots: ComponentNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parentComponentId ? byId.get(node.parentComponentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function normaliseCas(cas: string): string {
  return cas.replace(/\s/g, "");
}

/** Find or create a substance. CAS is the identity when present. */
export function upsertSubstance(input: {
  name: string;
  casNumber?: string | null;
  ecNumber?: string | null;
  synonyms?: string[];
}): Substance {
  const cas = input.casNumber ? normaliseCas(input.casNumber) : null;

  if (cas) {
    const existing = db.select().from(substances).where(eq(substances.casNumber, cas)).get();
    if (existing) return existing;
  }

  const row = {
    id: randomUUID(),
    name: input.name.trim(),
    casNumber: cas,
    ecNumber: input.ecNumber?.trim() || null,
    synonyms: input.synonyms ?? [],
    createdAt: new Date().toISOString(),
  };
  db.insert(substances).values(row).run();
  return row as Substance;
}

export function declareSubstance(input: {
  componentId: string;
  substanceId: string;
  concentrationPpm?: number | null;
  tier?: string;
  basis: string;
  supplierDocumentId?: string | null;
}) {
  const row = {
    id: randomUUID(),
    componentId: input.componentId,
    substanceId: input.substanceId,
    concentrationPpm: input.concentrationPpm ?? null,
    tier: input.tier ?? "lead",
    basis: input.basis,
    supplierDocumentId: input.supplierDocumentId ?? null,
    createdAt: new Date().toISOString(),
  };
  db.insert(componentSubstances).values(row).run();
  return row;
}

export interface RestrictionHit {
  productSku: string;
  componentName: string;
  substanceName: string;
  casNumber: string | null;
  listName: string;
  jurisdiction: string;
  restriction: string;
  thresholdPpm: number | null;
  declaredPpm: number | null;
  /** over_threshold | present_unknown_amount | below_threshold | undeclared */
  verdict: "over_threshold" | "present_unknown_amount" | "below_threshold" | "undeclared";
  tier: string;
  detail: string;
}

export interface RestrictionAssessment {
  hits: RestrictionHit[];
  /** Components with no substance declaration at all — unknown, not clean. */
  undeclaredComponents: Array<{ productSku: string; componentName: string }>;
  caveats: string[];
}

/**
 * Check a customer's catalogue against the stored restriction lists.
 *
 * The four verdicts are deliberately distinct. `below_threshold` is a real
 * pass. `present_unknown_amount` is not a pass — the substance is there and
 * nobody stated how much. `undeclared` is not even that: nobody asked.
 * Collapsing these into "compliant / non-compliant" is the failure mode this
 * whole file exists to avoid.
 */
export function assessRestrictions(customerId: string): RestrictionAssessment {
  const products = listProducts(customerId);
  const hits: RestrictionHit[] = [];
  const undeclaredComponents: RestrictionAssessment["undeclaredComponents"] = [];
  const caveats: string[] = [];

  const lists = db.select().from(restrictedSubstanceLists).all();
  if (lists.length === 0) {
    return {
      hits: [],
      undeclaredComponents: [],
      caveats: [
        "No restricted-substance lists are loaded, so no restriction check was performed. This is a coverage gap, not a clean result.",
      ],
    };
  }

  const listById = new Map(lists.map((list) => [list.id, list]));
  const entries = db.select().from(restrictedSubstanceEntries).all();
  const entriesBySubstance = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = entriesBySubstance.get(entry.substanceId) ?? [];
    bucket.push(entry);
    entriesBySubstance.set(entry.substanceId, bucket);
  }

  for (const product of products) {
    const components = listComponents(product.id);
    if (components.length === 0) continue;

    const componentIds = components.map((c) => c.id);
    const declarations = componentIds.length
      ? db
          .select()
          .from(componentSubstances)
          .where(inArray(componentSubstances.componentId, componentIds))
          .all()
      : [];

    const declaredByComponent = new Map<string, typeof declarations>();
    for (const declaration of declarations) {
      const bucket = declaredByComponent.get(declaration.componentId) ?? [];
      bucket.push(declaration);
      declaredByComponent.set(declaration.componentId, bucket);
    }

    const substanceIds = [...new Set(declarations.map((d) => d.substanceId))];
    const substanceById = new Map(
      (substanceIds.length
        ? db.select().from(substances).where(inArray(substances.id, substanceIds)).all()
        : []
      ).map((s) => [s.id, s]),
    );

    for (const component of components) {
      const declared = declaredByComponent.get(component.id) ?? [];
      if (declared.length === 0) {
        undeclaredComponents.push({ productSku: product.sku, componentName: component.name });
        continue;
      }

      for (const declaration of declared) {
        const restrictionEntries = entriesBySubstance.get(declaration.substanceId) ?? [];
        if (restrictionEntries.length === 0) continue;
        const substance = substanceById.get(declaration.substanceId);
        if (!substance) continue;

        for (const entry of restrictionEntries) {
          const list = listById.get(entry.listId);
          if (!list) continue;

          let verdict: RestrictionHit["verdict"];
          let detail: string;

          if (declaration.concentrationPpm === null) {
            verdict = "present_unknown_amount";
            detail =
              `${substance.name} is declared present in ${component.name} with no stated concentration, and ` +
              `${list.name} restricts it${entry.thresholdPpm !== null ? ` at or above ${entry.thresholdPpm} ppm` : " at any level"}. ` +
              "Presence without an amount cannot be cleared.";
          } else if (entry.thresholdPpm === null || declaration.concentrationPpm >= entry.thresholdPpm) {
            verdict = "over_threshold";
            detail =
              `${substance.name} is declared at ${declaration.concentrationPpm} ppm in ${component.name}; ` +
              `${list.name} restricts it${entry.thresholdPpm !== null ? ` at or above ${entry.thresholdPpm} ppm` : " at any level"}.`;
          } else {
            verdict = "below_threshold";
            detail =
              `${substance.name} is declared at ${declaration.concentrationPpm} ppm in ${component.name}, below ` +
              `${list.name}'s ${entry.thresholdPpm} ppm threshold.`;
          }

          hits.push({
            productSku: product.sku,
            componentName: component.name,
            substanceName: substance.name,
            casNumber: substance.casNumber,
            listName: list.name,
            jurisdiction: list.jurisdiction,
            restriction: entry.restriction,
            thresholdPpm: entry.thresholdPpm,
            declaredPpm: declaration.concentrationPpm,
            verdict,
            tier: declaration.tier,
            detail,
          });
        }
      }
    }
  }

  if (undeclaredComponents.length > 0) {
    caveats.push(
      `${undeclaredComponents.length} component(s) have no substance declaration on file. They were NOT assessed and must not be read as clear — request a material declaration from the supplier.`,
    );
  }
  for (const list of lists) {
    caveats.push(
      `${list.name} (${list.jurisdiction}) was captured ${list.capturedAt.slice(0, 10)}${list.version ? `, version ${list.version}` : ""}. Restriction lists change; a stale snapshot can miss a recent addition.`,
    );
  }
  const leadTier = hits.filter((h) => h.tier === "lead").length;
  if (leadTier > 0) {
    caveats.push(
      `${leadTier} match(es) rest on lead-tier declarations that nobody has confirmed against a supplier document.`,
    );
  }

  return { hits, undeclaredComponents, caveats };
}

/**
 * Which products a regulation touches by substance rather than by tariff code.
 *
 * This is the join `matchProducts()` in lib/impact cannot make: a PFAS rule
 * names a chemical, not an HS heading, and the affected SKU is whichever one
 * has that chemical somewhere in its bill of materials.
 */
export function productsContainingSubstanceNamedIn(
  customerId: string,
  text: string,
): Array<{ productSku: string; componentName: string; substanceName: string; casNumber: string | null }> {
  const haystack = text.toLowerCase();
  const casMentioned = new Set(
    [...text.matchAll(/\b(\d{2,7}-\d{2}-\d)\b/g)].map((m) => normaliseCas(m[1])),
  );

  const all = db.select().from(substances).all();
  const matched = all.filter((substance) => {
    if (substance.casNumber && casMentioned.has(substance.casNumber)) return true;
    if (substance.name && haystack.includes(substance.name.toLowerCase())) return true;
    return substance.synonyms.some((synonym) => synonym && haystack.includes(synonym.toLowerCase()));
  });
  if (matched.length === 0) return [];

  const matchedIds = matched.map((s) => s.id);
  const declarations = db
    .select()
    .from(componentSubstances)
    .where(inArray(componentSubstances.substanceId, matchedIds))
    .all();
  if (declarations.length === 0) return [];

  const components = new Map(
    db
      .select()
      .from(productComponents)
      .where(inArray(productComponents.id, [...new Set(declarations.map((d) => d.componentId))]))
      .all()
      .map((c) => [c.id, c]),
  );
  const products = new Map(listProducts(customerId).map((p) => [p.id, p]));
  const substanceById = new Map(matched.map((s) => [s.id, s]));

  const out: Array<{ productSku: string; componentName: string; substanceName: string; casNumber: string | null }> = [];
  for (const declaration of declarations) {
    const component = components.get(declaration.componentId);
    if (!component) continue;
    const product = products.get(component.productId);
    if (!product) continue;
    const substance = substanceById.get(declaration.substanceId);
    if (!substance) continue;
    out.push({
      productSku: product.sku,
      componentName: component.name,
      substanceName: substance.name,
      casNumber: substance.casNumber,
    });
  }
  return out;
}

/** Load a restriction list snapshot. Kept explicit so provenance is recorded. */
export function loadRestrictionList(input: {
  name: string;
  jurisdiction: string;
  authority?: string | null;
  version?: string | null;
  sourceUrl?: string | null;
  entries: Array<{
    name: string;
    casNumber?: string | null;
    thresholdPpm?: number | null;
    restriction?: string;
    effectiveOn?: string | null;
    citation?: string | null;
  }>;
}) {
  const listId = randomUUID();
  db.transaction(() => {
    db.insert(restrictedSubstanceLists)
      .values({
        id: listId,
        name: input.name,
        jurisdiction: input.jurisdiction,
        authority: input.authority ?? null,
        version: input.version ?? null,
        sourceUrl: input.sourceUrl ?? null,
        capturedAt: new Date().toISOString(),
      })
      .run();

    for (const entry of input.entries) {
      const substance = upsertSubstance({ name: entry.name, casNumber: entry.casNumber });
      db.insert(restrictedSubstanceEntries)
        .values({
          id: randomUUID(),
          listId,
          substanceId: substance.id,
          thresholdPpm: entry.thresholdPpm ?? null,
          restriction: entry.restriction ?? "restricted",
          effectiveOn: entry.effectiveOn ?? null,
          citation: entry.citation ?? null,
        })
        .run();
    }
  });
  return listId;
}

/** Remove a component and everything declared on it. */
export function deleteComponent(componentId: string): void {
  db.transaction(() => {
    db.delete(componentSubstances).where(eq(componentSubstances.componentId, componentId)).run();
    db.delete(productComponents)
      .where(and(eq(productComponents.id, componentId)))
      .run();
  });
}
