/**
 * CBP Form 28 / Form 29 Response & CROSS Defense Drafter
 *
 * Generates formal legal response drafts to:
 * 1. CBP Form 28 (Request for Information under 19 CFR 151.11)
 * 2. CBP Form 29 (Notice of Action / Proposed Rate Advance under 19 CFR 152.2)
 *
 * Incorporates General Rules of Interpretation (GRI), Chapter Notes, and CROSS binding ruling precedents.
 */

export interface CbpInquiryContext {
  formType: "CBP_FORM_28" | "CBP_FORM_29";
  cbpPort: string; // e.g. "Port of Los Angeles/Long Beach (2704)"
  importSpecialistName?: string;
  inquiryDate: string;
  responseDeadlineDate: string; // 30 days from issuance
  entryNumber: string;
  entryDate: string;
  importerOfRecord: {
    companyName: string;
    importerNumber: string;
    address: string;
  };
  disputedItem: {
    productDescription: string;
    declaredHtsus: string;
    proposedHtsusByCbp?: string;
    reasonForInquiry: string; // e.g. "Classification dispute", "Section 301 applicability", "Value reconciliation"
  };
  defenseArguments: {
    essentialCharacterDescription?: string;
    applicableGris: Array<"GRI 1" | "GRI 3(a)" | "GRI 3(b)" | "GRI 6">;
    referencedCrossRulings?: string[]; // e.g. ["NY N312456", "HQ H298765"]
    materialBreakdown?: string;
  };
  attachedEvidence: string[]; // e.g. ["Commercial Invoice", "Lab Test Report", "Manufacturing Flowchart", "Sample"]
}

/**
 * Generate formal response letter to CBP Port Director / Import Specialist.
 */
export function generateCbpDefenseDraft(context: CbpInquiryContext): string {
  const formTitle = context.formType === "CBP_FORM_28" ? "CBP Form 28 (Request for Information)" : "CBP Form 29 (Notice of Action)";
  const importSpecialist = context.importSpecialistName || "Import Specialist Team";
  const gris = context.defenseArguments.applicableGris.join(", ");
  const cross = (context.defenseArguments.referencedCrossRulings ?? []).join(", ") || "Consistent with established CBP precedent";
  const evidenceList = context.attachedEvidence.map((e, idx) => `${idx + 1}. ${e}`).join("\n");

  return (
    `VIA ACE PORTAL / CERTIFIED MAIL

` +
    `Date: ${new Date().toISOString().slice(0, 10)}

` +
    `TO:
` +
    `U.S. Customs and Border Protection
` +
    `${context.cbpPort}
` +
    `ATTN: ${importSpecialist}

` +
    `RE: Response to ${formTitle} dated ${context.inquiryDate}
` +
    `    Importer of Record: ${context.importerOfRecord.companyName} (EIN/IOR: ${context.importerOfRecord.importerNumber})
` +
    `    Entry Number: ${context.entryNumber} (Entry Date: ${context.entryDate})
` +
    `    Commodity: ${context.disputedItem.productDescription} (Declared HTSUS: ${context.disputedItem.declaredHtsus})
` +
    `    Response Due Date: ${context.responseDeadlineDate}

` +
    `Dear Import Specialist,

` +
    `On behalf of ${context.importerOfRecord.companyName} ("Importer"), we respectfully submit this response to the ${formTitle} concerning the classification and customs status of ${context.disputedItem.productDescription}.

` +
    `1. SUMMARY OF IMPORTER'S POSITION
` +
    `The Importer maintains that the subject merchandise is properly classified under HTSUS ${context.disputedItem.declaredHtsus}. ` +
    (context.disputedItem.proposedHtsusByCbp
      ? `The proposed reclassification to HTSUS ${context.disputedItem.proposedHtsusByCbp} is legally inappropriate based on the physical composition and essential character of the merchandise.

`
      : `The declared tariff line accurately reflects the physical properties and intended commercial use of the goods.

`) +
    `2. LEGAL CLASSIFICATION ANALYSIS
` +
    `Classification of goods under the HTSUS is governed by the General Rules of Interpretation ("GRI"). Under ${gris}:
` +
    `• The product consists of: ${context.defenseArguments.materialBreakdown || context.disputedItem.productDescription}.
` +
    (context.defenseArguments.essentialCharacterDescription
      ? `• Pursuant to GRI 3(b), the essential character of the composite article is imparted by: ${context.defenseArguments.essentialCharacterDescription}.
`
      : "") +
    `• This classification is fully supported by binding CBP CROSS ruling precedents, including: ${cross}.

` +
    `3. SUPPORTING EVIDENCE ENCLOSED
` +
    `In support of this response, the Importer encloses the following documentation:
` +
    `${evidenceList}

` +
    `4. CONCLUSION
` +
    `Based on the legal principles and documentary evidence set forth above, the Importer respectfully requests that CBP accept the declared classification of HTSUS ${context.disputedItem.declaredHtsus} and liquidate the entry as entered.

` +
    `Respectfully submitted,

` +
    `${context.importerOfRecord.companyName}
` +
    `Authorized Customs Compliance Officer / Trade Counsel`
  );
}
