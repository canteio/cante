export class RequestLimitError extends Error {
  constructor(message: string, public status: number, public retryAfter = 60) { super(message); }
}
/** Count bytes before concatenation, JSON parsing or multipart parsing; never trust Content-Length alone. */
export async function boundedRequest(request: Request, limit: number) {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    await request.body?.cancel().catch(() => {});
    throw new RequestLimitError("Upload exceeds this endpoint’s size limit.", 413);
  }
  if (!request.body) return request;
  const reader = request.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, {once:true});
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const part = await reader.read(); request.signal.throwIfAborted(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel().catch(() => {}); throw new RequestLimitError("Upload exceeds this endpoint’s size limit.", 413); }
      chunks.push(part.value);
    }
  } finally { request.signal.removeEventListener("abort",abort); reader.releaseLock(); }
  return new Request(request.url, { method: request.method, headers: request.headers, body: Buffer.concat(chunks, bytes), signal: request.signal });
}
