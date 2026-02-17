import type pino from "pino";

type EmbedPayload = {
  readonly embeds: ReadonlyArray<Record<string, unknown>>;
};

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1_000;

export async function sendWebhook(
  webhookUrl: string,
  payload: EmbedPayload,
  logger: pino.Logger,
): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter ? Number(retryAfter) * 1_000 : BASE_DELAY_MS * 2 ** attempt;
        logger.warn({ attempt, waitMs }, "rate limited by Discord, retrying");
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.error({ status: res.status, body }, "Discord webhook failed");
        return false;
      }

      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        logger.warn({ attempt, delay, error: message }, "webhook send retry");
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error({ error: message }, "webhook send failed after retries");
        return false;
      }
    }
  }
  return false;
}

export async function sendAdminNotification(
  webhookUrl: string | undefined,
  message: string,
  logger: pino.Logger,
): Promise<void> {
  if (!webhookUrl) return;
  await sendWebhook(
    webhookUrl,
    {
      embeds: [
        {
          title: "⚠️ Admin Alert",
          description: message,
          color: 0xff6600,
          timestamp: new Date().toISOString(),
        },
      ],
    },
    logger,
  );
}
