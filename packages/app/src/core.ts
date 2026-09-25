import { createHash } from 'node:crypto';
import { sql, withTenant, jsonb, type Databases, type Tx, type TxOptions } from '@gct/db';
import { AppError, forbidden, type Permission, type Role } from '@gct/shared';

/** Contexto validado no servidor para cada operação empresarial. */
export interface Actor {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  discountLimitBps: number;
  timezone: string;
  tenantStatus: 'active' | 'suspended' | 'archived';
  requestId?: string;
}

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface Mailer {
  readonly enabled: boolean;
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export interface AppDeps {
  dbs: Databases;
  storage: Storage;
  mailer: Mailer;
  now?: () => Date;
}

export function can(actor: Actor, p: Permission): boolean {
  return actor.permissions.has(p);
}

export function requirePermission(actor: Actor, ...perms: Permission[]): void {
  for (const p of perms) if (!actor.permissions.has(p)) throw forbidden();
}

/** Bloqueia novas operações quando a empresa está suspensa (leitura/exportação continuam). */
export function requireWritable(actor: Actor): void {
  if (actor.tenantStatus !== 'active')
    throw new AppError('tenant_suspended', 'Empresa suspensa: novas operações estão bloqueadas. Consulte Plano e cobrança.');
}

export function tx<T>(deps: AppDeps, actor: Actor, fn: (trx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
  return withTenant(deps.dbs.app, { tenantId: actor.tenantId, userId: actor.userId }, fn, opts);
}

export async function audit(
  trx: Tx,
  actor: Pick<Actor, 'tenantId' | 'userId' | 'requestId'>,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  await trx
    .insertInto('audit_events')
    .values({
      tenant_id: actor.tenantId,
      user_id: actor.userId,
      action,
      entity,
      entity_id: entityId,
      data: jsonb(data),
      request_id: actor.requestId ?? null,
    })
    .execute();
}

export async function emit(trx: Tx, tenantId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  await trx.insertInto('outbox_events').values({ tenant_id: tenantId, type, payload: jsonb(payload) }).execute();
}

/** Hash estável do corpo (chaves ordenadas; bigint como string). */
export function stableHash(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(norm(value))).digest('hex');
}

/**
 * Idempotência dentro da mesma transação do efeito. O INSERT da chave bloqueia
 * requisições concorrentes com a mesma chave até o commit/rollback da primeira.
 * Mesma chave + mesmo corpo → resposta original; corpo diferente → 409.
 */
export async function idempotent<T>(
  trx: Tx,
  tenantId: string,
  operation: string,
  key: string | undefined,
  body: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key) throw new AppError('validation_failed', 'Cabeçalho Idempotency-Key obrigatório para esta operação.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    throw new AppError('validation_failed', 'Idempotency-Key deve ser um UUID.');
  const hash = stableHash(body);
  const inserted = await trx
    .insertInto('idempotency_keys')
    .values({ tenant_id: tenantId, operation, key, request_hash: hash })
    .onConflict((oc) => oc.doNothing())
    .returning('key')
    .executeTakeFirst();
  if (!inserted) {
    const existing = await trx
      .selectFrom('idempotency_keys')
      .select(['request_hash', 'response'])
      .where('tenant_id', '=', tenantId)
      .where('operation', '=', operation)
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== hash)
      throw new AppError('idempotency_conflict', 'Esta chave de idempotência já foi usada com outros dados.');
    return { result: existing.response as T, replayed: true };
  }
  const result = await fn();
  await trx
    .updateTable('idempotency_keys')
    .set({ response: jsonb(result), status_code: 200 })
    .where('tenant_id', '=', tenantId)
    .where('operation', '=', operation)
    .where('key', '=', key)
    .execute();
  // Resposta retornada é a serializada (igual à de um replay).
  return { result: JSON.parse(jsonb(result)) as T, replayed: false };
}

export async function lockRow(trx: Tx, table: string, tenantId: string, id: string): Promise<void> {
  await sql`select 1 from ${sql.table(table)} where tenant_id = ${tenantId} and id = ${id} for update`.execute(trx);
}

/** Converte linha do banco com bigint em DTO serializável (bigint → string). */
export function dto<T>(value: T): unknown {
  return JSON.parse(jsonb(value));
}

export function todayLocal(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === '23505' && (!constraint || err.constraint === constraint);
}
