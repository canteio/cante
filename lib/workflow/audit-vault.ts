/**
 * Customs Post-Clearance Audit Vault & Defense Packet Generator
 *
 * Compiles an immutable, chronological evidentiary dossier to prove "Reasonable Care"
 * during customs post-clearance audits by:
 * - Direktorat Jenderal Bea dan Cukai (DJBC / Audit Pabean Indonesia)
 * - U.S. Customs and Border Protection (CBP Focused Assessment / Regulatory Audit)
 */

export interface CompanyTradeProfile {
  companyName: string;
  country: "Indonesia" | "United States";
  tradeIdentifiers: {
    nibOrEin: string;
    apiOrIorNumber?: string;
    kbliOrNaics?: string[];
  };
  facilityAddress: string;
  sideOfTrade: "import" | "export" | "both" | "domestic";
}

export interface AuditedTransactionItem {
  shipmentReference: string;
  declarationNumber: string; // PIB or CBP Form 7501 Entry Number
  declarationDate: string;
  declaredHsCode: string;
  declaredDescription: string;
  cifValue: number;
  currency: string;
  dutyTaxesPaid: {
    importDuty: number;
    vatOrPpn: number;
    withholdingOrPph: number;
    total: number;
  };
  commercialDocumentsAttached: string[]; // e.g. ["CI #9988", "PL #9988", "BL #ONE123", "COA #B-10", "COO #AK-8877"]
  quotaPermitDeducted?: string; // e.g. "PI-PLASTIK-2026-001"
  classificationRationale: string;
}

export interface RegulatoryDueDiligenceEvent {
  checkDate: string;
  regulationCited: string;
  findingVerdict: "flagged" | "noted" | "clear";
  actionState: string;
  actionTakenBy?: string;
  brokerConfirmationNote?: string;
}

export interface AuditDefensePacketInput {
  dossierReferenceNumber: string;
  auditAgency: "BEA_CUKAI_INDONESIA" | "US_CBP";
  auditNoticeReference?: string;
  company: CompanyTradeProfile;
  transactions: AuditedTransactionItem[];
  diligenceHistory: RegulatoryDueDiligenceEvent[];
  preparedBy: {
    name: string;
    title: string;
    department: string;
  };
}

/**
 * Generate a complete, formal Customs Audit Defense Manifest & Evidentiary Dossier.
 */
export function generateAuditDefenseDossier(input: AuditDefensePacketInput): string {
  const isId = input.auditAgency === "BEA_CUKAI_INDONESIA";
  const agencyTitle = isId
    ? "DIREKTORAT JENDERAL BEA DAN CUKAI (DJBC) — AUDIT KEPABEANAN DAN CUKAI"
    : "U.S. CUSTOMS AND BORDER PROTECTION — REASONABLE CARE POST-ENTRY AUDIT DOSSIER";

  const transactionsSection = input.transactions
    .map(
      (tx, idx) =>
        `[TRANSACTION ${idx + 1}] Reference: ${tx.shipmentReference} | Declaration: ${tx.declarationNumber} (${tx.declarationDate})
` +
        `  • Commodity: ${tx.declaredDescription} (HS ${tx.declaredHsCode})
` +
        `  • Customs Value: ${tx.currency} ${tx.cifValue.toLocaleString()}
` +
        `  • Duty & Taxes Settled: ${tx.currency} ${tx.dutyTaxesPaid.total.toLocaleString()} (BM/Duty: ${tx.dutyTaxesPaid.importDuty.toLocaleString()}, PPN/VAT: ${tx.dutyTaxesPaid.vatOrPpn.toLocaleString()}, PPh: ${tx.dutyTaxesPaid.withholdingOrPph.toLocaleString()})
` +
        `  • Quota Permit Ledger: ${tx.quotaPermitDeducted || "N/A (Non-quota)"}\n` +
        `  • Enclosed Supporting Records: ${tx.commercialDocumentsAttached.join(", ")}\n` +
        `  • Classification Basis: ${tx.classificationRationale}`,
    )
    .join("\n\n");

  const diligenceSection = input.diligenceHistory
    .map(
      (ev, idx) =>
        `${idx + 1}. [${ev.checkDate}] Regulation: ${ev.regulationCited} (Verdict: ${ev.findingVerdict.toUpperCase()})\n` +
        `   • Action Workflow State: ${ev.actionState} (Logged by: ${ev.actionTakenBy || "System"})\n` +
        `   • Broker Confirmation / Resolution: ${ev.brokerConfirmationNote || "Confirmed in order with no discrepancy"}`,
    )
    .join("\n\n");

  return (
    `========================================================================================
` +
    `${agencyTitle}
` +
    `CUSTOMS REASONABLE CARE & COMPLIANCE DEFENSE DOSSIER
` +
    `========================================================================================

` +
    `DOSSIER ID: ${input.dossierReferenceNumber}
` +
    `DATE OF COMPILATION: ${new Date().toISOString().slice(0, 10)}
` +
    `AUDIT INQUIRY REF: ${input.auditNoticeReference || "Annual Internal Post-Entry Compliance Audit"}

` +
    `SECTION 1: IMPORTER / ENTERPRISE IDENTIFICATION
` +
    `• Company Name: ${input.company.companyName}
` +
    `• Operating Jurisdiction: ${input.company.country}
` +
    `• Tax / Customs ID (NIB / EIN): ${input.company.tradeIdentifiers.nibOrEin}
` +
    `• Importer License (API / IOR): ${input.company.tradeIdentifiers.apiOrIorNumber || "Active"}
` +
    `• Business Line / KBLI: ${(input.company.tradeIdentifiers.kbliOrNaics ?? []).join(", ") || "Manufacturing"}
` +
    `• Facility Location: ${input.company.facilityAddress}
` +
    `• Registered Side of Trade: ${input.company.sideOfTrade.toUpperCase()}

` +
    `SECTION 2: AUDITED IMPORT / EXPORT TRANSACTIONS & DUTY RECONCILIATION
` +
    `${transactionsSection}

` +
    `SECTION 3: CHRONOLOGICAL REGULATORY DUE DILIGENCE AUDIT TRAIL (REASONABLE CARE)
` +
    `${diligenceSection}

` +
    `SECTION 4: COMPLIANCE CERTIFICATION & RECORDKEEPING AFFIDAVIT
` +
    `The undersigned hereby certifies that the records, classification rationales, supplier certificates, and customs declarations presented in this dossier represent the true, accurate, and complete accounting of the subject import transactions. All classifications were determined with reasonable care under applicable customs laws and official government repositories.

` +
    `Prepared By: ${input.preparedBy.name} (${input.preparedBy.title})
` +
    `Department: ${input.preparedBy.department} — ${input.company.companyName}
` +
    `Signature: __________________________    Date: ${new Date().toISOString().slice(0, 10)}
` +
    `========================================================================================`
  );
}
