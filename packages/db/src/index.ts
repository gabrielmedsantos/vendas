import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

export type { DB } from './schema';
export * as S from './schema';
export { sql };
export { migrate, MIGRATIONS_DIR } from './migrator';

// int8 → BigInt (dinheiro em centavos); date → 'YYYY-MM-DD' (sem fuso implícito).
pg.types.setTypeParser(20, (v) => BigInt(v));
pg.types.setTypeParser(1082, (v) => v);

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export interface DatabaseConfig {
  /** runtime empresarial (RLS forçado) */
  appUrl: string;
  /** identidade/sessões (Better Auth) */
  authUrl: string;
  /** control plane: tenants, assinaturas, outbox global */
  platformUrl: string;
  /** catálogo público: colunas publicáveis */
  publicUrl: string;
  poolMax?: number;
}

export interface Databases {
  app: Db;
  platform: Db;
  public: Db;
  authPool: pg.Pool;
  close(): Promise<void>;
}

function kysely(url: string, max: number, name: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max, application_name: `gct_${name}`, idleTimeoutMillis: 30000 });
  pool.on('error', (err) => console.error(`[db:${name}] erro de conexão ociosa`, err.message));
  return { db: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }), pool };
}

export function createDatabases(cfg: DatabaseConfig): Databases {
  const max = cfg.poolMax ?? 10;
  const app = kysely(cfg.appUrl, max, 'app');
  const platform = kysely(cfg.platformUrl, Math.max(2, Math.floor(max / 3)), 'platform');
  const pub = kysely(cfg.publicUrl, Math.max(2, Math.floor(max / 3)), 'public');
  const authPool = new pg.Pool({ connectionString: cfg.authUrl, max: Math.max(2, Math.floor(max / 2)), application_name: 'gct_auth' });
  return {
    app: app.db,
    platform: platform.db,
    public: pub.db,
    authPool,
    async close() {
      await Promise.all([app.db.destroy(), platform.db.destroy(), pub.db.destroy(), authPool.end()]);
    },
  };
}

export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Variável de ambiente ${k} não definida.`);
    return v;
  };
  return {
    appUrl: need('DATABASE_URL'),
    authUrl: need('AUTH_DATABASE_URL'),
    platformUrl: need('PLATFORM_DATABASE_URL'),
    publicUrl: need('PUBLIC_DATABASE_URL'),
    poolMax: env.DB_POOL_MAX ? Number(env.DB_POOL_MAX) : undefined,
  };
}

export interface TenantScope {
  tenantId: string;
  userId?: string | null;
}

export interface TxOptions {
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
  /** tentativas em falha de serialização/deadlock */
  maxAttempts?: number;
}

const RETRYABLE = new Set(['40001', '40P01']);

/** Define o contexto da transação (local; não vaza para outras conexões do pool). */
export async function setTenantContext(trx: Tx, scope: TenantScope): Promise<void> {
  await sql`select set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`.execute(trx);
}

/**
 * Executa `fn` numa transação com o tenant configurado para RLS. Repete com a
 * mesma entrada em falhas transitórias de serialização (idempotência protege efeitos).
 */
export async function withTenant<T>(db: Db, scope: TenantScope, fn: (trx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const attempts = opts.maxAttempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      let builder = db.transaction();
      if (opts.isolation) builder = builder.setIsolationLevel(opts.isolation);
      return await builder.execute(async (trx) => {
        await setTenantContext(trx, scope);
        return fn(trx);
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < attempts) {
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
        continue;
      }
      throw e;
    }
  }
}

/** Transação sem tenant (somente para usuário da sessão: listar próprias empresas). */
export async function withUser<T>(db: Db, userId: string, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** JSON seguro para jsonb: bigint vira string decimal. */
export function jsonb<T>(value: T): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Próximo número sequencial por empresa/tipo (lock de linha, sem lacunas por rollback). */
export async function nextNumber(trx: Tx, tenantId: string, docType: string): Promise<bigint> {
  const row = await sql<{ n: bigint }>`
    insert into document_sequences (tenant_id, doc_type, next_number) values (${tenantId}, ${docType}, 2)
    on conflict (tenant_id, doc_type) do update set next_number = document_sequences.next_number + 1
    returning next_number - 1 as n`.execute(trx);
  return row.rows[0]!.n;
}
