/**
 * INSW / NTR (Indonesia National Single Window — National Tariff Repository)
 *
 * Provides authoritative tariff rates (Bea Masuk, PPN, PPh Pasal 22 Import, Bea Keluar)
 * and LARTAS (Larangan & Pembatasan / Prohibitions & Restrictions) requirements for
 * Indonesian BTKI / HS codes.
 */

export interface LartasRequirement {
  agency: string;
  document: string;
  inspection: "Border" | "Post-Border";
  description: string;
}

export interface InswTariffInfo {
  hsCode: string;
  normalizedCode: string;
  descriptionId: string;
  descriptionEn: string;
  dutyRates: {
    importDutyPercent: number; // Bea Masuk (BM) MFN
    ftaRates?: Record<string, number>; // e.g. { "ACFTA": 0, "ATIGA": 0 }
    exportDutyPercent: number; // Bea Keluar (BK)
    ppnPercent: number; // PPN (11%)
    pphPercentApi: number; // PPh 22 with API (2.5%)
    pphPercentNonApi: number; // PPh 22 without API (7.5%)
  };
  lartas: {
    import: {
      restricted: boolean;
      requirements: LartasRequirement[];
    };
    export: {
      restricted: boolean;
      requirements: Array<{
        agency: string;
        document: string;
        description: string;
      }>;
    };
  };
}

export interface ImportTaxCalculation {
  cifValueIdr: number;
  beaMasuk: number;
  nilaiImpor: number; // CIF + Bea Masuk (Tax base for PPN & PPh)
  ppn: number;
  pph22: number;
  totalImportTax: number;
  effectiveRatePercent: number;
}

/** Normalized code: digits only, at least 6 digits */
export function normalizeHsCode(code: string): string {
  return code.replace(/[^0-9]/g, "");
}

/**
 * Curated knowledgebase of INSW / NTR tariff and LARTAS data for primary industrial,
 * polymer, chemical, textile, and manufactured lines.
 */
export const INSW_DATABASE: Record<string, Omit<InswTariffInfo, "normalizedCode">> = {
  "390410": {
    hsCode: "3904.10",
    descriptionId: "Polivinil klorida (PVC), tidak dicampur dengan zat lain, dalam bentuk asal",
    descriptionEn: "Polyvinyl chloride (PVC), not mixed with any other substances, in primary forms",
    dutyRates: {
      importDutyPercent: 5,
      ftaRates: { ACFTA: 0, ATIGA: 0, IJEPA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: true,
        requirements: [
          {
            agency: "Kemendag",
            document: "PI Bahan Baku Plastik / B2",
            inspection: "Post-Border",
            description: "Persetujuan Impor (PI) untuk bahan baku plastik tertentu dari Kementerian Perdagangan.",
          },
          {
            agency: "Kemenperin",
            document: "Verifikasi Kemampuan Industri",
            inspection: "Post-Border",
            description: "Rekomendasi teknis verifikasi kapasitas produksi industri pengguna resin.",
          },
        ],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
  "291734": {
    hsCode: "2917.34",
    descriptionId: "Ester asam ortoftalat lainnya: Dioktil ftalat (DOP Plasticizer)",
    descriptionEn: "Other esters of orthophthalic acid: Dioctyl orthophthalate (DOP Plasticizer)",
    dutyRates: {
      importDutyPercent: 5,
      ftaRates: { ACFTA: 0, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: true,
        requirements: [
          {
            agency: "KLHK",
            document: "Surat Pengecualian / Rekomendasi Non-B3",
            inspection: "Border",
            description: "Konfirmasi / pengecualian registrasi bahan kimia berbahaya dan beracun dari KLHK.",
          },
        ],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
  "381239": {
    hsCode: "3812.39",
    descriptionId: "Preparat anti-oksidan dan senyawa penstabil lainnya untuk karet atau plastik",
    descriptionEn: "Anti-oxidising preparations and other compound stabilisers for rubber or plastics",
    dutyRates: {
      importDutyPercent: 5,
      ftaRates: { ACFTA: 0, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: true,
        requirements: [
          {
            agency: "Kemendag / Surveyor",
            document: "Laporan Surveyor (LS Import)",
            inspection: "Border",
            description: "Verifikasi teknis pelabuhan muat sebelum barang dikapalkan.",
          },
        ],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
  "590310": {
    hsCode: "5903.10",
    descriptionId: "Kain tekstil yang diresapi, dilapisi atau ditutupi dengan polivinil klorida (PVC)",
    descriptionEn: "Textile fabrics impregnated, coated, covered or laminated with polyvinyl chloride (PVC)",
    dutyRates: {
      importDutyPercent: 10,
      ftaRates: { ACFTA: 0, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: true,
        requirements: [
          {
            agency: "Kemendag",
            document: "PI TPT (Persetujuan Impor Tekstil & Produk Tekstil)",
            inspection: "Border",
            description: "Wajib Persetujuan Impor TPT dan kuota alokasi dari Kemendag.",
          },
          {
            agency: "Surveyor",
            document: "Laporan Surveyor (LS Import)",
            inspection: "Border",
            description: "Pemeriksaan fisik di negara asal sebelum muat kapal.",
          },
        ],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
  "320611": {
    hsCode: "3206.11",
    descriptionId: "Pigmen dan preparat berbahan dasar titanium dioksida (mengandung >= 80% TiO2)",
    descriptionEn: "Pigments and preparations based on titanium dioxide (containing >= 80% TiO2)",
    dutyRates: {
      importDutyPercent: 5,
      ftaRates: { ACFTA: 0, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: false,
        requirements: [],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
  "630619": {
    hsCode: "6306.19",
    descriptionId: "Terpal, awning dan kerai matahari dari bahan tekstil lainnya",
    descriptionEn: "Tarpaulins, awnings and sunblinds of other textile materials",
    dutyRates: {
      importDutyPercent: 15,
      ftaRates: { ACFTA: 5, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: true,
        requirements: [
          {
            agency: "Kemendag",
            document: "PI Barang Jadi Tekstil",
            inspection: "Border",
            description: "Impor barang jadi tekstil dibatasi kuota.",
          },
        ],
      },
      export: {
        restricted: false,
        requirements: [
          {
            agency: "Bea Cukai",
            document: "Pemberitahuan Ekspor Barang (PEB)",
            description: "Pemberitahuan pabean standar untuk ekspor barang jadi manufaktur.",
          },
        ],
      },
    },
  },
  "392043": {
    hsCode: "3920.43",
    descriptionId: "Pelat, lembaran, film, foil dan strip lainnya dari polimer vinil klorida",
    descriptionEn: "Other plates, sheets, film, foil and strip of polymers of vinyl chloride",
    dutyRates: {
      importDutyPercent: 10,
      ftaRates: { ACFTA: 0, ATIGA: 0 },
      exportDutyPercent: 0,
      ppnPercent: 11,
      pphPercentApi: 2.5,
      pphPercentNonApi: 7.5,
    },
    lartas: {
      import: {
        restricted: false,
        requirements: [],
      },
      export: {
        restricted: false,
        requirements: [],
      },
    },
  },
};

/**
 * Look up tariff rates and LARTAS restrictions for a given HS / BTKI code.
 * Matches 6-digit prefix if full 8-digit exact match is not in database.
 */
export function lookupInswTariff(rawCode: string): InswTariffInfo | null {
  const clean = normalizeHsCode(rawCode);
  if (!clean || clean.length < 4) return null;

  const key6 = clean.slice(0, 6);
  const entry = INSW_DATABASE[key6];
  if (!entry) return null;

  return {
    ...entry,
    normalizedCode: key6,
  };
}

/**
 * Calculate the exact import tax burden for a shipment under Indonesian customs law.
 * Formula:
 *  - Bea Masuk (BM) = CIF * BM%
 *  - Nilai Impor = CIF + Bea Masuk
 *  - PPN Impor = Nilai Impor * 11%
 *  - PPh Pasal 22 = Nilai Impor * 2.5% (with API) or 7.5% (without API)
 *  - Total Pajak Impor = BM + PPN + PPh 22
 */
export function calculateImportTaxExposure(
  cifValueIdr: number,
  tariff: InswTariffInfo,
  hasApi: boolean = true,
): ImportTaxCalculation {
  const bmRate = tariff.dutyRates.importDutyPercent / 100;
  const ppnRate = tariff.dutyRates.ppnPercent / 100;
  const pphRate = (hasApi ? tariff.dutyRates.pphPercentApi : tariff.dutyRates.pphPercentNonApi) / 100;

  const beaMasuk = Math.round(cifValueIdr * bmRate);
  const nilaiImpor = cifValueIdr + beaMasuk;
  const ppn = Math.round(nilaiImpor * ppnRate);
  const pph22 = Math.round(nilaiImpor * pphRate);
  const totalImportTax = beaMasuk + ppn + pph22;
  const effectiveRatePercent = cifValueIdr > 0 ? Number(((totalImportTax / cifValueIdr) * 100).toFixed(2)) : 0;

  return {
    cifValueIdr,
    beaMasuk,
    nilaiImpor,
    ppn,
    pph22,
    totalImportTax,
    effectiveRatePercent,
  };
}

/**
 * Get formatted LARTAS restriction summary for a trade side.
 */
export function getLartasSummary(
  tariff: InswTariffInfo,
  side: "import" | "export" | "both" = "import",
): { restricted: boolean; notes: string[] } {
  const notes: string[] = [];
  let restricted = false;

  if (side === "import" || side === "both") {
    if (tariff.lartas.import.restricted) {
      restricted = true;
    }
    for (const req of tariff.lartas.import.requirements) {
      notes.push(`[Import ${req.inspection}] ${req.agency} — ${req.document}: ${req.description}`);
    }
  }

  if (side === "export" || side === "both") {
    if (tariff.lartas.export.restricted) {
      restricted = true;
    }
    for (const req of tariff.lartas.export.requirements) {
      notes.push(`[Export] ${req.agency} — ${req.document}: ${req.description}`);
    }
  }

  return { restricted, notes };
}
