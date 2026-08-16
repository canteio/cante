import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  checklistItems,
  customerProfiles,
  customers,
  kbliRecords,
  memories,
  type ChecklistItem,
  type Memory,
} from "@/lib/db/schema";

type ChecklistStatus =
  | "unknown"
  | "required"
  | "not_required"
  | "completed"
  | "expiring"
  | "blocked"
  | "needs_review";

type ChecklistDraft = {
  title: string;
  category: string;
  status: ChecklistStatus;
  priority: "low" | "medium" | "high";
  whyApplies: string;
  linkedFacts: string[];
  evidenceRequired: string;
  sourceHealth: "working" | "manual_assisted" | "untested" | "not_checked" | "failed" | "blocked";
  confidence: "verified" | "lead" | "inferred";
  openQuestions: string[];
  origin?: string;
};

const kbliCodeRe = /\b\d{5}\b/g;

/**
 * Rebuilds the customer's living compliance checklist from profile data,
 * KBLI records, and memory. This intentionally creates review tasks instead
 * of silently upgrading unconfirmed chat leads into verified compliance facts.
 */
export async function refreshChecklistForCustomer(customerId: string): Promise<void> {
  const customer = db.select().from(customers).where(eq(customers.id, customerId)).get();
  const profile = db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.customerId, customerId))
    .get();
  if (!customer || !profile) return;

  const memoryRows = db.select().from(memories).where(eq(memories.customerId, customerId)).all();
  await rememberKbliLeads(customerId, memoryRows);

  const kbliRows = db.select().from(kbliRecords).where(eq(kbliRecords.customerId, customerId)).all();
  const confirmedMemories = memoryRows.filter((m) => m.confirmed);
  const unconfirmedMemories = memoryRows.filter((m) => !m.confirmed);
  const confirmedKbli = kbliRows.filter((k) => k.confirmed || k.status === "confirmed");
  const unconfirmedKbli = kbliRows.filter((k) => !k.confirmed && k.status !== "confirmed");
  const profileKbli = profile.kbliCodes ?? [];
  const confirmedHs =
    profile.hsCodesConfirmed || confirmedMemories.some((m) => m.kind === "hs_code");
  const hsLeads = [
    ...profile.hsCodes.filter((h) => !h.confirmed).map((h) => `HS ${h.code}: ${h.basis}`),
    ...unconfirmedMemories.filter((m) => m.kind === "hs_code").map((m) => m.content),
  ];
  const products = [
    profile.productDescription,
    ...memoryRows.filter((m) => m.kind === "product").map((m) => m.content),
  ].filter(Boolean);
  const locationFacts = [
    customer.city ? `${customer.city}, ${customer.country}` : customer.country,
    ...memoryRows
      .filter((m) => m.kind === "location" || /\b(factory|address|lokasi|pabrik|surabaya|jawa timur|east java)\b/i.test(m.content))
      .map((m) => m.content),
  ].filter(Boolean);

  const drafts: ChecklistDraft[] = [
    {
      title: "Confirm real KBLI from OSS/NIB",
      category: "kbli",
      status:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? "completed"
          : unconfirmedKbli.length > 0
            ? "needs_review"
            : "needs_review",
      priority: "high",
      whyApplies:
        "KBLI is the bridge between the company profile and Indonesian licensing, OSS risk, sector rules, and future regulatory checks.",
      linkedFacts: [
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}${k.title ? ` - ${k.title}` : ""}`),
      ],
      evidenceRequired: "OSS/NIB document or screenshot showing the registered KBLI and business activity.",
      sourceHealth: confirmedKbli.length > 0 ? "manual_assisted" : "not_checked",
      confidence: confirmedKbli.length > 0 || profileKbli.length > 0 ? "verified" : "lead",
      openQuestions:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? []
          : ["Which KBLI codes are printed on the current OSS/NIB?"],
    },
    {
      title: "Confirm HS codes from PEB or invoice",
      category: "trade",
      status: confirmedHs ? "completed" : "needs_review",
      priority: "high",
      whyApplies:
        "HS codes decide which export, tariff, customs, and standards changes are relevant. Guessed HS codes must stay visibly unconfirmed.",
      linkedFacts: [
        ...profile.hsCodes.map((h) => `HS ${h.code}: ${h.basis}${h.confirmed ? " (confirmed)" : " (unconfirmed)"}`),
        ...hsLeads,
      ],
      evidenceRequired: "PEB, commercial invoice, packing list, or broker confirmation showing the actual shipped HS code.",
      sourceHealth: "manual_assisted",
      confidence: confirmedHs ? "verified" : "lead",
      openQuestions: confirmedHs ? [] : ["Which HS code appears on the last real export document?"],
    },
    {
      title: "Check OSS licensing requirements for each KBLI",
      category: "oss",
      status: confirmedKbli.length > 0 || profileKbli.length > 0 ? "required" : "needs_review",
      priority: "high",
      whyApplies:
        "OSS determines risk level, business licensing status, and permits/certificates tied to KBLI.",
      linkedFacts: [
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}${k.ossLicenseType ? `: ${k.ossLicenseType}` : ""}`),
      ],
      evidenceRequired: "OSS licensing status, risk level, and any attached sector permit requirement.",
      sourceHealth: "manual_assisted",
      confidence: confirmedKbli.length > 0 || profileKbli.length > 0 ? "inferred" : "lead",
      openQuestions:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? ["Has the OSS business licensing status changed since the NIB was issued?"]
          : ["Confirm KBLI first, then map OSS obligations."],
    },
    {
      title: "Screen mandatory SNI exposure",
      category: "sni",
      status: products.length > 0 ? "needs_review" : "unknown",
      priority: "medium",
      whyApplies:
        "BSN/SNI obligations are product-specific, and should be checked from the actual product description plus HS code.",
      linkedFacts: products,
      evidenceRequired: "Product specs, SKUs, SNI certificate if any, and a BSN/SNI lookup result.",
      sourceHealth: "untested",
      confidence: "lead",
      openQuestions: ["Is PVC tarpaulin sold under any mandatory SNI category or sector technical rule?"],
    },
    {
      title: "Monitor Kemenkeu, DJBC, and DJP tax-customs changes",
      category: "tax_customs",
      status: "needs_review",
      priority: "medium",
      whyApplies:
        "Exporters can be affected by PMK, Bea Cukai, and tax-administration changes even when trade-ministry feeds are quiet.",
      linkedFacts: [
        `Trade side: ${profile.sideOfTrade}`,
        ...profile.destinationMarkets.map((market) => `Destination: ${market}`),
      ],
      evidenceRequired: "PMK/DJBC/DJP source check, broker notes, and any current facility status.",
      sourceHealth: "untested",
      confidence: "lead",
      openQuestions: ["Does the customer use any bonded-zone, KITE, VAT, or customs facility?"],
    },
    {
      title: "Add regional Perda and Perkada monitoring location",
      category: "regional",
      status: locationFacts.length > 0 ? "completed" : "needs_review",
      priority: "medium",
      whyApplies:
        "Perda and Perkada coverage depends on the factory and legal-entity location, not just country.",
      linkedFacts: locationFacts,
      evidenceRequired: "Factory address and legal entity domicile.",
      sourceHealth: "manual_assisted",
      confidence: locationFacts.length > 0 ? "inferred" : "lead",
      openQuestions: locationFacts.length > 0 ? [] : ["What city/regency and province should regional monitoring cover?"],
    },
    {
      title: "Review unconfirmed memory leads",
      category: "memory",
      status: unconfirmedMemories.length > 0 ? "needs_review" : "completed",
      priority: unconfirmedMemories.length > 0 ? "high" : "low",
      whyApplies:
        "Chat can make the monitor smarter only after a person confirms which remembered facts are real.",
      linkedFacts: unconfirmedMemories.map((m) => `[${m.kind}] ${m.content}`),
      evidenceRequired: "Open Memory and confirm, edit, or delete each lead.",
      sourceHealth: "manual_assisted",
      confidence: unconfirmedMemories.length > 0 ? "lead" : "verified",
      openQuestions:
        unconfirmedMemories.length > 0
          ? [`${unconfirmedMemories.length} memory lead(s) still need human confirmation.`]
          : [],
    },
  ];

  for (const draft of drafts) {
    await upsertChecklistItem(customerId, draft);
  }
}

async function rememberKbliLeads(customerId: string, memoryRows: Memory[]): Promise<void> {
  const existing = db.select().from(kbliRecords).where(eq(kbliRecords.customerId, customerId)).all();
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const memory of memoryRows) {
    if (memory.kind !== "kbli" && !/\b(kbli|oss|nib)\b/i.test(memory.content)) continue;
    const codes = memory.content.match(kbliCodeRe) ?? [];
    for (const code of codes) {
      const existingRow = existingByCode.get(code);
      if (existingRow) {
        if (memory.confirmed && !existingRow.confirmed) {
          db.update(kbliRecords)
            .set({
              confirmed: true,
              status: "confirmed",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(kbliRecords.id, existingRow.id))
            .run();
          existingByCode.set(code, { ...existingRow, confirmed: true, status: "confirmed" });
        }
        continue;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      db.insert(kbliRecords)
        .values({
          id,
          customerId,
          code,
          source: memory.source ?? "memory",
          status: memory.confirmed ? "confirmed" : "unconfirmed",
          confirmed: memory.confirmed,
        })
        .run();
      existingByCode.set(code, {
        id,
        customerId,
        code,
        version: "unknown",
        title: null,
        riskLevel: null,
        ossLicenseType: null,
        requiredCertificates: [],
        sectorMinistry: null,
        source: memory.source ?? "memory",
        status: memory.confirmed ? "confirmed" : "unconfirmed",
        confirmed: memory.confirmed,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function upsertChecklistItem(customerId: string, draft: ChecklistDraft): Promise<void> {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.customerId, customerId),
        eq(checklistItems.category, draft.category),
        eq(checklistItems.title, draft.title),
      ),
    )
    .get();

  const values = {
    status: draft.status,
    priority: draft.priority,
    whyApplies: draft.whyApplies,
    linkedFacts: draft.linkedFacts,
    evidenceRequired: draft.evidenceRequired,
    sourceHealth: draft.sourceHealth,
    confidence: draft.confidence,
    openQuestions: draft.openQuestions,
    origin: draft.origin ?? "system",
    updatedAt: now,
  };

  if (existing) {
    db.update(checklistItems).set(values).where(eq(checklistItems.id, existing.id)).run();
    return;
  }

  db.insert(checklistItems)
    .values({
      id: randomUUID(),
      customerId,
      title: draft.title,
      category: draft.category,
      ...values,
    })
    .run();
}

export function countOpenChecklistItems(items: ChecklistItem[]): number {
  return items.filter((item) => !["completed", "not_required"].includes(item.status)).length;
}
