import { and, count, eq, gte, max, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { notifications, platformSettings } from '../../db/schema/index.js';
import { renderEmail } from '../notifications/email-layout.js';
import type { EmailSender } from '../notifications/senders.js';

export interface EmailHealth {
  provider: string;
  /** When a booking email last went out successfully. */
  lastSentAt: string | null;
  /** Booking emails that gave up after all retries in the last 24 hours. */
  failedLast24h: number;
  /** Booking emails waiting to be sent or retried. */
  queued: number;
  /** When the SMTP key expires (from SMTP_KEY_EXPIRES_AT), and how many days are left. */
  smtpKeyExpiresAt: string | null;
  daysUntilKeyExpiry: number | null;
}

/** Days before the key expires that reminders start. */
export const KEY_REMINDER_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * The health of things that fail quietly: email delivery and the SMTP key's expiry.
 * Admins see it on the dashboard; the sweep emails ADMIN_NOTIFY_EMAIL when it needs action.
 */
export class SystemHealth {
  constructor(
    private readonly db: Db,
    private readonly config: {
      emailProvider: string;
      smtpKeyExpiresAt?: string | undefined;
      adminEmail?: string | undefined;
      appBaseUrl: string;
      /** Where alert timestamps are stored; tests use their own. */
      alertKeyPrefix?: string;
    },
  ) {}

  async email(now = new Date()): Promise<EmailHealth> {
    const since = new Date(now.getTime() - DAY_MS);
    const [[sent], [failed], [queued]] = await Promise.all([
      this.db
        .select({ at: max(notifications.sentAt) })
        .from(notifications)
        .where(eq(notifications.status, 'SENT')),
      this.db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.status, 'FAILED'), gte(notifications.createdAt, since))),
      this.db.select({ n: count() }).from(notifications).where(eq(notifications.status, 'QUEUED')),
    ]);
    const expires = this.config.smtpKeyExpiresAt ?? null;
    return {
      provider: this.config.emailProvider,
      lastSentAt: sent?.at ? new Date(sent.at).toISOString() : null,
      failedLast24h: Number(failed?.n ?? 0),
      queued: Number(queued?.n ?? 0),
      smtpKeyExpiresAt: expires,
      daysUntilKeyExpiry: expires
        ? Math.ceil((Date.parse(`${expires}T00:00:00+05:30`) - now.getTime()) / DAY_MS)
        : null,
    };
  }

  /**
   * Emails the admin when something needs doing: the SMTP key expires within 30 days
   * (at most weekly), or booking emails failed in the last day (at most daily). Safe to
   * call often and from several processes: each alert claims its slot in the database.
   */
  async sendAlerts(email: EmailSender, logger: Logger, now = new Date()): Promise<string[]> {
    const to = this.config.adminEmail;
    if (!to) return [];
    const health = await this.email(now);
    const sent: string[] = [];

    const days = health.daysUntilKeyExpiry;
    if (
      days !== null &&
      days <= KEY_REMINDER_DAYS &&
      (await this.claim('smtp_key_expiry', 7, now))
    ) {
      const when = days <= 0 ? 'has expired' : `expires in ${days} day${days === 1 ? '' : 's'}`;
      await this.send(email, to, logger, {
        subject: `Action needed: the email (SMTP) key ${when}`,
        heading: `Your email key ${when}`,
        paragraphs: [
          `The SMTP key MandapamBook uses to send email ${when} (${health.smtpKeyExpiresAt}). When it stops working, customers stop getting verification links, password resets and booking confirmations.`,
          'Create a new key in Brevo (SMTP & API → SMTP → Generate a new SMTP key), put it in SMTP_URL on the API server, set SMTP_KEY_EXPIRES_AT to its new expiry date, and redeploy.',
        ],
        note: 'Brevo keys also stop working after 90 days without sending.',
      });
      sent.push('smtp_key_expiry');
    }

    if (health.failedLast24h > 0 && (await this.claim('email_failures', 1, now))) {
      await this.send(email, to, logger, {
        subject: `Warning: ${health.failedLast24h} booking email(s) could not be delivered`,
        heading: 'Some booking emails were not delivered',
        paragraphs: [
          `${health.failedLast24h} booking email(s) failed after every retry in the last 24 hours. Customers or venue owners may be missing confirmations.`,
          'Check the email provider (Brevo) dashboard and the API logs, and that the SMTP key is still valid.',
        ],
        details: [
          { label: 'Failed (24 h)', value: String(health.failedLast24h) },
          { label: 'Waiting to send', value: String(health.queued) },
          { label: 'Last successful', value: health.lastSentAt ?? 'never' },
        ],
        action: { label: 'Open admin', url: `${this.config.appBaseUrl}/admin` },
      });
      sent.push('email_failures');
    }
    return sent;
  }

  private async send(
    email: EmailSender,
    to: string,
    logger: Logger,
    content: Parameters<typeof renderEmail>[0],
  ): Promise<void> {
    try {
      await email.send({
        to,
        template: 'security_alert',
        ...renderEmail(content, this.config.appBaseUrl),
      });
    } catch (err) {
      // If email itself is broken, the dashboard and the logs still show the problem.
      logger.error({ err, alert: content.subject }, 'system alert email failed');
    }
  }

  /**
   * Atomically claims an alert slot: true for the first caller since `everyDays` ago,
   * false for everyone else, so several API instances never send the same alert twice.
   */
  private async claim(alert: string, everyDays: number, now: Date): Promise<boolean> {
    const key = `${this.config.alertKeyPrefix ?? 'alert_last_sent'}:${alert}`;
    const cutoff = new Date(now.getTime() - everyDays * DAY_MS).toISOString();
    const value = { at: now.toISOString() };
    const rows = await this.db
      .insert(platformSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value },
        setWhere: sql`(${platformSettings.value}->>'at') < ${cutoff}`,
      })
      .returning({ key: platformSettings.key });
    return rows.length > 0;
  }
}
