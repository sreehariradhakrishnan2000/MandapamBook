import { Router } from 'express';

export type ReadinessCheck = () => Promise<void>;

/**
 * /health: the process is up (liveness).
 * /ready: dependencies are reachable (readiness).
 * Readiness reports only check names and pass/fail, never connection details.
 */
export function healthRouter(checks: Record<string, ReadinessCheck>, timeoutMs = 2000): Router {
  const router = Router();

  // The build's commit (short), so a deploy can confirm the new version is serving.
  const version = (process.env['APP_VERSION'] ?? 'dev').slice(0, 12);
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version });
  });

  router.get('/ready', async (req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, 'ok'] as const;
        } catch (err) {
          req.log.warn({ check: name, err }, 'readiness check failed');
          return [name, 'fail'] as const;
        }
      }),
    );
    const ready = entries.every(([, s]) => s === 'ok');
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? 'ready' : 'not_ready', checks: Object.fromEntries(entries) });
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
