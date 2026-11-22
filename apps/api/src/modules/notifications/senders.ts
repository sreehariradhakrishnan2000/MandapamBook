import type { Logger } from 'pino';

/**
 * Delivery abstractions. Auth depends only on these interfaces; Phase 7 adds SMTP
 * and SMS gateway implementations selected by EMAIL_PROVIDER / OTP_PROVIDER.
 */
export interface EmailMessage {
  to: string;
  template:
    | 'verify_email'
    | 'password_reset'
    | 'account_exists'
    | 'security_alert'
    | 'listing_decision'
    | 'kyc_decision';
  subject: string;
  text: string;
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

/** Development only: writes messages to the log so links and codes can be copied. */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { mail: { template: message.template, subject: message.subject, body: message.text } },
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
