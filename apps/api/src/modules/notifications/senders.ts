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

/** Sends through SMTP. Works with Mailpit (smtp://localhost:1025) and production relays. */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      headers: { 'X-MandapamBook-Template': message.template },
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
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
    return new SmtpEmailSender(env.SMTP_URL, env.EMAIL_FROM);
  if (env.EMAIL_PROVIDER === 'file' && env.EMAIL_FILE_DIR)
    return new FileEmailSender(env.EMAIL_FILE_DIR);
  return new ConsoleEmailSender(logger);
}
