/** Retries temporary model errors (429 rate limit, 500/503 overloaded) with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 800): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (i >= tries - 1 || !/\b(429|500|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
}
