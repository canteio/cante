import { withRequestLimit } from "@/app/api/request-limits";
import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { LIVE_MAX_BYTES, parseLiveProducts, runLiveCheck } from "./check";
import { beginLiveCheckArchive, finishLiveCheckArchive, failLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import remedyContract from "@/config/tariff-remedy-contract.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  return withRequestLimit(request, "check", 1000000, handlePOST);
}
async function handlePOST(request: Request) {
  const workspace=await getAuthenticatedWorkspace();
  if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (workspace.role === "viewer") return Response.json({ error: "Write access required to run and archive checks." }, { status: 403 });
  const reader = request.body?.getReader(); if (!reader) return Response.json({ error: "Upload a CSV." }, { status: 400 });
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > LIVE_MAX_BYTES) { await reader.cancel(); return Response.json({ error: "CSV must be under 1 MB." }, { status: 413 }); } chunks.push(part.value); }
  const input=Buffer.concat(chunks).toString("utf8");
  if(!Buffer.from(input,"utf8").equals(Buffer.concat(chunks)))return Response.json({error:"CSV must be valid UTF-8."},{status:400});
  let products;
  try { products = parseLiveProducts(input); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid CSV." }, { status: 400 }); }
  for (const header of ["x-cante-standard-commercial","x-cante-no-other-232"]) {
    const value=request.headers.get(header);if(value!==null&&value!=="true")return Response.json({error:"Shipment confirmations must be explicitly true or omitted."},{status:400});
  }
  products=products.map(product=>({...product,remedyFacts:{...(request.headers.get("x-cante-standard-commercial")==="true"?{standardCommercial:true}:{}),...(request.headers.get("x-cante-no-other-232")==="true"?{other232Heading:"none"}:{}),...product.remedyFacts}}));
  let filename=request.headers.get("x-filename");try{if(filename)filename=decodeURIComponent(filename);}catch{return Response.json({error:"Invalid filename."},{status:400});}
  const client=await createRequestClient();
  let checkId:string;
  try { checkId=await beginLiveCheckArchive(client,workspace.customerId,input,filename,{standardCommercial:request.headers.get("x-cante-standard-commercial")==="true",noOther232:request.headers.get("x-cante-no-other-232")==="true"},{contract:remedyContract,build:process.env.VERCEL_GIT_COMMIT_SHA??process.env.CANTE_BUILD_REVISION??"unversioned-working-tree",workflow:"live-tariff-check-v1"}); }
  catch { return Response.json({error:"Could not save the original check inputs. No check was run. Check that the archive migration is installed."},{status:503}); }
  const abort = new AbortController(); const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(280000)]);
  const encoder = new TextEncoder(); let cancelled = false;
  let capturedSources: import("./check").LiveSource[]=[];
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        send({type:"started",checkId});
        const result = await runLiveCheck(products, signal, message => send({ type: "progress", message }), sources=>{capturedSources=sources;});
        signal.throwIfAborted();
        send({type:"progress",message:"Saving inputs, government evidence and calculation…"});
        await finishLiveCheckArchive(client,workspace.customerId,checkId,result);
        send({ type: "done", result, checkId, archived:true });
      }
      catch (failure) {
        let error=signal.aborted ? "Check interrupted. No completed result is available." : failure instanceof Error && failure.message.startsWith("The calculation could not be archived") ? failure.message : "Live check failed. No cached or simulated result was substituted.";
        try {await failLiveCheckArchive(client,workspace.customerId,checkId,error,capturedSources);}catch{error+=" Final status could not be saved; history retains the original inputs as incomplete.";}
        send({ type: "error", error,checkId });
      }
      finally { if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; abort.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
