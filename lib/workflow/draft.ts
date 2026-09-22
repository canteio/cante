import type { JurisdictionName } from "@/lib/countries";

export interface DraftContext {
  customerName: string;
  productDescription: string;
  regulationRef: string;
  title: string;
  hsCode?: string;
  sideOfTrade?: "import" | "export" | "both" | "domestic" | null;
  changesSummary?: string;
}

export interface GeneratedActionDrafts {
  /** WhatsApp / Email message for the company customs broker (PPJK / CHB) */
  brokerDraft: {
    recipient: string;
    channel: "whatsapp" | "email";
    subject?: string;
    body: string;
  };
  /** Action checklist for internal operations / purchasing when there is NO customs broker */
  internalOpsDraft: {
    title: string;
    checklist: string[];
    body: string;
  };
  /** Formal inquiry to foreign or domestic suppliers for compliance documents (COA, Origin, Non-B3, SDS) */
  supplierDraft: {
    recipient: string;
    subject: string;
    body: string;
  };
}

/**
 * Generate 3 actionable communication drafts for a flagged finding:
 * 1. To PPJK / Customs Broker (for verification)
 * 2. To Internal Ops / Purchasing (when the company manages clearance directly without a broker)
 * 3. To Supplier (requesting certificates, test reports, or origin documents)
 */
export function generateActionDrafts(
  context: DraftContext,
  jurisdiction: JurisdictionName = "United States",
): GeneratedActionDrafts {
  const isUs = jurisdiction === "United States";
  const ref = context.regulationRef || context.title;
  const hs = context.hsCode ? ` (HS ${context.hsCode})` : "";
  const side = context.sideOfTrade ?? "import";

  if (isUs) {
    return {
      brokerDraft: {
        recipient: "Licensed Customs Broker",
        channel: "email",
        subject: `Inquiry regarding ${ref} impact on ${context.productDescription}${hs}`,
        body:
          `Dear Team,

` +
          `We noted the recent regulatory update regarding ${ref} ("${context.title}").

` +
          `Could you please confirm if this affects our upcoming ${side} shipments of ${context.productDescription}${hs}? ` +
          `Specifically, please advise if any Section 301/232 duties, PGA filings (EPA TSCA / OSHA), or entry summary adjustments are required prior to clearance.

` +
          `Thank you,
${context.customerName} Compliance Operations`,
      },
      internalOpsDraft: {
        title: `Internal Action Checklist: ${ref}`,
        checklist: [
          `Verify whether open purchase orders for ${context.productDescription}${hs} arrive after the effective date.`,
          `Check commercial invoices and packing lists for required HTS classification and country-of-origin markings.`,
          `Request updated Safety Data Sheets (SDS) and TSCA certification from the supplier before shipment departs.`,
          `Confirm whether duty rates or tariff exclusions have changed for this HTS category.`,
        ],
        body:
          `Internal Operations Checklist for ${context.customerName}:
` +
          `• Review open purchase orders touching ${context.productDescription}${hs}.
` +
          `• Ensure suppliers provide valid origin and material safety documentation.
` +
          `• Re-verify tariff classification before filing entry summary.`,
      },
      supplierDraft: {
        recipient: "Material / Component Supplier",
        subject: `Compliance Document Request: ${context.productDescription}${hs} (${context.customerName})`,
        body:
          `Dear Supplier Team,

` +
          `In connection with recent regulatory changes under ${ref}, we require updated compliance documentation for ${context.productDescription}${hs}.

` +
          `Please provide the following at your earliest convenience:
` +
          `1. Updated Certificate of Analysis (COA) / Technical Specification Sheet
` +
          `2. Valid Country of Origin Declaration / Certificate
` +
          `3. Material Safety Data Sheet (SDS) & EPA TSCA compliance certification
` +
          `4. Non-forced labor / supply chain declaration (UFLPA compliance)

` +
          `Thank you for your prompt cooperation.

` +
          `Best regards,
${context.customerName} Purchasing & Compliance`,
      },
    };
  }

  // Indonesian drafts (Bahasa Indonesia for local PPJK / internal ops, English for foreign suppliers)
  const isImport = side === "import" || side === "both";

  return {
    brokerDraft: {
      recipient: "PPJK / Customs Broker",
      channel: "whatsapp",
      body:
        `*Tanya PPJK — ${ref}*

` +
        `Halo Pak/Bu, mau konfirmasi terkait terbitnya *${ref}* (${context.title}).

` +
        `Apakah aturan ini berdampak pada rencana ${isImport ? "impor bahan baku" : "ekspor barang jadi"} kita untuk *${context.productDescription}*${hs}?

` +
        `Mohon dicek apakah ada kewajiban baru terkait:
` +
        `• Persetujuan Impor (PI) / kuota alokasi
` +
        `• Laporan Surveyor (LS) di pelabuhan muat
` +
        `• Perubahan pos tarif / Bea Masuk / PPh 22

` +
        `Terima kasih atas bantuannya.`,
    },
    internalOpsDraft: {
      title: `Checklist Tindakan Internal (Tanpa PPJK): ${ref}`,
      checklist: [
        `Cek masa berlaku dan sisa kuota Persetujuan Impor (PI) di portal OSS / INSW.`,
        `Pastikan supplier melampirkan Certificate of Analysis (COA) dan Surat Pengecualian / Non-B3 sebelum muat kapal.`,
        `Periksa kembali draft PIB dan kode HS ${hs || "barang"} sebelum pengajuan billing pabean.`,
        `Pastikan tidak ada perubahan tarif Bea Masuk atau ketentuan LARTAS Post-Border yang belum dipenuhi.`,
      ],
      body:
        `*Checklist Operasional Internal — ${context.customerName}*
` +
        `Aturan: ${ref}

` +
        `1. Verifikasi kuota PI & perizinan di portal INSW / OSS RBA.
` +
        `2. Minta kelengkapan dokumen teknis (COA, Non-B3, Certificate of Origin) ke supplier sebelum kapal berangkat.
` +
        `3. Pastikan kelengkapan dokumen pabean (Invoice, Packing List, BL, LS) siap sebelum submit PIB.`,
    },
    supplierDraft: {
      recipient: "Foreign Supplier / Vendor",
      subject: `Important: Technical Documentation Required for ${context.productDescription}${hs} - ${context.customerName}`,
      body:
        `Dear Supplier Partner,

` +
        `To ensure smooth customs clearance in Indonesia under recent regulation ${ref}, we need to update our technical documentation file for ${context.productDescription}${hs}.

` +
        `Please kindly prepare and send us the following documents before container shipment:
` +
        `1. Certificate of Analysis (COA) for the current production batch
` +
        `2. Certificate of Origin (e.g. Form E / Form AK / Form D) for preferential duty rates
` +
        `3. Material Safety Data Sheet (MSDS / SDS) in English with clear chemical CAS numbers
` +
        `4. Non-Hazardous (Non-B3) statement letter if applicable

` +
        `Your prompt assistance ensures timely import clearance without port storage delays.

` +
        `Best regards,
${context.customerName} Procurement & Supply Chain`,
    },
  };
}
