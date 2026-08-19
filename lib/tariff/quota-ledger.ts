/**
 * Live Quota & Import/Export Permit Ledger
 *
 * Tracks government-issued quota allocations (Kemendag PI Bahan Baku, PI TPT, PI B2,
 * Kemenperin allocations, and US Tariff-Rate Quotas).
 *
 * Records realized customs declarations (PIB / Entry Summary), computes quota utilization
 * run-rates, projects depletion dates, and issues timely renewal alerts before shipments arrive.
 */

export type PermitType =
  | "PI_BAHAN_BAKU"
  | "PI_TPT"
  | "PI_B2"
  | "LS_IMPORT"
  | "US_TARIFF_RATE_QUOTA"
  | "GENERAL_QUOTA";

export interface QuotaDeduction {
  id: string;
  shipmentReference: string;
  pibOrEntryNumber: string;
  quantityDeducted: number;
  deductedAt: string; // ISO string
  notes?: string;
}

export interface QuotaPermit {
  id: string;
  permitNumber: string;
  permitType: PermitType;
  issuingAgency: string; // e.g. "Kemendag", "Kemenperin", "US CBP"
  commodityDescription: string;
  hsCode: string;
  allocatedQuantity: number;
  unit: "MT" | "KG" | "PCS" | "SQM" | "LITERS";
  validFrom: string; // ISO string
  validUntil: string; // ISO string
  deductions: QuotaDeduction[];
}

export interface QuotaHealthResult {
  permitId: string;
  permitNumber: string;
  totalAllocated: number;
  totalRealized: number;
  remainingBalance: number;
  utilizationPercent: number;
  daysUntilExpiration: number;
  averageMonthlyBurnRate: number;
  projectedDepletionDate: string | null;
  status: "HEALTHY" | "RENEWAL_WARNING" | "CRITICAL_DEPLETION" | "EXPIRED" | "OVER_ALLOCATED";
  alerts: string[];
}

/**
 * Record a shipment deduction against an active quota permit.
 */
export function recordQuotaDeduction(
  permit: QuotaPermit,
  deduction: Omit<QuotaDeduction, "id" | "deductedAt"> & { id?: string; deductedAt?: string },
  now: Date = new Date(),
): { updatedPermit: QuotaPermit; isAllowed: boolean; error?: string } {
  const currentTotal = permit.deductions.reduce((acc, d) => acc + d.quantityDeducted, 0);
  const newTotal = currentTotal + deduction.quantityDeducted;

  if (newTotal > permit.allocatedQuantity) {
    return {
      updatedPermit: permit,
      isAllowed: false,
      error: `Deduction of ${deduction.quantityDeducted} ${permit.unit} exceeds remaining quota balance of ${permit.allocatedQuantity - currentTotal} ${permit.unit}.`,
    };
  }

  const newDeduction: QuotaDeduction = {
    id: deduction.id || `DED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shipmentReference: deduction.shipmentReference,
    pibOrEntryNumber: deduction.pibOrEntryNumber,
    quantityDeducted: deduction.quantityDeducted,
    deductedAt: deduction.deductedAt || now.toISOString(),
    notes: deduction.notes,
  };

  const updatedPermit: QuotaPermit = {
    ...permit,
    deductions: [...permit.deductions, newDeduction],
  };

  return { updatedPermit, isAllowed: true };
}

/**
 * Calculate the health, burn rate, and renewal alerts for a quota permit.
 */
export function evaluateQuotaHealth(
  permit: QuotaPermit,
  now: Date = new Date(),
): QuotaHealthResult {
  const totalAllocated = permit.allocatedQuantity;
  const totalRealized = permit.deductions.reduce((acc, d) => acc + d.quantityDeducted, 0);
  const remainingBalance = Math.max(0, totalAllocated - totalRealized);
  const utilizationPercent = totalAllocated > 0 ? Number(((totalRealized / totalAllocated) * 100).toFixed(1)) : 0;

  const validUntilDate = new Date(permit.validUntil);
  const validFromDate = new Date(permit.validFrom);
  const msUntilExpiry = validUntilDate.getTime() - now.getTime();
  const daysUntilExpiration = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

  const alerts: string[] = [];
  let status: QuotaHealthResult["status"] = "HEALTHY";

  // Calculate Monthly Burn Rate
  const daysActive = Math.max(1, Math.ceil((now.getTime() - validFromDate.getTime()) / (1000 * 60 * 60 * 24)));
  const dailyBurnRate = totalRealized / daysActive;
  const averageMonthlyBurnRate = Number((dailyBurnRate * 30).toFixed(1));

  let projectedDepletionDate: string | null = null;
  if (dailyBurnRate > 0 && remainingBalance > 0) {
    const daysRemainingAtCurrentPace = remainingBalance / dailyBurnRate;
    const projectedDate = new Date(now.getTime() + daysRemainingAtCurrentPace * 24 * 60 * 60 * 1000);
    projectedDepletionDate = projectedDate.toISOString().slice(0, 10);
  }

  // Health Assessment
  if (daysUntilExpiration <= 0) {
    status = "EXPIRED";
    alerts.push(`CRITICAL: Permit ${permit.permitNumber} EXPIRED on ${permit.validUntil}. New import shipments will be held at port.`);
  } else if (remainingBalance <= 0) {
    status = "CRITICAL_DEPLETION";
    alerts.push(`CRITICAL: Quota ${permit.permitNumber} is 100% DEPLETED. File for quota extension / revision immediately.`);
  } else if (daysUntilExpiration <= 30 || utilizationPercent >= 85) {
    status = "RENEWAL_WARNING";
    alerts.push(`URGENT: Quota ${permit.permitNumber} has only ${remainingBalance} ${permit.unit} (${(100 - utilizationPercent).toFixed(1)}%) remaining with ${daysUntilExpiration} days until expiry.`);
  } else if (daysUntilExpiration <= 60 || utilizationPercent >= 70) {
    status = "RENEWAL_WARNING";
    alerts.push(`NOTICE: Quota ${permit.permitNumber} is ${utilizationPercent}% utilized. ${daysUntilExpiration} days remaining until expiration.`);
  }

  return {
    permitId: permit.id,
    permitNumber: permit.permitNumber,
    totalAllocated,
    totalRealized,
    remainingBalance,
    utilizationPercent,
    daysUntilExpiration,
    averageMonthlyBurnRate,
    projectedDepletionDate,
    status,
    alerts,
  };
}
