import { fetchUnifiedTradePolicyNotices, calculateNoticeExposure } from "@/lib/tariff/federal-register-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled Cron Job for Automatic Regulatory Monitoring
 * 
 * Invoked daily by Vercel Cron.
 * Queries the Federal Register and CBP CSMS APIs, detects active USTR / trade actions,
 * evaluates exposure, and logs alerts.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Protect cron in production if CRON_SECRET is configured
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized cron execution." }, { status: 401 });
  }

  try {
    const notices = await fetchUnifiedTradePolicyNotices(request.signal);
    const notice = notices[0];

    const sampleCatalog = [
      { sku: "ENG-ROTOR-01", name: "High-Torque Rotary Subassembly", hts: "8433.11.00.00", annualValueUsd: 1250000, supplier: "Precision Machining Corp", origin: "CN" },
      { sku: "MOT-SERVO-02", name: "Commercial Stepper & Drive Motor", hts: "8501.10.40.60", annualValueUsd: 2400000, supplier: "Pacific Motion Systems", origin: "CN" },
      { sku: "PLAS-EXTR-04", name: "Heavy Industrial Extruded Polymers", hts: "3916.90.30.00", annualValueUsd: 1850000, supplier: "SinoPolymer Ltd", origin: "CN" },
    ];

    const alert = calculateNoticeExposure(notice, sampleCatalog);

    console.log(`[Tariff Cron] Federal Register checked at ${new Date().toISOString()}: ${alert.summary}`);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      noticeProcessed: notice.documentNumber,
      effectiveDate: alert.effectiveDate,
      totalAnnualExposureUsd: alert.totalAnnualExposureUsd,
      affectedProductCount: alert.affectedProductCount,
    });
  } catch (error) {
    console.error("[Tariff Cron] Failed to execute scheduled tariff check:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Scheduled check failed.",
    }, { status: 500 });
  }
}
