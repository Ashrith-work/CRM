/**
 * Loads apps/api/.env into process.env for the integration (e2e) tests, which
 * boot the real PrismaService and connect to the dev Postgres. Keeps secrets
 * out of source. Existing process.env values win.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

try {
  const content = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env is optional if the environment already provides DATABASE_URL.
}
