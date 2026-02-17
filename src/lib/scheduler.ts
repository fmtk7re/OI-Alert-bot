import type pino from "pino";

export function createScheduler(opts: {
  readonly intervalMs: number;
  readonly onTick: () => Promise<void>;
  readonly logger: pino.Logger;
}): { start: () => void; stop: () => void } {
  const { intervalMs, onTick, logger } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) {
      logger.warn("previous tick still running, skipping");
      return;
    }
    running = true;
    try {
      await onTick();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "tick failed");
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      logger.info({ intervalMs }, "scheduler started");
      // Run first tick immediately
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info("scheduler stopped");
      }
    },
  };
}
