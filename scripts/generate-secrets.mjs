#!/usr/bin/env node
// Prints fresh auth secrets in .env format. Run once per environment and store the
// output in that environment's secret manager (or your local .env). Never commit it.
//
//   node scripts/generate-secrets.mjs            # all secrets
//   node scripts/generate-secrets.mjs --rotate   # a new access/refresh key to PREPEND to the rings
import { randomBytes } from 'node:crypto';

const secret = () => randomBytes(32).toString('base64url');
const kid = (prefix) => `${prefix}${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

if (process.argv.includes('--rotate')) {
  console.log(`# Prepend to ACCESS_TOKEN_KEYS:  ${kid('a')}:${secret()},`);
  console.log(`# Prepend to REFRESH_TOKEN_KEYS: ${kid('r')}:${secret()},`);
  console.log(
    '# Remove the old access key after 1 hour, the old refresh key after REFRESH_TOKEN_REMEMBER_DAYS.',
  );
} else {
  console.log(`ACCESS_TOKEN_KEYS=${kid('a')}:${secret()}`);
  console.log(`REFRESH_TOKEN_KEYS=${kid('r')}:${secret()}`);
  console.log(`CSRF_SECRET=${secret()}`);
  console.log(`OTP_SECRET=${secret()}`);
}
