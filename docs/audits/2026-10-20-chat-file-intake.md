# Chat file intake — October 20, 2026

Implemented in the working tree; no app deployment or commit was performed.
Migration `20261021023704_chat_original_file_uploads.sql` is applied to the linked
Cante database. Its UTC filename falls on October 21; the operator's local date
is October 20.

## Customer flow

Attach a file up to 15 MiB: UTF-8 CSV, text-based PDF, DOCX, XLSX/XLSM, TXT or MD.
The original is saved privately in the workspace **when attached**. Removing the
attachment chip removes it from the message; it does not delete the saved original.
Scanned PDFs need OCR elsewhere. Legacy DOC/XLS files need conversion.

Clear, explicitly labelled product tables enter the existing deterministic tariff
checker. Ambiguous columns, multiple tables, PDF layouts, formula caches and hidden
worksheets require review. A compact panel lets the customer select the table,
confirm columns and choose annual totals, unit customs value × annual units, or
historical entries. Alternatively, “Ask about this file instead” skips checking.
Price is not automatically treated as USD customs value. No foreign-exchange
conversion or model-generated product values are introduced.

Every selected row reaches normalization and the existing parser; rows are not
silently discarded to fit the checker. Existing limits remain: 100 product groups
or 6,000 historical entry rows. Historical entries are not annualized. The separate
legacy live-check page/API retains its 1 MB request limit.

## Storage, transport and trust

The browser computes SHA-256, reserves metadata and uploads sequential chunks no
larger than 1 MiB. Extraction and chat receive an upload reference, not the complete
file. Original downloads also stream chunks. This avoids relying on a single large
hosted function request/response. See the [Vercel payload limit documentation](https://vercel.com/docs/errors/function_payload_too_large).

Authenticated upload routes enforce admission quotas and byte limits before
parsing. The new upload_chunk operation permits 400/hour and 1,200/day per user,
1,200/hour and 3,600/day per workspace, with two concurrent requests. Existing
chat/check quotas and output-token limits are unchanged; this is not a cumulative
dollar or token spending budget.

Original metadata/chunks are append-only with workspace RLS, writer-role checks,
actor ownership on insertion and exact declared chunk sizes. Originals count against
the existing shared daily/retained archive storage caps at initiation. Partial
uploads can consume storage but cannot be read as complete. Reassembly verifies
length and SHA-256. Membership/read and write permissions remain separate.

The server re-reads the original and derives the selected table itself; edited
client previews cannot change calculations. Canonical mapped CSVs are archived with
original upload ID, hash, size and mapping. Original input integrity is separate
from saved-report authenticity: user-supplied files do not become verified law or
worker-attested reports. The existing protected-attestation requirement remains;
the trusted verifier worker is still not connected.

Model context uses bounded previews and relevant excerpts from the latest three
workspace originals, retrieved across extracted text. It does not send the entire
15 MiB file to the model. Office expansion, cells, rows and PDF pages/text are
bounded. File-only tariff checks make no model-completion call. Questions needing
an unavailable model receive an explicit explanation.

## Verification

- Existing full suite: **922/922 passed**.
- Focused intake, chat, resource, authorization, archive and tariff regression
  suite: **134/134 passed**; TypeScript and production webpack build passed.
- Actual CSV, positioned-text PDF, DOCX and XLSX parsers feed the same canonical
  deterministic input. Tests cover sparse cells, quoted currencies, ambiguous
  prices, table selection, value-basis separation and client-preview tampering.
- A near-15 MiB CSV retains all 6,000 entry rows across 50 groups. A separate
  original-store test reassembles exactly 15 MiB and rejects incomplete/corrupt data.
- Client helper → actual metadata/chunk/extraction/preparation/download handlers
  runs with fixture database/auth boundaries, preserving bytes for all four formats.
- Live database tests use rollback-only fictional identities: tenant isolation,
  denied viewer writes, immutable rows, oversize/extra-chunk denial, exact 15 MiB
  upload, shared archive budgets and chunk quota admission. No real customer
  upload or paid model call was used.
- Database advisors retain six warnings: five intentionally authenticated guarded
  SECURITY DEFINER functions and disabled leaked-password protection. This work
  does not constitute a clean global security audit.

Browser checks are recorded separately below so mocked UI responses are not
confused with live government retrieval or authenticated production persistence.

Browser verification used a production build of an isolated local copy, dummy
configuration and intercepted fixture APIs. A real near-15 MiB browser file was
sent as 15 chunks of at most 1 MiB; the chat body contained a reference rather than
the original. Clear tables enabled sending; ambiguous mappings disabled it until
confirmation. Question-only mode preserved `skipCheck`. The panel was inspected
at desktop and 390 × 844 mobile sizes without page-level horizontal overflow.
The spreadsheet browser payload was a transport fixture; actual XLSX parsing was
verified separately in the parser/handler tests above. The only browser console
errors were the unavailable local Vercel Analytics script. Screenshots are ignored
local artifacts in `output/playwright/`. No live government request or real model
answer was represented by these UI fixtures. The operator's existing localhost
server on port 3000 was left running.
