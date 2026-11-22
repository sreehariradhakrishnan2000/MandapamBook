import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { MAIL_DIR } from '../env.js';

export interface SentMail {
  to: string;
  template: string;
  subject: string;
  text: string;
  attachments?: { filename: string; bytes: number }[];
}

async function all(): Promise<SentMail[]> {
  const files = await readdir(MAIL_DIR).catch(() => [] as string[]);
  const out: SentMail[] = [];
  for (const f of files.sort())
    out.push(JSON.parse(await readFile(join(MAIL_DIR, f), 'utf8')) as SentMail);
  return out;
}

/** Waits for an email to `to` (optionally a given template) and returns the newest one. */
export async function waitForMail(
  to: string,
  template?: string,
  timeout = 60_000,
): Promise<SentMail> {
  let found: SentMail | undefined;
  await expect
    .poll(
      async () => {
        found = (await all())
          .filter((m) => m.to === to && (!template || m.template === template))
          .at(-1);
        return Boolean(found);
      },
      { timeout, message: `email ${template ?? ''} to ${to}` },
    )
    .toBe(true);
  return found!;
}

/** The first link in the email that points at the web app. */
export function linkIn(mail: SentMail, base: string): string {
  const link = mail.text.split(/\s+/).find((word) => word.startsWith(base));
  if (!link) throw new Error(`No ${base} link in "${mail.subject}"`);
  return link;
}
