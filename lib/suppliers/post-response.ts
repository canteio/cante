const INVALID_RESPONSE = "Supplier service returned an invalid response. Try again.";

/** Decode a supplier mutation response without leaking JSON parse failures into the UI. */
export async function readSupplierPostResponse(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(`Supplier request failed (status ${response.status}).`);
    throw new Error(INVALID_RESPONSE);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    if (!response.ok) throw new Error(`Supplier request failed (status ${response.status}).`);
    throw new Error(INVALID_RESPONSE);
  }

  const data = payload as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof data.error === "string" && data.error.trim() ? data.error : null;
    throw new Error(detail ?? `Supplier request failed (status ${response.status}).`);
  }

  return data;
}
