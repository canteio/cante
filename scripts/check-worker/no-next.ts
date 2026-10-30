/** Next's cookie adapter is intentionally absent from the standalone worker. */
export async function cookies(): Promise<never> { throw Error("No browser-cookie access in the isolated worker."); }
