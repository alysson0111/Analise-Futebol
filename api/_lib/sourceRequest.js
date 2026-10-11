const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchSourceText(url, { headers, timeouts = [20000], fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeouts[attempt])
      });
      if (!response.ok) {
        const error = new Error(`TotalCorner retornou ${response.status}.`);
        error.retryable = RETRYABLE_STATUSES.has(response.status);
        throw error;
      }
      return await response.text();
    } catch (error) {
      const retryable = error.retryable || ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
      if (!retryable || attempt === timeouts.length - 1) {
        if (["TimeoutError", "AbortError"].includes(error.name)) {
          throw new Error("A fonte TotalCorner demorou para responder. Nova tentativa na proxima atualizacao.");
        }
        throw error;
      }
    }
  }
  throw new Error("Nenhuma tentativa de consulta configurada.");
}
