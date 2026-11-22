import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local runs read TEST_DATABASE_URL from the repo-root .env; CI sets it directly.
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (!process.env.CI && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
