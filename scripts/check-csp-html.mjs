#!/usr/bin/env node
/**
 * Fails when the built web index.html contains inline scripts or inline event handlers.
 *
 * nginx serves the app with `script-src 'self'` (docker/security-headers.inc.template), so
 * anything inline is blocked in staging and production, though it works under `ng serve`.
 * Angular's critical-CSS inlining once added an inline script that switched the stylesheet
 * from media="print" to "all"; with it blocked, every page rendered unstyled.
 *
 *   node scripts/check-csp-html.mjs [path/to/index.html]
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'apps/web/dist/web/browser/index.html';
const html = readFileSync(file, 'utf8');
const problems = [];

for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const [, attrs, body] = m;
  if (!/\bsrc\s*=/.test(attrs) && body.trim())
    problems.push(`inline <script>: ${body.trim().slice(0, 80)}`);
}
for (const m of html.matchAll(/\s(on[a-z]+)\s*=\s*["']/gi))
  problems.push(`inline event handler: ${m[1]}`);
if (/media=["']print["'][^>]*data-beasties-media/i.test(html)) {
  problems.push('stylesheet left as media="print" (critical-CSS inlining is on)');
}

if (problems.length) {
  console.error(`${file} would break under script-src 'self':\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${file}: no inline scripts or handlers.`);
