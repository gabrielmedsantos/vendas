// Gera tipos Kysely a partir do banco migrado (DATABASE_URL de owner).
import { execFileSync } from 'node:child_process';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://gct_owner:dev_owner@localhost:5432/gct_dev';
execFileSync(
  'npx',
  [
    'kysely-codegen',
    '--dialect', 'postgres',
    '--url', url,
    '--date-parser', 'string',
    '--type-mapping', JSON.stringify({ int8: 'bigint' }),
    '--exclude-pattern', 'schema_migrations',
    '--out-file', 'src/schema.ts',
  ],
  { stdio: 'inherit' },
);
