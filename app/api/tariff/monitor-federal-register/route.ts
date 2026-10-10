import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import {
  fetchUnifiedTradePolicyNotices,
  calculateNoticeExposure,
  type ProductCatalogItem,
} from "@/lib/tariff/federal-register-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleMonitoring(request);
}

export async function POST(request: Request) {
  return handleMonitoring(request);
}

async function handleMonitoring(request: Request) {
  try {
    const workspace = await getAuthenticatedWorkspace().catch(() => null);
    const catalog: ProductCatalogItem[] = [];

    if (workspace) {
      const client = await createRequestClient();
      const { data: products } = await client
        .from("products")
        .select("id,sku,name,classifications(code)")
        .eq("customer_id", workspace.customerId);

      if (Array.isArray(products) && products.length > 0) {
        for (const p of products) {
          const classifications = (p.classifications ?? []) as Array<{ code?: string }>;
          const htsCode = classifications[0]?.code ?? "";
          if (htsCode) {
            catalog.push({
              id: p.id,
              sku: p.sku,
              name: p.name,
              hts: htsCode,
            });
          }
        }
      }
    }

    // If tenant has no products yet or running demo, use realistic enterprise demo catalogue for Mission One
    if (catalog.length === 0) {
      catalog.push(
        { sku: "ENG-ROTOR-01", name: "High-Torque Rotary Subassembly", hts: "8433.11.00.00", annualValueUsd: 1250000, supplier: "Precision Machining Corp", origin: "CN" },
        { sku: "MOT-SERVO-02", name: "Commercial Stepper & Drive Motor", hts: "8501.10.40.60", annualValueUsd: 2400000, supplier: "Pacific Motion Systems", origin: "CN" },
        { sku: "HYD-VALVE-03", name: "Hydraulic Solenoid Valve 24V", hts: "8481.20.00.20", annualValueUsd: 950000, supplier: "Global Hydraulics Ltd", origin: "TW" },
        { sku: "PLAS-EXTR-04", name: "Heavy Industrial Extruded Polymers", hts: "3916.90.30.00", annualValueUsd: 1850000, supplier: "SinoPolymer Ltd", origin: "CN" },
        { sku: "GEAR-DRIVE-05", name: "Planetary Reduction Gearbox", hts: "8483.40.50.10", annualValueUsd: 920000, supplier: "Precision Machining Corp", origin: "CN" },
        { sku: "PUMP-WATER-06", name: "Centrifugal Impeller Pump", hts: "8413.70.20.04", annualValueUsd: 650000, supplier: "Asia Fluid Dynamics", origin: "VN" },
      );
    }

    const notices = await fetchUnifiedTradePolicyNotices(request.signal);
    const activeNotice = notices[0];

    const alert = calculateNoticeExposure(activeNotice, catalog);

    return Response.json({
      status: "active_alert",
      checkedAt: new Date().toISOString(),
      alert,
      totalCatalogEvaluated: catalog.length,
    });
  } catch (error) {
    return Response.json({
      status: "error",
      error: error instanceof Error ? error.message : "Failed to run Federal Register monitoring check.",
    }, { status: 500 });
  }
}
