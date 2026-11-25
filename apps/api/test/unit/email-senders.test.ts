import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundEmailSender,
  ConsoleEmailSender,
  type EmailMessage,
  FileEmailSender,
  SMTP_TIMEOUTS,
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

/**
 * A tiny SMTP server for tests: accepts any sender, refuses recipients at refused.test,
 * and records the messages it accepted.
 */
async function fakeSmtp(): Promise<{ url: string; received: string[]; close: () => void }> {
  const received: string[] = [];
  const server = createNetServer((socket) => {
    let data = false;
    let body = '';
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            received.push(body);
            body = '';
            socket.write('250 queued as TEST1\r\n');
          } else body += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 fake\r\n');
        else if (cmd === 'MAIL') socket.write('250 ok\r\n');
        else if (cmd === 'RCPT')
          socket.write(line.includes('@refused.test') ? '550 no such user\r\n' : '250 ok\r\n');
        else if (cmd === 'DATA') {
          data = true;
          socket.write('354 go ahead\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else if (cmd === 'RSET' || cmd === 'NOOP') socket.write('250 ok\r\n');
        else socket.write('502 unsupported\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `smtp://127.0.0.1:${port}`, received, close: () => server.close() };
}

const message = {
  to: 'someone@example.test',
  template: 'password_reset' as const,
  subject: 'Reset your MandapamBook password',
  text: 'Reset your password by opening https://example.test/reset-password?token=abc',
};

describe('SmtpEmailSender', () => {
  it('delivers a message and logs only the recipient domain', async () => {
    const smtp = await fakeSmtp();
    const lines: string[] = [];
    const log = pino({ level: 'info' }, { write: (l: string) => lines.push(l) });
    try {
      const sender = new SmtpEmailSender(smtp.url, 'MandapamBook <no-reply@example.test>', log);
      expect(await sender.verify()).toBe(true);
      await sender.send(message);
      expect(smtp.received).toHaveLength(1);
      expect(smtp.received[0]).toContain('Subject: Reset your MandapamBook password');
      expect(smtp.received[0]).toMatch(/^X-MandapamBook-Template: password_reset$/im);
      const logged = lines.join('');
      expect(logged).toContain('"toDomain":"example.test"');
      expect(logged).not.toContain('someone@');
      expect(logged).not.toContain('token=abc');
    } finally {
      smtp.close();
    }
  });

  it('fails when the server refuses the recipient', async () => {
    const smtp = await fakeSmtp();
    try {
      const sender = new SmtpEmailSender(smtp.url, 'no-reply@example.test');
      await expect(sender.send({ ...message, to: 'nobody@refused.test' })).rejects.toThrow();
      expect(smtp.received).toHaveLength(0);
    } finally {
      smtp.close();
    }
  });

  it('reports an unreachable server quickly instead of hanging', async () => {
    const closed = await fakeSmtp();
    closed.close();
    const sender = new SmtpEmailSender(closed.url, 'no-reply@example.test');
    const started = Date.now();
    expect(await sender.verify()).toBe(false);
    await expect(sender.send(message)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(SMTP_TIMEOUTS.connectionTimeout);
  });
});

describe('BackgroundEmailSender', () => {
  it('returns at once, so a slow mail server never holds up the request', async () => {
    let release = (): void => undefined;
    const inner = { send: vi.fn(() => new Promise<void>((r) => (release = r))) };
    const sender = new BackgroundEmailSender(inner, logger, []);
    await sender.send(message); // resolves although the inner send is still waiting
    expect(inner.send).toHaveBeenCalledTimes(1);
    release();
    await sender.drain();
  });

  it('retries a failed send, then succeeds', async () => {
    const inner = {
      send: vi
        .fn<(m: EmailMessage) => Promise<void>>()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(undefined),
    };
    const sender = new BackgroundEmailSender(inner, logger, [1, 1]);
    await sender.send(message);
    await sender.drain();
    expect(inner.send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries, logs the failure, and never throws to the caller', async () => {
    const lines: string[] = [];
    const log = pino({ level: 'info' }, { write: (l: string) => lines.push(l) });
    const inner = { send: vi.fn(() => Promise.reject(new Error('auth failed'))) };
    const sender = new BackgroundEmailSender(inner, log, [1, 1]);
    await expect(sender.send(message)).resolves.toBeUndefined();
    await sender.drain();
    expect(inner.send).toHaveBeenCalledTimes(3);
    const final = lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'email not delivered');
    expect(final).toMatchObject({
      level: 50,
      attempts: 3,
      mail: { template: 'password_reset', toDomain: 'example.test' },
    });
  });
});
