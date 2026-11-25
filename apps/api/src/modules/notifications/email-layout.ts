/**
 * One look for every email, matching the website: a cream page, a white card with the kalash
 * logo and a serif heading, a vermilion button, and the banana-leaf green footer.
 *
 * Emails are written as structured content and rendered twice: HTML for mail apps that show
 * it, and plain text for those that don't (and for tests and logs). The HTML uses tables and
 * inline styles because Gmail, Outlook and Apple Mail ignore most modern CSS. Every value is
 * escaped: names, venue names and admin reasons come from users.
 */
export interface EmailContent {
  subject: string;
  /** The grey line inbox lists show after the subject. Defaults to the first paragraph. */
  preheader?: string;
  heading: string;
  /** Greeting name, e.g. "Meera". Omit for messages not addressed to a known person. */
  greetingName?: string;
  paragraphs: string[];
  /** A small table of facts, e.g. reference, date, amount paid. */
  details?: { label: string; value: string }[];
  /** The one thing to do next, shown as a button. */
  action?: { label: string; url: string };
  /** Paragraphs after the button, e.g. "If you didn't ask for this, ignore this email." */
  afterAction?: string[];
  /** Muted small print at the bottom of the card. */
  note?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const C = {
  page: '#f6f3ee',
  card: '#ffffff',
  border: '#e4ded4',
  ink: '#1c1917',
  body: '#433d38',
  muted: '#6b6259',
  brand: '#c2410c',
  brandDark: '#9a3412',
  forest: '#173d30',
  forestText: '#a9c4b5',
  marigold: '#ffe199',
  detailBg: '#f8f6f2',
};

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS =
  "'Inter', 'Noto Sans Malayalam', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

/** Only http(s) links may become buttons or hrefs; anything else is left out. */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function safeUrl(url: string): string {
  return isHttpUrl(url) ? url : '#';
}

export function renderEmail(content: EmailContent, appBaseUrl: string): RenderedEmail {
  return {
    subject: content.subject,
    text: renderText(content, appBaseUrl),
    html: renderHtml(content, appBaseUrl),
  };
}

function renderText(c: EmailContent, appBaseUrl: string): string {
  const parts: string[] = [];
  if (c.greetingName) parts.push(`Hi ${c.greetingName},`);
  parts.push(...c.paragraphs);
  if (c.details?.length) parts.push(c.details.map((d) => `${d.label}: ${d.value}`).join('\n'));
  if (c.action && isHttpUrl(c.action.url)) parts.push(`${c.action.label}: ${c.action.url}`);
  if (c.afterAction?.length) parts.push(...c.afterAction);
  if (c.note) parts.push(c.note);
  parts.push(`MandapamBook\n${appBaseUrl}`);
  return parts.join('\n\n');
}

function renderHtml(c: EmailContent, appBaseUrl: string): string {
  const e = escapeHtml;
  const home = e(safeUrl(appBaseUrl));
  const preheader = c.preheader ?? c.paragraphs[0] ?? '';
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.body};">${e(text)}</p>`;

  const details = c.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${C.detailBg};border:1px solid ${C.border};border-radius:16px;">
        <tr><td style="padding:8px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${c.details
              .map(
                (d, i) => `<tr>
              <td style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${SANS};font-size:14px;color:${C.muted};width:40%;vertical-align:top;">${e(d.label)}</td>
              <td style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${SANS};font-size:14px;font-weight:600;color:${C.ink};text-align:right;vertical-align:top;">${e(d.value)}</td>
            </tr>`,
              )
              .join('')}
          </table>
        </td></tr>
      </table>`
    : '';

  const action =
    c.action && isHttpUrl(c.action.url)
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr><td style="border-radius:999px;background:${C.brand};">
          <a href="${e(safeUrl(c.action.url))}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${e(c.action.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 24px;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.muted};">If the button doesn't work, copy this link into your browser:<br /><a href="${e(safeUrl(c.action.url))}" style="color:${C.brandDark};word-break:break-all;">${e(c.action.url)}</a></p>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${e(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td style="padding:0 8px 20px;">
        <a href="${home}" target="_blank" rel="noopener" style="text-decoration:none;">
          <img src="${home}/email/kalash.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;" />
          <span style="vertical-align:middle;margin-left:8px;font-family:${SERIF};font-size:22px;font-weight:500;color:${C.ink};letter-spacing:-0.3px;">MandapamBook</span>
        </a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:24px;padding:40px 36px 28px;">
        <h1 style="margin:0 0 20px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:400;color:${C.ink};letter-spacing:-0.4px;">${e(c.heading)}</h1>
        ${c.greetingName ? p(`Hi ${c.greetingName},`) : ''}
        ${c.paragraphs.map(p).join('')}
        ${details}
        ${action}
        ${(c.afterAction ?? []).map(p).join('')}
        ${c.note ? `<p style="margin:8px 0 0;padding-top:20px;border-top:1px solid ${C.border};font-family:${SANS};font-size:13px;line-height:1.5;color:${C.muted};">${e(c.note)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:24px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.forest};border-radius:24px;">
          <tr><td style="padding:24px 36px;">
            <p style="margin:0;font-family:${SERIF};font-size:18px;color:#ffffff;">MandapamBook</p>
            <p style="margin:6px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.forestText};">Kalyana mandapams, convention halls and auditoriums across India.</p>
            <p style="margin:12px 0 0;font-family:${SERIF};font-size:14px;color:${C.marigold};">Shubh Vivah · ശുഭ വിവാഹം · शुभ विवाह</p>
            <p style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.forestText};">You received this email because of your account on <a href="${home}" style="color:#ffffff;">MandapamBook</a>. We never ask for your password or OTP by email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
