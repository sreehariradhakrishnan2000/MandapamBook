import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { BookingTemplate } from './templates.js';

/**
 * Delivery abstractions. Business code depends only on these interfaces; EMAIL_PROVIDER
 * selects console (development) or SMTP (Mailpit locally, any SMTP relay in production).
 * SMS stays behind SmsSender; a gateway implementation is added when one is chosen.
 */
export interface EmailMessage {
  to: string;
  template:
    | 'verify_email'
    | 'password_reset'
    | 'account_exists'
    | 'security_alert'
    | 'listing_decision'
    | 'kyc_decision'
    | BookingTemplate;
  subject: string;
  text: string;
  /** The designed version (see email-layout.ts). Mail apps show it; `text` is the fallback. */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SmsMessage {
  to: string;
  text: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

/** Only the domain of an address, for logs: enough to trace delivery, not to identify. */
export function recipientDomain(address: string): string {
  return address.split('@')[1]?.toLowerCase() ?? 'invalid';
}

/** SMTP waits. nodemailer's defaults (2 min to connect, 10 min idle) would hang a request. */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** Sends through SMTP. Works with Mailpit (smtp://localhost:1025) and production relays. */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly logger?: Logger,
  ) {
    this.transport = nodemailer.createTransport({ url: smtpUrl, ...SMTP_TIMEOUTS });
  }

  /** Checks the server and credentials; resolves false (and logs why) instead of throwing. */
  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      this.logger?.info('smtp connection verified');
      return true;
    } catch (err) {
      this.logger?.error({ err }, 'smtp connection failed: emails will not be delivered');
      return false;
    }
  }

  async send(message: EmailMessage): Promise<void> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      headers: { 'X-MandapamBook-Template': message.template },
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    // A server can accept the connection yet refuse the recipient; that is a failed send.
    if ((info.rejected?.length ?? 0) > 0 || (info.accepted?.length ?? 0) === 0) {
      throw new Error(`smtp server refused the recipient: ${String(info.response)}`);
    }
    this.logger?.info(
      {
        mail: {
          template: message.template,
          toDomain: recipientDomain(message.to),
          messageId: info.messageId,
        },
      },
      'email accepted by smtp server',
    );
  }
}

const RETRY_DELAYS_MS = [5_000, 30_000];

/**
 * For emails sent while handling a request (verification links, password resets, security
 * alerts, admin decisions). The request never waits for, or fails because of, the mail
 * server: delivery runs in the background, retries twice, and logs the outcome. These
 * messages carry one-time links, so they are not stored in the notification outbox.
 */
export class BackgroundEmailSender implements EmailSender {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly inner: EmailSender,
    private readonly logger: Logger,
    private readonly delaysMs: readonly number[] = RETRY_DELAYS_MS,
  ) {}

  send(message: EmailMessage): Promise<void> {
    const job = this.deliver(message).finally(() => this.pending.delete(job));
    this.pending.add(job);
    return Promise.resolve();
  }

  /** Resolves when every background send has finished (used on shutdown and in tests). */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async deliver(message: EmailMessage): Promise<void> {
    const context = { template: message.template, toDomain: recipientDomain(message.to) };
    for (let attempt = 0; ; attempt++) {
      try {
        await this.inner.send(message);
        return;
      } catch (err) {
        const delay = this.delaysMs[attempt];
        if (delay === undefined) {
          this.logger.error({ err, mail: context, attempts: attempt + 1 }, 'email not delivered');
          return;
        }
        this.logger.warn({ err, mail: context, retryInMs: delay }, 'email failed, retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

/**
 * End-to-end tests only (refused in production): writes each message as JSON so a test can
 * open the real verification link. Attachments are recorded by name and size only.
 */
export class FileEmailSender implements EmailSender {
  private seq = 0;
  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${process.pid}-${++this.seq}.json`;
    const { attachments, ...rest } = message;
    await writeFile(
      join(this.dir, name),
      JSON.stringify({
        ...rest,
        attachments: attachments?.map((a) => ({ filename: a.filename, bytes: a.content.length })),
      }),
    );
  }
}

/** Development only: writes messages to the log so links and codes can be copied. */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<void> {
    this.logger.info(
      {
        mail: {
          template: message.template,
          subject: message.subject,
          body: message.text,
          attachments: message.attachments?.map((a) => a.filename),
        },
      },
      'email (console provider)',
    );
  }
}

export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly logger: Logger) {}
  async send(message: SmsMessage): Promise<void> {
    this.logger.info({ sms: { body: message.text } }, 'sms (console provider)');
  }
}

/** Test double that records what was sent. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export class MemorySmsSender implements SmsSender {
  readonly sent: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(to: string): SmsMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

/** Picks the email transport from EMAIL_PROVIDER. Production refuses 'console' at startup. */
export function createEmailSender(
  env: {
    EMAIL_PROVIDER: 'console' | 'file' | 'smtp';
    SMTP_URL?: string | undefined;
    EMAIL_FILE_DIR?: string | undefined;
    EMAIL_FROM: string;
  },
  logger: Logger,
): EmailSender {
  if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_URL)
    return new SmtpEmailSender(env.SMTP_URL, env.EMAIL_FROM, logger);
  if (env.EMAIL_PROVIDER === 'file' && env.EMAIL_FILE_DIR)
    return new FileEmailSender(env.EMAIL_FILE_DIR);
  return new ConsoleEmailSender(logger);
}
