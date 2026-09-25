import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Aplica migrações SQL versionadas em ordem, uma transação por arquivo, com
 * advisory lock (execução única) e checksum (arquivo aplicado não pode mudar).
 * Deve rodar com a credencial de migração (gct_owner), nunca a do runtime.
 */
export async function migrate(connectionString: string, dir = MIGRATIONS_DIR, log = console.log): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(`create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>('select version, checksum from schema_migrations');
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migração ${file} foi alterada após aplicada (checksum diferente).`);
        result.skipped.push(file);
        continue;
      }
      log(`aplicando ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Falha em ${file}: ${(e as Error).message}`);
      }
      result.applied.push(file);
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return result;
}
