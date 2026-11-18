// OpenAI-compatible provider calls, all through the /relay dev-server middleware.
// STUB: the engine agent implements these. Signatures are the contract.

/** GET /models. -> { ok: true, ms, models: string[] } | { ok: false, error: { code, status, message } } */
export async function testConnection(provider) {}

/** GET /audio/voices. -> { ok: true, voices: string[] } | { ok: false, notFound?: boolean, error } */
export async function fetchVoices(provider) {}
