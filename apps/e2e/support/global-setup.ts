import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DATABASE_URL, E2E_MIGRATION_URL, MAIL_DIR, ROOT, apiEnv } from '../env.js';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const shell = process.platform === 'win32';

/**
 * Fresh database and mailbox per run (the admin password is random and never stored),
 * then the background worker, which delivers emails and runs the sweep every 3 seconds.
 * Returns the teardown that stops the worker.
 */
export default function globalSetup(): () => void {
  rmSync(MAIL_DIR, { recursive: true, force: true });
  process.env['E2E_ADMIN_EMAIL'] = 'e2e-admin@example.test';
  process.env['E2E_ADMIN_PASSWORD'] = randomBytes(18).toString('base64url');
  execFileSync(
    pnpm,
    ['--filter', '@mandapambook/api', 'exec', 'tsx', join(ROOT, 'apps/e2e/support/prepare-db.ts')],
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell,
      env: { ...process.env, E2E_DATABASE_URL, E2E_MIGRATION_URL },
    },
  );

  const worker: ChildProcess = spawn(
    pnpm,
    ['--filter', '@mandapambook/api', 'exec', 'tsx', 'src/worker.ts'],
    {
      cwd: ROOT,
      shell,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...apiEnv(), SWEEP_INTERVAL_SECONDS: '3' },
    },
  );
  return () => {
    if (worker.pid === undefined || worker.exitCode !== null) return;
    if (process.platform === 'win32') {
      // pnpm.cmd starts a process tree; stop all of it.
      execFileSync('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      worker.kill('SIGTERM');
    }
  };
}
