import { Sidebar } from "@/components/dashboard/sidebar";
import { CheckHistory } from "@/components/tariff/check-history";
export const dynamic="force-dynamic";
export default function TariffHistory(){return <div className="shell"><Sidebar active="tariff-history"/><main className="main"><CheckHistory/></main></div>;}
