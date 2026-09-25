import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../packages/db/src/migrator';
import { ADMIN_URL, TEST_DB, URLS } from './env';

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.end();
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  execFileSync('psql', [
    ADMIN_URL, '-q', '-v', 'ON_ERROR_STOP=1',
    '-v', `owner_pw=${process.env.GCT_OWNER_PASSWORD ?? 'dev_owner'}`,
    '-v', `app_pw=${process.env.GCT_APP_PASSWORD ?? 'dev_app'}`,
    '-v', `auth_pw=${process.env.GCT_AUTH_PASSWORD ?? 'dev_auth'}`,
    '-v', `platform_pw=${process.env.GCT_PLATFORM_PASSWORD ?? 'dev_platform'}`,
    '-v', `public_pw=${process.env.GCT_PUBLIC_PASSWORD ?? 'dev_public'}`,
    '-v', `db_name=${TEST_DB}`,
    '-f', join(root, 'infra', 'db', 'roles.sql'),
  ], { stdio: 'pipe' });
  await migrate(URLS.owner, undefined, () => undefined);
}
