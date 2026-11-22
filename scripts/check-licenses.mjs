#!/usr/bin/env node
// Fails if any production dependency is licensed under a denied license (GPL-3.0, AGPL-3.0).
// Reads `pnpm licenses list --prod --json` from stdin, or from the file given as argv[2].
// LGPL and GPL-2.0 are allowed. An SPDX expression is denied if it names a denied license
// at all, so a dual license such as "(MIT OR GPL-3.0)" is flagged for a human to review.
import { readFileSync } from 'node:fs';

const DENIED = /(^|[^L\w])A?GPL-3\.0/i;

const input = readFileSync(process.argv[2] ?? 0, 'utf8');
const byLicense = JSON.parse(input);

const denied = [];
for (const [license, packages] of Object.entries(byLicense)) {
  if (!DENIED.test(license)) continue;
  for (const pkg of packages) denied.push(`${license}  ${pkg.name}@${pkg.versions.join(',')}`);
}

if (denied.length > 0) {
  console.error(`Denied licenses in production dependencies:\n${denied.join('\n')}`);
  process.exit(1);
}
console.log(`No denied licenses (${Object.keys(byLicense).length} license kinds checked)`);
