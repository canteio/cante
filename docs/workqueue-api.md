# Work queue filter contract

`GET /api/workqueue` returns `{ "queue": [...], "summary": {...} }`.

The optional query parameter `includeResolved` accepts the case-sensitive strings `true` and `false`. Omission defaults to `false`. Use `true` to include resolved tasks; use `false` to hide them. An empty value, different capitalization, numeric boolean, or any other value returns HTTP 400 with a JSON error before customer lookup:

```json
{"error":"includeResolved must be 'true' or 'false'; omit it to hide resolved tasks."}
```

Example: `/api/workqueue?includeResolved=true`. The dashboard's "Show All (Including Resolved)" toggle sends this same boolean contract. Clients should check the HTTP status before interpreting a response as an empty queue.

This document covers the resolved-task filter only, not the full work queue response or POST schema.
