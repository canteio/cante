import { notFound } from "next/navigation";
import { localAuditTestAvailable } from "./fixture";
import { AuditTestWorkflow } from "@/components/audits/audit-test-workflow";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!localAuditTestAvailable()) notFound();
  return <main className="main" style={{ marginLeft: 0 }}><div className="main-scroll"><AuditTestWorkflow /></div></main>;
}
