import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConsoleEmailSender,
  FileEmailSender,
  SmtpEmailSender,
  createEmailSender,
} from '../../src/modules/notifications/senders.js';

const logger = pino({ level: 'silent' });
let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('email senders', () => {
  it('picks the transport from EMAIL_PROVIDER', () => {
    const from = 'MandapamBook <no-reply@example.test>';
    expect(
      createEmailSender({ EMAIL_PROVIDER: 'console', EMAIL_FROM: from }, logger),
    ).toBeInstanceOf(ConsoleEmailSender);
    expect(
      createEmailSender({ EMAIL_PROVIDER: 'file', EMAIL_FILE_DIR: '/x', EMAIL_FROM: from }, logger),
    ).toBeInstanceOf(FileEmailSender);
    expect(
      createEmailSender(
        { EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://localhost:1025', EMAIL_FROM: from },
        logger,
      ),
    ).toBeInstanceOf(SmtpEmailSender);
  });

  it('writes one JSON file per message without attachment contents', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mb-mail-'));
    const sender = new FileEmailSender(dir);
    await sender.send({
      to: 'a@example.test',
      template: 'verify_email',
      subject: 'Verify',
      text: 'link',
    });
    await sender.send({
      to: 'b@example.test',
      template: 'booking_confirmed',
      subject: 'Confirmed',
      text: 'ok',
      attachments: [
        { filename: 'inv.pdf', content: Buffer.from('%PDF-1'), contentType: 'application/pdf' },
      ],
    });
    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(2);
    const second = JSON.parse(await readFile(join(dir, files[1]!), 'utf8'));
    expect(second).toMatchObject({
      to: 'b@example.test',
      attachments: [{ filename: 'inv.pdf', bytes: 6 }],
    });
    expect(JSON.stringify(second)).not.toContain('%PDF');
  });
});
