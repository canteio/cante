import {redirect} from "next/navigation";
export default async function LegacyFileCheck({searchParams}:{searchParams:Promise<{check?:string}>}){const {check}=await searchParams;redirect(check ? `/tariff?check=${encodeURIComponent(check)}` : "/tariff");}
