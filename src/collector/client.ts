import type pino from "pino";
import { lorisResponseSchema, type LorisResponse } from "./schema.ts";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

export async function fetchLorisData(
  apiUrl: string,
  logger: pino.Logger,
): Promise<LorisResponse | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json: unknown = await res.json();
      const result = lorisResponseSchema.safeParse(json);
      if (!result.success) {
        logger.error({ errors: result.error.issues }, "zod parse failed for Loris response");
        return null;
      }
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        logger.warn({ attempt: attempt + 1, delay, error: message }, "fetch retry");
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error({ error: message }, "fetch failed after all retries");
        return null;
      }
    }
  }
  return null;
}
