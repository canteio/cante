// Existing parser/calculator fixtures isolate admission. Real quota behavior has
// its own actual-helper tests and database regressions; byte limits stay active here.
import { boundedRequest, RequestLimitError } from "../../app/api/request-body";
export { boundedRequest, RequestLimitError };
export async function reserveRequest() { return async () => {}; }
export async function withRequestLimit(request: Request, _operation: string, limit: number, handler: (r: Request) => Promise<Response>) {
  try { return await handler(await boundedRequest(request, limit)); }
  catch (error) { if(error instanceof RequestLimitError) return Response.json({error:error.message},{status:error.status}); throw error; }
}
