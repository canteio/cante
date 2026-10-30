import { withRequestLimit } from "@/app/api/request-limits";
import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { prepareChatUpload } from "@/app/api/files/prepare-chat-upload";
import type { CsvAttachment } from "@/app/api/chat/csv-check";
import { checkChatCsv } from "@/app/api/chat/csv-check";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return withRequestLimit(
    request,
    "check",
    15 * 1024 * 1024,
    async (bounded) => {
      const workspace = await getAuthenticatedWorkspace();
      if (!workspace)
        return Response.json(
          { error: "Sign in to upload products." },
          { status: 401 },
        );
      if (workspace.role === "viewer")
        return Response.json(
          { error: "Write access required." },
          { status: 403 },
        );
      let file: CsvAttachment;
      try {
        if (request.headers.get("content-type")?.includes("application/json")) {
          const body = await bounded.json();
          if (typeof body.uploadId !== "string")
            throw Error("Save the original file first.");
          const prepared = await prepareChatUpload(workspace.customerId, body);
          if (!prepared.csv)
            return Response.json(
              {
                error:
                  prepared.markdown ??
                  "Review the file columns before checking.",
              },
              { status: 400 },
            );
          file = prepared.csv;
        } else {
          const raw = await bounded.text();
          if (!raw.trim()) throw Error("Upload a nonempty UTF-8 CSV.");
          file = {
            filename: "Product upload.csv",
            format: "csv",
            text: "",
            originalCsv: raw,
          };
        }
      } catch (failure) {
        return Response.json(
          {
            error:
              failure instanceof Error
                ? failure.message
                : "The original file could not be read.",
          },
          { status: 400 },
        );
      }
      const encoder = new TextEncoder();
      const abort = new AbortController();
      let cancelled = false;
      const signal = AbortSignal.any([
        bounded.signal,
        abort.signal,
        AbortSignal.timeout(275000),
      ]);
      return new Response(
        new ReadableStream({
          async start(controller) {
            const send = (event: unknown) => {
              if (!cancelled)
                controller.enqueue(
                  encoder.encode(JSON.stringify(event) + "\n"),
                );
            };
            try {
              const outcome = await checkChatCsv(
                workspace.customerId,
                file,
                signal,
                (message) => send({ type: "progress", message }),
                undefined,
                false,
                true,
              );
              if (!("result" in outcome) || !outcome.result)
                send({
                  type: "error",
                  error: outcome.markdown
                    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
                    .replace(/[*_`]/g, "")
                    .replace(/\s+/g, " "),
                  checkId: outcome.checkId,
                });
              else
                send({
                  type: "done",
                  result: outcome.result,
                  checkId: outcome.checkId,
                });
            } catch {
              send({
                type: "error",
                error:
                  "The upload check did not finish. Review the saved status before retrying.",
              });
            } finally {
              if (!cancelled) controller.close();
            }
          },
          cancel() {
            cancelled = true;
            abort.abort();
          },
        }),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
          },
        },
      );
    },
  );
}
