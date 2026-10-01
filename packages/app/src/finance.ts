import { z } from 'zod';
import { sql, type Tx } from '@gct/db';
import { assertAllocationWithinBalance, buildInstallments, titleStatus } from '@gct/domain';
import { addDays, AppError, conflict, invalid, notFound, sumCents } from '@gct/shared';
import { audit, can, emit, idempotent, isUniqueViolation, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { decodeCursor, pageOf, zCentsNonNeg, zCentsPos, zLocalDate, zPageQuery, zText, zUuid } from './validation';

export interface FinCtx {
  tenantId: string;
  userId: string;
  timezone: string;
}

export type SettlementMethod = 'cash' | 'pix' | 'debit' | 'credit' | 'bank_transfer' | 'boleto' | 'other';

// ---------------------------------------------------------------------------
// Períodos fechados

export async function assertPeriodOpen(trx: Tx, date: string): Promise<void> {
  const p = await trx.selectFrom('financial_periods').select('status').where('period', '=', date.slice(0, 7)).executeTakeFirst();
  if (p?.status === 'closed') throw conflict(`O período ${date.slice(0, 7)} está fechado. Reabra-o (com permissão) para lançar nessa data.`);
}

// ---------------------------------------------------------------------------
// Títulos

export interface NewTitle {
  direction: 'receivable' | 'payable';
  partyId: string | null;
  originType: 'sale' | 'purchase' | 'expense' | 'refund' | 'trade' | 'acquisition_cost' | 'manual';
  originId: string | null;
  description: string;
  category?: string | null;
  competenceDate: string;
  dueDate: string;
  amountCents: bigint;
  installmentNumber?: number;
  installmentCount?: number;
}

export async function createTitle(trx: Tx, ctx: FinCtx, t: NewTitle): Promise<string> {
  if (t.amountCents <= 0n) throw invalid('Valor do título deve ser positivo.');
  const row = await trx
    .insertInto('financial_titles')
    .values({
      tenant_id: ctx.tenantId,
      direction: t.direction,
      party_id: t.partyId,
      origin_type: t.originType,
      origin_id: t.originId,
      description: t.description,
      category: t.category ?? null,
      competence_date: t.competenceDate,
      due_date: t.dueDate,
      installment_number: t.installmentNumber ?? 1,
      installment_count: t.installmentCount ?? 1,
      original_cents: t.amountCents,
      balance_cents: t.amountCents,
      created_by: ctx.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Parcela o valor em títulos (entrada/parcelas somam o total exato). */
export async function createInstallmentTitles(
  trx: Tx,
  ctx: FinCtx,
  base: Omit<NewTitle, 'amountCents' | 'dueDate' | 'installmentNumber' | 'installmentCount'>,
  plan: { totalCents: bigint; count: number; firstDueDate: string; interval: 'monthly' | number },
): Promise<string[]> {
  const inst = buildInstallments(plan);
  const ids: string[] = [];
  for (const i of inst) {
    ids.push(
      await createTitle(trx, ctx, {
        ...base,
        description: inst.length > 1 ? `${base.description} (${i.number}/${inst.length})` : base.description,
        amountCents: i.amountCents,
        dueDate: i.dueDate,
        installmentNumber: i.number,
        installmentCount: inst.length,
      }),
    );
  }
  return ids;
}

interface TitleRow {
  id: string;
  direction: string;
  party_id: string | null;
  original_cents: bigint;
  balance_cents: bigint;
  status: string;
}

async function lockTitle(trx: Tx, tenantId: string, titleId: string): Promise<TitleRow> {
  const r = await sql<TitleRow>`
    select id, direction, party_id, original_cents, balance_cents, status from financial_titles
    where tenant_id = ${tenantId} and id = ${titleId} for update`.execute(trx);
  const t = r.rows[0];
  if (!t) throw notFound('Título');
  return t;
}

/** Reduz saldo sob lock: duas baixas simultâneas nunca deixam saldo negativo. */
async function reduceTitle(trx: Tx, tenantId: string, titleId: string, amount: bigint): Promise<TitleRow> {
  const t = await lockTitle(trx, tenantId, titleId);
  if (t.status === 'canceled') throw conflict('Título cancelado não aceita baixa.');
  assertAllocationWithinBalance(t.balance_cents, amount);
  const balance = t.balance_cents - amount;
  await trx
    .updateTable('financial_titles')
    .set({ balance_cents: balance, status: titleStatus(t.original_cents, balance) })
    .where('id', '=', titleId)
    .execute();
  return { ...t, balance_cents: balance };
}

async function restoreTitle(trx: Tx, tenantId: string, titleId: string, amount: bigint): Promise<void> {
  const t = await lockTitle(trx, tenantId, titleId);
  const balance = t.balance_cents + amount;
  if (balance > t.original_cents) throw new AppError('internal', 'Estorno excede o valor original do título.');
  await trx
    .updateTable('financial_titles')
    .set({ balance_cents: balance, status: t.status === 'canceled' ? 'canceled' : titleStatus(t.original_cents, balance) })
    .where('id', '=', titleId)
    .execute();
}

/** Ajuste sem dinheiro (devolução, cancelamento, perdão). Registrado no livro de ajustes. */
export async function adjustTitle(
  trx: Tx,
  ctx: FinCtx,
  titleId: string,
  amount: bigint,
  kind: 'return_reduction' | 'cancellation' | 'write_off',
  origin: { type: string; id: string | null },
  reason: string,
): Promise<void> {
  await reduceTitle(trx, ctx.tenantId, titleId, amount);
  await trx
    .insertInto('title_adjustments')
    .values({ tenant_id: ctx.tenantId, title_id: titleId, kind, amount_cents: amount, origin_type: origin.type, origin_id: origin.id, reason, created_by: ctx.userId })
    .execute();
}

/** Cancela o saldo remanescente de um título (ajuste auditado) e marca como cancelado. */
export async function cancelTitleBalance(trx: Tx, ctx: FinCtx, titleId: string, origin: { type: string; id: string | null }, reason: string): Promise<bigint> {
  const t = await lockTitle(trx, ctx.tenantId, titleId);
  if (t.status === 'canceled') return 0n;
  const remaining = t.balance_cents;
  if (remaining > 0n) await adjustTitle(trx, ctx, titleId, remaining, 'cancellation', origin, reason);
  if (remaining === t.original_cents) {
    await trx.updateTable('financial_titles').set({ status: 'canceled', canceled_at: new Date(), cancel_reason: reason }).where('id', '=', titleId).execute();
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Liquidações (dinheiro real)

export interface SettlementInput {
  direction: 'in' | 'out';
  method: SettlementMethod;
  accountId: string;
  settledOn: string;
  allocations: { titleId: string; amountCents: bigint }[];
  feeCents?: bigint;
  reference?: string | null;
  notes?: string | null;
}

export async function recordSettlement(trx: Tx, ctx: FinCtx, input: SettlementInput): Promise<{ settlementId: string; netCents: bigint }> {
  if (input.allocations.length === 0) throw invalid('Selecione ao menos um título.');
  await assertPeriodOpen(trx, input.settledOn);
  const account = await trx.selectFrom('financial_accounts').select(['id', 'status']).where('id', '=', input.accountId).executeTakeFirst();
  if (!account || account.status !== 'active') throw invalid('Conta financeira inválida.', { accountId: 'inválida' });
  const gross = sumCents(input.allocations.map((a) => a.amountCents));
  const fee = input.feeCents ?? 0n;
  if (fee < 0n || fee > gross) throw invalid('Taxa inválida.', { feeCents: 'inválida' });
  if (input.direction === 'out' && fee > 0n) throw invalid('Taxa só se aplica a recebimentos.');
  const net = gross - fee;
  // Ordem canônica de lock evita deadlock entre baixas concorrentes.
  const sorted = [...input.allocations].sort((a, b) => (a.titleId < b.titleId ? -1 : 1));
  if (new Set(sorted.map((a) => a.titleId)).size !== sorted.length) throw invalid('Título repetido na baixa.');
  const parties = new Set<string | null>();
  for (const a of sorted) {
    const t = await reduceTitle(trx, ctx.tenantId, a.titleId, a.amountCents);
    const expected = input.direction === 'in' ? 'receivable' : 'payable';
    if (t.direction !== expected) throw invalid('Título não corresponde ao sentido da baixa.');
    parties.add(t.party_id);
  }
  const partyId = parties.size === 1 ? [...parties][0]! : null;
  const s = await trx
    .insertInto('settlements')
    .values({
      tenant_id: ctx.tenantId,
      direction: input.direction,
      method: input.method,
      account_id: input.accountId,
      party_id: partyId,
      settled_on: input.settledOn,
      gross_cents: gross,
      fee_cents: fee,
      net_cents: net,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      created_by: ctx.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const a of sorted) {
    await trx.insertInto('settlement_allocations').values({ tenant_id: ctx.tenantId, settlement_id: s.id, title_id: a.titleId, amount_cents: a.amountCents }).execute();
  }
  const cashAmount = input.direction === 'in' ? net : gross;
  if (cashAmount > 0n) {
    await trx
      .insertInto('cash_movements')
      .values({
        tenant_id: ctx.tenantId,
        account_id: input.accountId,
        direction: input.direction,
        amount_cents: cashAmount,
        kind: 'settlement',
        origin_type: 'settlement',
        origin_id: s.id,
        occurred_on: input.settledOn,
        description: input.direction === 'in' ? 'Recebimento' : 'Pagamento',
        created_by: ctx.userId,
      })
      .execute();
  }
  await emit(trx, ctx.tenantId, 'SettlementRecorded', { settlementId: s.id });
  return { settlementId: s.id, netCents: net };
}

/** Estorno de liquidação: nova linha vinculada; original permanece intacta. */
export async function reverseSettlement(trx: Tx, ctx: FinCtx, settlementId: string, reason: string): Promise<string> {
  // Livro append-only: unicidade de estorno garantida por índice único (reversal_of).
  const s = await trx.selectFrom('settlements').selectAll().where('id', '=', settlementId).executeTakeFirst();
  if (!s) throw notFound('Liquidação');
  if (s.reversal_of) throw conflict('Não é possível estornar um estorno.');
  const already = await trx.selectFrom('settlements').select('id').where('reversal_of', '=', s.id).executeTakeFirst();
  if (already) throw conflict('Liquidação já estornada.');
  const today = todayLocal(ctx.timezone);
  await assertPeriodOpen(trx, today);
  const rev = await trx
    .insertInto('settlements')
    .values({
      tenant_id: ctx.tenantId,
      direction: s.direction,
      method: s.method,
      account_id: s.account_id,
      party_id: s.party_id,
      settled_on: today,
      gross_cents: s.gross_cents,
      fee_cents: s.fee_cents,
      net_cents: s.net_cents,
      reversal_of: s.id,
      reversal_reason: reason,
      created_by: ctx.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const allocs = await trx.selectFrom('settlement_allocations').selectAll().where('settlement_id', '=', s.id).orderBy('title_id').execute();
  for (const a of allocs) {
    await restoreTitle(trx, ctx.tenantId, a.title_id, a.amount_cents);
    await trx.insertInto('settlement_allocations').values({ tenant_id: ctx.tenantId, settlement_id: rev.id, title_id: a.title_id, amount_cents: a.amount_cents }).execute();
  }
  const cm = await trx.selectFrom('cash_movements').selectAll().where('origin_type', '=', 'settlement').where('origin_id', '=', s.id).executeTakeFirst();
  if (cm) {
    await trx
      .insertInto('cash_movements')
      .values({
        tenant_id: ctx.tenantId,
        account_id: cm.account_id,
        direction: cm.direction === 'in' ? 'out' : 'in',
        amount_cents: cm.amount_cents,
        kind: 'reversal',
        origin_type: 'settlement_reversal',
        origin_id: rev.id,
        occurred_on: today,
        description: `Estorno: ${reason}`,
        reversal_of: cm.id,
        created_by: ctx.userId,
      })
      .execute();
  }
  return rev.id;
}

/**
 * Estorna todos os pagamentos/recebimentos ainda válidos destes títulos (dinheiro volta para a conta,
 * por lançamento de estorno vinculado). Pagamento que também quitou outro título bloqueia.
 */
export async function reverseTitlePayments(trx: Tx, ctx: FinCtx, titleIds: string[], reason: string): Promise<number> {
  if (!titleIds.length) return 0;
  const rows = await sql<{ settlement_id: string }>`
    select distinct a.settlement_id from settlement_allocations a join settlements s on s.id = a.settlement_id
    where a.title_id in (${sql.join(titleIds)}) and s.reversal_of is null
      and not exists (select 1 from settlements r where r.reversal_of = s.id)
    order by a.settlement_id`.execute(trx);
  for (const r of rows.rows) {
    const other = await trx.selectFrom('settlement_allocations').select('title_id').where('settlement_id', '=', r.settlement_id).where('title_id', 'not in', titleIds).executeTakeFirst();
    if (other) throw conflict('O pagamento também quitou outro lançamento; estorne esse pagamento em A pagar/A receber.');
    await reverseSettlement(trx, ctx, r.settlement_id, reason);
  }
  return rows.rows.length;
}

// ---------------------------------------------------------------------------
// Compensação (troca) e crédito de loja

export async function applyOffset(
  trx: Tx,
  ctx: FinCtx,
  input: { partyId: string; receivableTitleId: string; payableTitleId: string; amountCents: bigint; originType: string; originId: string },
): Promise<string> {
  if (input.amountCents <= 0n) throw invalid('Compensação deve ser positiva.');
  const [first, second] = [input.receivableTitleId, input.payableTitleId].sort();
  const t1 = await reduceTitle(trx, ctx.tenantId, first!, input.amountCents);
  const t2 = await reduceTitle(trx, ctx.tenantId, second!, input.amountCents);
  const dirs = new Set([t1.direction, t2.direction]);
  if (!dirs.has('receivable') || !dirs.has('payable')) throw invalid('Compensação exige títulos em direções opostas.');
  const off = await trx
    .insertInto('offsets')
    .values({ tenant_id: ctx.tenantId, party_id: input.partyId, amount_cents: input.amountCents, origin_type: input.originType, origin_id: input.originId, created_by: ctx.userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('offset_allocations')
    .values([
      { tenant_id: ctx.tenantId, offset_id: off.id, title_id: input.receivableTitleId, amount_cents: input.amountCents },
      { tenant_id: ctx.tenantId, offset_id: off.id, title_id: input.payableTitleId, amount_cents: input.amountCents },
    ])
    .execute();
  return off.id;
}

export async function reverseOffset(trx: Tx, ctx: FinCtx, offsetId: string): Promise<void> {
  const o = await trx.selectFrom('offsets').selectAll().where('id', '=', offsetId).executeTakeFirst();
  if (!o) throw notFound('Compensação');
  const rev = await trx
    .insertInto('offsets')
    .values({ tenant_id: ctx.tenantId, party_id: o.party_id, amount_cents: o.amount_cents, origin_type: 'offset_reversal', origin_id: o.id, reversal_of: o.id, created_by: ctx.userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  const allocs = await trx.selectFrom('offset_allocations').selectAll().where('offset_id', '=', o.id).orderBy('title_id').execute();
  for (const a of allocs) {
    await restoreTitle(trx, ctx.tenantId, a.title_id, a.amount_cents);
    await trx.insertInto('offset_allocations').values({ tenant_id: ctx.tenantId, offset_id: rev.id, title_id: a.title_id, amount_cents: a.amount_cents }).execute();
  }
}

async function lockCredit(trx: Tx, tenantId: string, partyId: string): Promise<bigint> {
  await trx.insertInto('store_credit_balances').values({ tenant_id: tenantId, party_id: partyId }).onConflict((oc) => oc.doNothing()).execute();
  const r = await sql<{ balance_cents: bigint }>`select balance_cents from store_credit_balances where tenant_id = ${tenantId} and party_id = ${partyId} for update`.execute(trx);
  return r.rows[0]!.balance_cents;
}

/** Emite crédito de loja: passivo da empresa, não é receita nem saída de caixa. */
export async function issueStoreCredit(
  trx: Tx,
  ctx: FinCtx,
  input: { partyId: string; amountCents: bigint; originType: string; originId: string | null; reason: string; kind?: 'issue' | 'adjustment' },
): Promise<void> {
  if (input.amountCents <= 0n) throw invalid('Crédito deve ser positivo.');
  const bal = await lockCredit(trx, ctx.tenantId, input.partyId);
  const after = bal + input.amountCents;
  await trx.updateTable('store_credit_balances').set({ balance_cents: after, updated_at: new Date() }).where('party_id', '=', input.partyId).execute();
  await trx
    .insertInto('store_credit_entries')
    .values({
      tenant_id: ctx.tenantId, party_id: input.partyId, kind: input.kind ?? 'issue', amount_cents: input.amountCents, balance_after_cents: after,
      origin_type: input.originType, origin_id: input.originId, reason: input.reason, created_by: ctx.userId,
    })
    .execute();
}

/** Usa crédito para liquidar parte de um título, sem novo caixa. Nunca negativo. */
export async function useStoreCredit(
  trx: Tx,
  ctx: FinCtx,
  input: { partyId: string; titleId: string; amountCents: bigint; originType: string; originId: string | null },
): Promise<void> {
  const bal = await lockCredit(trx, ctx.tenantId, input.partyId);
  if (input.amountCents <= 0n || input.amountCents > bal) throw conflict('Crédito da loja insuficiente.');
  const t = await reduceTitle(trx, ctx.tenantId, input.titleId, input.amountCents);
  if (t.direction !== 'receivable' || t.party_id !== input.partyId) throw invalid('Crédito só liquida títulos a receber do próprio cliente.');
  const after = bal - input.amountCents;
  await trx.updateTable('store_credit_balances').set({ balance_cents: after, updated_at: new Date() }).where('party_id', '=', input.partyId).execute();
  await trx
    .insertInto('store_credit_entries')
    .values({
      tenant_id: ctx.tenantId, party_id: input.partyId, kind: 'use', amount_cents: -input.amountCents, balance_after_cents: after,
      origin_type: input.originType, origin_id: input.originId, title_id: input.titleId, created_by: ctx.userId,
    })
    .execute();
}

/** Estorna crédito emitido (ex.: reversão de troca). Falha se já foi usado. */
export async function revokeStoreCredit(trx: Tx, ctx: FinCtx, input: { partyId: string; amountCents: bigint; originType: string; originId: string; reason: string }): Promise<void> {
  const bal = await lockCredit(trx, ctx.tenantId, input.partyId);
  if (bal < input.amountCents) throw conflict('Crédito da loja já foi utilizado; o estorno exige resolução assistida.');
  const after = bal - input.amountCents;
  await trx.updateTable('store_credit_balances').set({ balance_cents: after, updated_at: new Date() }).where('party_id', '=', input.partyId).execute();
  await trx
    .insertInto('store_credit_entries')
    .values({
      tenant_id: ctx.tenantId, party_id: input.partyId, kind: 'reversal', amount_cents: -input.amountCents, balance_after_cents: after,
      origin_type: input.originType, origin_id: input.originId, reason: input.reason, created_by: ctx.userId,
    })
    .execute();
}

// ---------------------------------------------------------------------------
// Casos de uso (API)

export const zTitleList = zPageQuery.extend({
  direction: z.enum(['receivable', 'payable']),
  status: z.enum(['open', 'overdue', 'due_week', 'settled', 'canceled', 'all']).default('open'),
  partyId: zUuid.optional(),
  q: z.string().max(100).optional(),
  dueFrom: zLocalDate.optional(),
  dueTo: zLocalDate.optional(),
});

export async function listTitles(deps: AppDeps, actor: Actor, q: z.infer<typeof zTitleList>) {
  requirePermission(actor, 'finance.view');
  const offset = decodeCursor(q.cursor);
  const today = todayLocal(actor.timezone);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('financial_titles as t')
      .leftJoin('parties as p', 'p.id', 't.party_id')
      .select([
        't.id', 't.direction', 't.description', 't.origin_type', 't.origin_id', 't.competence_date', 't.due_date', 't.installment_number',
        't.installment_count', 't.original_cents', 't.balance_cents', 't.status', 't.party_id', 'p.name as party_name', 't.created_at',
        sql<boolean>`t.balance_cents > 0 and t.status <> 'canceled' and t.due_date < ${today}::date`.as('overdue'),
        sql<number>`count(*) over ()::int`.as('total'),
      ])
      .where('t.direction', '=', q.direction);
    if (q.status === 'open') query = query.where('t.status', 'in', ['open', 'partially_settled']);
    if (q.status === 'overdue') query = query.where('t.status', 'in', ['open', 'partially_settled']).where('t.due_date', '<', today);
    if (q.status === 'due_week') query = query.where('t.status', 'in', ['open', 'partially_settled']).where('t.due_date', '>=', today).where('t.due_date', '<=', addDays(today, 7));
    if (q.status === 'settled') query = query.where('t.status', '=', 'settled');
    if (q.status === 'canceled') query = query.where('t.status', '=', 'canceled');
    if (q.partyId) query = query.where('t.party_id', '=', q.partyId);
    if (q.dueFrom) query = query.where('t.due_date', '>=', q.dueFrom);
    if (q.dueTo) query = query.where('t.due_date', '<=', q.dueTo);
    if (q.q) query = query.where((eb) => eb.or([eb('t.description', 'ilike', `%${q.q!.replace(/[%_]/g, '')}%`), eb('p.name', 'ilike', `%${q.q!.replace(/[%_]/g, '')}%`)]));
    const rows = await query.orderBy('t.due_date').orderBy('t.id').limit(q.limit + 1).offset(offset).execute();
    const total = rows[0]?.total ?? 0;
    const summary = await titleSummary(trx, q.direction, today);
    return { ...pageOf(rows.map(({ total: _t, ...r }) => r), offset, q.limit, total), summary };
  });
}

/** Cartões: pendente, liquidado hoje, vence na semana, atrasado (fuso da empresa). */
async function titleSummary(trx: Tx, direction: 'receivable' | 'payable', today: string) {
  const r = await sql<{ pending: bigint; overdue: bigint; overdue_n: number; week: bigint; week_n: number; today_amt: bigint; today_n: number }>`
    select
      coalesce(sum(balance_cents) filter (where status in ('open','partially_settled')), 0) as pending,
      coalesce(sum(balance_cents) filter (where status in ('open','partially_settled') and due_date < ${today}::date), 0) as overdue,
      count(*) filter (where status in ('open','partially_settled') and due_date < ${today}::date)::int as overdue_n,
      coalesce(sum(balance_cents) filter (where status in ('open','partially_settled') and due_date between ${today}::date and ${today}::date + 7), 0) as week,
      count(*) filter (where status in ('open','partially_settled') and due_date between ${today}::date and ${today}::date + 7)::int as week_n,
      (select coalesce(sum(case when s.reversal_of is null then sa.amount_cents else -sa.amount_cents end), 0)
         from settlement_allocations sa join settlements s on s.id = sa.settlement_id join financial_titles t2 on t2.id = sa.title_id
        where s.settled_on = ${today}::date and t2.direction = ${direction}) as today_amt,
      (select count(*) from settlements s where s.settled_on = ${today}::date and s.reversal_of is null and s.direction = ${direction === 'receivable' ? 'in' : 'out'})::int as today_n
    from financial_titles where direction = ${direction}`.execute(trx);
  const row = r.rows[0]!;
  return {
    pendingCents: row.pending,
    settledTodayCents: row.today_amt,
    settledTodayCount: row.today_n,
    dueWeekCents: row.week,
    dueWeekCount: row.week_n,
    overdueCents: row.overdue,
    overdueCount: row.overdue_n,
  };
}

export async function getTitle(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'finance.view');
  return tx(deps, actor, async (trx) => {
    const title = await trx
      .selectFrom('financial_titles as t')
      .leftJoin('parties as p', 'p.id', 't.party_id')
      .selectAll('t')
      .select('p.name as party_name')
      .where('t.id', '=', id)
      .executeTakeFirst();
    if (!title) throw notFound('Título');
    const settlements = await trx
      .selectFrom('settlement_allocations as a')
      .innerJoin('settlements as s', 's.id', 'a.settlement_id')
      .innerJoin('financial_accounts as acc', 'acc.id', 's.account_id')
      .select(['s.id', 's.settled_on', 's.method', 'acc.name as account_name', 'a.amount_cents', 's.fee_cents', 's.net_cents', 's.reversal_of', 's.reference', 's.created_at'])
      .where('a.title_id', '=', id)
      .orderBy('s.created_at')
      .execute();
    const offsets = await trx
      .selectFrom('offset_allocations as a')
      .innerJoin('offsets as o', 'o.id', 'a.offset_id')
      .select(['o.id', 'a.amount_cents', 'o.origin_type', 'o.origin_id', 'o.reversal_of', 'o.created_at'])
      .where('a.title_id', '=', id)
      .execute();
    const adjustments = await trx.selectFrom('title_adjustments').selectAll().where('title_id', '=', id).orderBy('created_at').execute();
    const credits = await trx.selectFrom('store_credit_entries').select(['id', 'amount_cents', 'created_at']).where('title_id', '=', id).execute();
    return { title, settlements, offsets, adjustments, credits };
  });
}

export const zSettle = z.object({
  direction: z.enum(['in', 'out']),
  method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'boleto', 'other']),
  accountId: zUuid,
  settledOn: zLocalDate.optional(),
  feeCents: zCentsNonNeg.optional(),
  reference: zText(120).optional().nullable(),
  notes: zText(500).optional().nullable(),
  allocations: z.array(z.object({ titleId: zUuid, amountCents: zCentsPos })).min(1).max(50),
});

/** Baixa manual (parcial ou total, vários títulos). Idempotente. */
export async function settleTitles(deps: AppDeps, actor: Actor, input: z.infer<typeof zSettle>, idempotencyKey?: string) {
  requirePermission(actor, input.direction === 'in' ? 'finance.settle_receivable' : 'finance.settle_payable');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'settlement', idempotencyKey, input, async () => {
      const r = await recordSettlement(trx, actor, { ...input, settledOn: input.settledOn ?? todayLocal(actor.timezone) });
      await audit(trx, actor, 'finance.settlement_recorded', 'settlement', r.settlementId, { gross: sumCents(input.allocations.map((a) => a.amountCents)), fee: input.feeCents ?? 0n });
      return { settlementId: r.settlementId, netCents: r.netCents };
    });
    return result;
  });
}

export async function reverseSettlementAction(deps: AppDeps, actor: Actor, settlementId: string, reason: string) {
  requirePermission(actor, 'reversals.execute');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo do estorno.');
  return tx(deps, actor, async (trx) => {
    const id = await reverseSettlement(trx, actor, settlementId, reason);
    await audit(trx, actor, 'finance.settlement_reversed', 'settlement', settlementId, { reversalId: id, reason });
    return { reversalId: id };
  });
}

// Contas, saldos e movimentos --------------------------------------------------------

export async function listAccounts(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'finance.view');
  return tx(deps, actor, async (trx) => {
    const r = await sql<{ id: string; name: string; kind: string; status: string; balance_cents: bigint; open_session: string | null }>`
      select a.id, a.name, a.kind, a.status,
             coalesce(sum(case when m.direction = 'in' then m.amount_cents else -m.amount_cents end), 0)::bigint as balance_cents,
             (select cs.id from cash_sessions cs where cs.account_id = a.id and cs.closed_at is null) as open_session
      from financial_accounts a left join cash_movements m on m.account_id = a.id
      group by a.id order by a.kind, a.name`.execute(trx);
    return r.rows;
  });
}

export const zAccount = z.object({ name: zText(80).min(2), kind: z.enum(['cash', 'bank', 'card_transit', 'other']) });

export async function createAccount(deps: AppDeps, actor: Actor, input: z.infer<typeof zAccount>) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const r = await trx.insertInto('financial_accounts').values({ tenant_id: actor.tenantId, name: input.name, kind: input.kind }).returning('id').executeTakeFirstOrThrow();
    await audit(trx, actor, 'finance.account_created', 'financial_account', r.id, input);
    return r;
  });
}

const IN_LABEL: Record<string, string> = { sale: 'Vendas recebidas', trade: 'Trocas: diferença recebida', manual: 'Recebimentos avulsos', mixed: 'Recebimentos' };
const OUT_LABEL: Record<string, string> = {
  purchase: 'Compras de mercadoria pagas', expense: 'Despesas pagas', refund: 'Reembolsos a clientes', trade: 'Trocas: valores pagos ao cliente',
  acquisition_cost: 'Custos de aquisição pagos (frete, reparo)', manual: 'Pagamentos avulsos', mixed: 'Pagamentos',
};
const KIND_LABEL: Record<string, string> = {
  opening: 'Saldo inicial', capital_in: 'Aportes do dono', withdrawal: 'Retiradas do dono', loan_in: 'Empréstimos recebidos', loan_out: 'Empréstimos pagos', reversal: 'Estornos de lançamentos',
};

/**
 * Explica o saldo: soma de tudo que entrou menos tudo que saiu, por tipo (todas as contas,
 * inclusive arquivadas; transferências internas se anulam e ficam fora). Mostra também o que
 * ainda não passou pela conta: contas a pagar e a receber em aberto e (com permissão) estoque a custo.
 */
export async function balanceBreakdown(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'finance.view');
  return tx(deps, actor, async (trx) => {
    const r = await sql<{ direction: 'in' | 'out'; kind: string; origin_type: string; title_origin: string | null; settlement_direction: 'in' | 'out' | null; cents: bigint; n: number }>`
      select m.direction, m.kind, m.origin_type,
             case when m.kind = 'settlement' or m.origin_type = 'settlement_reversal' then (
               select case when count(distinct t.origin_type) = 1 then min(t.origin_type) else 'mixed' end
               from settlement_allocations a join financial_titles t on t.id = a.title_id where a.settlement_id = m.origin_id) end as title_origin,
             (select s.direction from settlements s where m.origin_type in ('settlement', 'settlement_reversal') and s.id = m.origin_id) as settlement_direction,
             sum(m.amount_cents)::bigint as cents, count(*)::int as n
      from cash_movements m
      where m.kind not in ('transfer_in', 'transfer_out')
      group by 1, 2, 3, 4, 5`.execute(trx);
    const lines = new Map<string, { label: string; cents: bigint; count: number }>();
    for (const row of r.rows) {
      let label: string;
      // Pagamento estornado entra na mesma linha do pagamento original (subtrai dela).
      if (row.kind === 'settlement' || row.origin_type === 'settlement_reversal') {
        const dir = row.settlement_direction ?? row.direction;
        label = (dir === 'in' ? IN_LABEL : OUT_LABEL)[row.title_origin ?? 'mixed'] ?? (dir === 'in' ? 'Recebimentos' : 'Pagamentos');
      }
      else if (row.kind === 'cash_adjustment' || (row.kind === 'reversal' && row.origin_type === 'balance_adjustment')) label = row.origin_type === 'balance_adjustment' ? 'Ajustes de saldo (conferência)' : row.origin_type === 'cash_session' ? 'Diferenças no fechamento de caixa' : 'Ajustes de caixa';
      else label = KIND_LABEL[row.kind] ?? row.kind;
      const signed = row.direction === 'in' ? BigInt(row.cents) : -BigInt(row.cents);
      const cur = lines.get(label) ?? { label, cents: 0n, count: 0 };
      cur.cents += signed;
      cur.count += row.n;
      lines.set(label, cur);
    }
    const items = [...lines.values()].filter((l) => l.cents !== 0n).sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0));
    const balance = items.reduce((a, l) => a + l.cents, 0n);
    const open = await sql<{ direction: string; cents: bigint }>`
      select direction, coalesce(sum(balance_cents), 0)::bigint as cents from financial_titles where status in ('open', 'partially_settled') group by direction`.execute(trx);
    const payable = BigInt(open.rows.find((o) => o.direction === 'payable')?.cents ?? 0);
    const receivable = BigInt(open.rows.find((o) => o.direction === 'receivable')?.cents ?? 0);
    let stockCostCents: bigint | undefined;
    if (can(actor, 'costs.view')) {
      const st = await sql<{ c: bigint }>`select coalesce(sum(cost_remaining_cents), 0)::bigint as c from inventory_lots where status = 'available'`.execute(trx);
      stockCostCents = BigInt(st.rows[0]!.c);
    }
    return { items, balanceCents: balance, openPayableCents: payable, openReceivableCents: receivable, ...(stockCostCents !== undefined ? { stockCostCents } : {}) };
  });
}

const REVERSIBLE_KINDS = ['opening', 'capital_in', 'withdrawal', 'loan_in', 'loan_out', 'cash_adjustment'];

/** Estorna lançamento manual (aporte, retirada, empréstimo, saldo inicial, ajuste): lançamento oposto vinculado. */
export async function reverseCashMovement(deps: AppDeps, actor: Actor, movementId: string, reason: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo do estorno.');
  try {
    return await tx(deps, actor, async (trx) => {
    // Livro só aceita inclusão (sem UPDATE): concorrência garantida pelo índice único de reversal_of.
    const m = await trx.selectFrom('cash_movements').selectAll().where('id', '=', movementId).executeTakeFirst();
    if (!m) throw notFound('Lançamento');
    if (!['manual', 'balance_adjustment'].includes(m.origin_type) || !REVERSIBLE_KINDS.includes(m.kind))
      throw conflict('Este movimento vem de uma venda, compra ou despesa: estorne pela tela de origem.');
    const done = await trx.selectFrom('cash_movements').select('id').where('reversal_of', '=', m.id).executeTakeFirst();
    if (done) throw conflict('Lançamento já estornado.');
    const date = todayLocal(actor.timezone);
    await assertPeriodOpen(trx, date);
    const r = await trx
      .insertInto('cash_movements')
      .values({
        tenant_id: actor.tenantId, account_id: m.account_id, direction: m.direction === 'in' ? 'out' : 'in', amount_cents: m.amount_cents, kind: 'reversal',
        // Estorno de ajuste de conferência continua fora do caixa do período, como o original.
        origin_type: m.origin_type === 'balance_adjustment' ? 'balance_adjustment' : 'manual_reversal', origin_id: m.id,
        occurred_on: date, description: `Estorno: ${reason}`, reversal_of: m.id, created_by: actor.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(trx, actor, 'finance.cash_movement_reversed', 'cash_movement', m.id, { reason, reversalId: r.id });
    return { id: r.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Lançamento já estornado.');
    throw e;
  }
}

export const zUnifyAccounts = z.object({ targetId: zUuid, name: zText(80).min(2).optional() });

/**
 * Deixa uma conta só: o saldo de cada outra conta ativa vai para a conta escolhida por
 * transferência interna (não é receita nem despesa), as formas de pagamento passam a usar
 * a conta escolhida e as demais são arquivadas. Nada é apagado: o histórico continua.
 */
export async function unifyAccounts(deps: AppDeps, actor: Actor, input: z.infer<typeof zUnifyAccounts>) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const accounts = await sql<{ id: string; name: string; status: string }>`select id, name, status from financial_accounts order by id for update`.execute(trx);
    const target = accounts.rows.find((a) => a.id === input.targetId);
    if (!target || target.status !== 'active') throw notFound('Conta');
    const others = accounts.rows.filter((a) => a.status === 'active' && a.id !== target.id);
    const open = await trx.selectFrom('cash_sessions').select('account_id').where('closed_at', 'is', null).execute();
    if (open.length) throw conflict('Feche o caixa aberto antes de unificar as contas.');
    const date = todayLocal(actor.timezone);
    if (others.length) await assertPeriodOpen(trx, date);
    let moved = 0n;
    for (const o of others) {
      const b = await sql<{ bal: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::bigint as bal from cash_movements where account_id = ${o.id}`.execute(trx);
      const bal = BigInt(b.rows[0]!.bal);
      if (bal !== 0n) {
        // Saldo positivo vem para a conta escolhida; negativo é coberto por ela. Em ambos a outra zera.
        const [from, to, amount] = bal > 0n ? [o.id, target.id, bal] : [target.id, o.id, -bal];
        const t = await trx
          .insertInto('account_transfers')
          .values({ tenant_id: actor.tenantId, from_account_id: from, to_account_id: to, amount_cents: amount, occurred_on: date, description: `Unificação de contas: ${o.name} → ${target.name}`, created_by: actor.userId })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('cash_movements')
          .values([
            { tenant_id: actor.tenantId, account_id: from, direction: 'out', amount_cents: amount, kind: 'transfer_out', origin_type: 'transfer', origin_id: t.id, occurred_on: date, description: 'Unificação de contas', created_by: actor.userId },
            { tenant_id: actor.tenantId, account_id: to, direction: 'in', amount_cents: amount, kind: 'transfer_in', origin_type: 'transfer', origin_id: t.id, occurred_on: date, description: 'Unificação de contas', created_by: actor.userId },
          ])
          .execute();
        moved += bal;
      }
      await trx.updateTable('payment_methods').set({ account_id: target.id }).where('account_id', '=', o.id).execute();
      await trx.updateTable('financial_accounts').set({ status: 'archived' }).where('id', '=', o.id).execute();
    }
    // Formas de pagamento que movimentam dinheiro e estavam sem conta também passam a usar a conta única.
    await trx.updateTable('payment_methods').set({ account_id: target.id }).where('account_id', 'is', null).where('kind', 'in', ['cash', 'pix', 'debit', 'credit', 'bank_transfer']).execute();
    if (input.name && input.name !== target.name) {
      const clash = accounts.rows.find((a) => a.id !== target.id && a.name.toLowerCase() === input.name!.toLowerCase());
      if (clash) throw conflict('Já existe uma conta com esse nome.');
      await trx.updateTable('financial_accounts').set({ name: input.name }).where('id', '=', target.id).execute();
    }
    await audit(trx, actor, 'finance.accounts_unified', 'financial_account', target.id, { archived: others.map((o) => o.id), movedCents: moved });
    return { accountId: target.id, archived: others.length };
  });
}

export const zAdjustBalance = z.object({
  targetCents: zCentsNonNeg,
  reason: zText(300).min(3, 'Informe o motivo (ex.: conferência com o extrato)'),
  occurredOn: zLocalDate.optional(),
});

/**
 * Ajusta o saldo da conta ao valor real conferido (extrato ou gaveta): lança só a diferença
 * como ajuste de saldo, fora da receita e das despesas. Histórico anterior intacto.
 */
export async function adjustAccountBalance(deps: AppDeps, actor: Actor, accountId: string, input: z.infer<typeof zAdjustBalance>, idempotencyKey?: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'balance_adjustment', idempotencyKey, { accountId, ...input }, async () => {
      const acc = await sql<{ id: string; status: string }>`select id, status from financial_accounts where id = ${accountId} for update`.execute(trx);
      if (!acc.rows[0] || acc.rows[0].status !== 'active') throw notFound('Conta');
      const date = input.occurredOn ?? todayLocal(actor.timezone);
      await assertPeriodOpen(trx, date);
      const b = await sql<{ bal: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::bigint as bal from cash_movements where account_id = ${accountId}`.execute(trx);
      const current = BigInt(b.rows[0]!.bal);
      const diff = input.targetCents - current;
      if (diff === 0n) throw conflict('O saldo já está igual ao valor informado.');
      const r = await trx
        .insertInto('cash_movements')
        .values({
          tenant_id: actor.tenantId, account_id: accountId, direction: diff > 0n ? 'in' : 'out', amount_cents: diff > 0n ? diff : -diff, kind: 'cash_adjustment',
          origin_type: 'balance_adjustment', origin_id: null, occurred_on: date, description: `Ajuste de saldo: ${input.reason}`, created_by: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'finance.balance_adjusted', 'financial_account', accountId, { from: current, to: input.targetCents, diff, reason: input.reason });
      return { id: r.id, previousCents: current.toString(), diffCents: diff.toString() };
    });
    return result;
  });
}

export const zCashMovement = z.object({
  accountId: zUuid,
  kind: z.enum(['opening', 'capital_in', 'withdrawal', 'loan_in', 'loan_out', 'cash_adjustment']),
  direction: z.enum(['in', 'out']).optional(),
  amountCents: zCentsPos,
  occurredOn: zLocalDate.optional(),
  /** Opcional: vazio usa o nome do tipo (ex.: "Aporte"). */
  description: zText(300).optional().nullable(),
});

const MOVEMENT_LABEL: Record<string, string> = { opening: 'Saldo inicial', capital_in: 'Aporte', withdrawal: 'Retirada', loan_in: 'Empréstimo recebido', loan_out: 'Pagamento de empréstimo', cash_adjustment: 'Ajuste de caixa' };

/**
 * Aportes, retiradas, empréstimos, saldo inicial e ajuste de caixa: tipos próprios,
 * fora da receita de vendas e das despesas operacionais.
 */
export async function recordCashMovement(deps: AppDeps, actor: Actor, input: z.infer<typeof zCashMovement>, idempotencyKey?: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  const dirByKind: Record<string, 'in' | 'out' | undefined> = { opening: 'in', capital_in: 'in', withdrawal: 'out', loan_in: 'in', loan_out: 'out', cash_adjustment: input.direction };
  const direction = dirByKind[input.kind];
  if (!direction) throw invalid('Informe se o ajuste é entrada ou saída.', { direction: 'obrigatório' });
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'cash_movement', idempotencyKey, input, async () => {
      const date = input.occurredOn ?? todayLocal(actor.timezone);
      await assertPeriodOpen(trx, date);
      if (input.kind === 'opening') {
        const has = await trx.selectFrom('cash_movements').select('id').where('account_id', '=', input.accountId).where('kind', '=', 'opening').executeTakeFirst();
        if (has) throw conflict('Saldo inicial já registrado para esta conta. Use ajuste de caixa.');
      }
      if (direction === 'out') await assertAccountFunds(trx, input.accountId, input.amountCents);
      const r = await trx
        .insertInto('cash_movements')
        .values({
          tenant_id: actor.tenantId, account_id: input.accountId, direction, amount_cents: input.amountCents, kind: input.kind,
          origin_type: 'manual', origin_id: null, occurred_on: date, description: input.description?.trim() || MOVEMENT_LABEL[input.kind]!, created_by: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'finance.cash_movement', 'cash_movement', r.id, { kind: input.kind, amount: input.amountCents });
      return { id: r.id };
    });
    return result;
  });
}

async function assertAccountFunds(trx: Tx, accountId: string, amount: bigint) {
  await sql`select 1 from financial_accounts where id = ${accountId} for update`.execute(trx);
  const b = await sql<{ bal: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::bigint as bal from cash_movements where account_id = ${accountId}`.execute(trx);
  const acc = await trx.selectFrom('financial_accounts').select('kind').where('id', '=', accountId).executeTakeFirst();
  if (acc?.kind === 'cash' && b.rows[0]!.bal < amount) throw conflict('Saldo do caixa insuficiente para esta saída.');
}

export const zTransfer = z.object({ fromAccountId: zUuid, toAccountId: zUuid, amountCents: zCentsPos, occurredOn: zLocalDate.optional(), description: zText(300).optional() });

/** Transferência interna: saída e entrada vinculadas; não é receita nem despesa. */
export async function transferBetweenAccounts(deps: AppDeps, actor: Actor, input: z.infer<typeof zTransfer>, idempotencyKey?: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  if (input.fromAccountId === input.toAccountId) throw invalid('Escolha contas diferentes.');
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'transfer', idempotencyKey, input, async () => {
      const date = input.occurredOn ?? todayLocal(actor.timezone);
      await assertPeriodOpen(trx, date);
      await assertAccountFunds(trx, input.fromAccountId, input.amountCents);
      const t = await trx
        .insertInto('account_transfers')
        .values({ tenant_id: actor.tenantId, from_account_id: input.fromAccountId, to_account_id: input.toAccountId, amount_cents: input.amountCents, occurred_on: date, description: input.description ?? null, created_by: actor.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('cash_movements')
        .values([
          { tenant_id: actor.tenantId, account_id: input.fromAccountId, direction: 'out', amount_cents: input.amountCents, kind: 'transfer_out', origin_type: 'transfer', origin_id: t.id, occurred_on: date, description: 'Transferência entre contas', created_by: actor.userId },
          { tenant_id: actor.tenantId, account_id: input.toAccountId, direction: 'in', amount_cents: input.amountCents, kind: 'transfer_in', origin_type: 'transfer', origin_id: t.id, occurred_on: date, description: 'Transferência entre contas', created_by: actor.userId },
        ])
        .execute();
      await audit(trx, actor, 'finance.transfer', 'account_transfer', t.id, { amount: input.amountCents });
      return { id: t.id };
    });
    return result;
  });
}

export const zStatement = zPageQuery.extend({ accountId: zUuid.optional(), from: zLocalDate.optional(), to: zLocalDate.optional() });

export async function listCashMovements(deps: AppDeps, actor: Actor, q: z.infer<typeof zStatement>) {
  requirePermission(actor, 'finance.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('cash_movements as m')
      .innerJoin('financial_accounts as a', 'a.id', 'm.account_id')
      .select(['m.id', 'm.occurred_on', 'm.direction', 'm.amount_cents', 'm.kind', 'm.origin_type', 'm.origin_id', 'm.description', 'a.name as account_name', 'm.created_at', 'm.reversal_of'])
      .select(sql<boolean>`exists (select 1 from cash_movements r where r.reversal_of = m.id)`.as('reversed'));
    if (q.accountId) query = query.where('m.account_id', '=', q.accountId);
    if (q.from) query = query.where('m.occurred_on', '>=', q.from);
    if (q.to) query = query.where('m.occurred_on', '<=', q.to);
    const rows = await query.orderBy('m.occurred_on', 'desc').orderBy('m.created_at', 'desc').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

// Despesas ---------------------------------------------------------------------------------

export const zExpense = z.object({
  description: zText(200).min(2, 'Descreva a despesa'),
  categoryId: zUuid.optional().nullable(),
  partyId: zUuid.optional().nullable(),
  competenceDate: zLocalDate,
  amountCents: zCentsPos,
  dueDate: zLocalDate.optional(),
  payNow: z
    .object({ accountId: zUuid, method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'boleto', 'other']), settledOn: zLocalDate.optional() })
    .optional()
    .nullable(),
  notes: zText(1000).optional().nullable(),
});

/** Despesa operacional por competência; cria conta a pagar e, se pago, a liquidação. */
export async function createExpense(deps: AppDeps, actor: Actor, input: z.infer<typeof zExpense>, idempotencyKey?: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'expense', idempotencyKey, input, async () => {
      await assertPeriodOpen(trx, input.competenceDate);
      const cat = input.categoryId
        ? await trx.selectFrom('expense_categories').select('name').where('id', '=', input.categoryId).executeTakeFirst()
        : undefined;
      if (input.categoryId && !cat) throw invalid('Categoria inválida.');
      const exp = await trx
        .insertInto('expenses')
        .values({
          tenant_id: actor.tenantId, kind: 'operating', description: input.description, category_id: input.categoryId ?? null,
          party_id: input.partyId ?? null, competence_date: input.competenceDate, amount_cents: input.amountCents, notes: input.notes ?? null, created_by: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const titleId = await createTitle(trx, actor, {
        direction: 'payable', partyId: input.partyId ?? null, originType: 'expense', originId: exp.id, description: input.description,
        category: cat?.name ?? null, competenceDate: input.competenceDate, dueDate: input.dueDate ?? input.competenceDate, amountCents: input.amountCents,
      });
      await trx.updateTable('expenses').set({ title_id: titleId }).where('id', '=', exp.id).execute();
      let settlementId: string | null = null;
      if (input.payNow) {
        const s = await recordSettlement(trx, actor, {
          direction: 'out', method: input.payNow.method, accountId: input.payNow.accountId,
          settledOn: input.payNow.settledOn ?? todayLocal(actor.timezone), allocations: [{ titleId, amountCents: input.amountCents }],
        });
        settlementId = s.settlementId;
      }
      await audit(trx, actor, 'finance.expense_created', 'expense', exp.id, { amount: input.amountCents });
      return { id: exp.id, titleId, settlementId };
    });
    return result;
  });
}

/** Cancela despesa não paga; paga exige estorno da liquidação antes. */
export async function cancelExpense(deps: AppDeps, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const e = await trx.selectFrom('expenses').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!e || e.status !== 'active') throw notFound('Despesa');
    if (e.kind !== 'operating') throw conflict('Perdas de estoque são corrigidas por ajuste de estoque.');
    await assertPeriodOpen(trx, e.competence_date);
    if (e.title_id) {
      const t = await trx.selectFrom('financial_titles').select(['balance_cents', 'original_cents']).where('id', '=', e.title_id).executeTakeFirstOrThrow();
      // Despesa paga: o pagamento é estornado (dinheiro volta para a conta) e a despesa sai do resultado.
      if (t.balance_cents !== t.original_cents) await reverseTitlePayments(trx, actor, [e.title_id], `Despesa excluída: ${reason}`);
      const after = await trx.selectFrom('financial_titles').select(['balance_cents', 'original_cents']).where('id', '=', e.title_id).executeTakeFirstOrThrow();
      if (after.balance_cents !== after.original_cents) throw conflict('Despesa com pagamento que não pode ser estornado automaticamente; estorne em A pagar.');
      await cancelTitleBalance(trx, actor, e.title_id, { type: 'expense', id }, reason);
    }
    await trx.updateTable('expenses').set({ status: 'canceled', canceled_at: new Date(), cancel_reason: reason }).where('id', '=', id).execute();
    await audit(trx, actor, 'finance.expense_canceled', 'expense', id, { reason });
  });
}

export const zExpenseList = zPageQuery.extend({
  from: zLocalDate.optional(),
  to: zLocalDate.optional(),
  categoryId: zUuid.optional(),
  q: z.string().max(100).optional(),
});

export async function listExpenses(deps: AppDeps, actor: Actor, q: z.infer<typeof zExpenseList>) {
  requirePermission(actor, 'finance.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('expenses as e')
      .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
      .leftJoin('financial_titles as t', 't.id', 'e.title_id')
      .select(['e.id', 'e.kind', 'e.description', 'e.competence_date', 'e.amount_cents', 'e.status', 'c.name as category_name', 'e.category_id', 't.balance_cents', 't.status as title_status', 'e.notes', 'e.created_at'])
      .where('e.status', '=', 'active');
    if (q.from) query = query.where('e.competence_date', '>=', q.from);
    if (q.to) query = query.where('e.competence_date', '<=', q.to);
    // Resumo usa só período; lista aplica também categoria e busca.
    const summaryRows = await query.execute();
    if (q.categoryId) query = query.where('e.category_id', '=', q.categoryId);
    if (q.q) query = query.where('e.description', 'ilike', `%${q.q.replace(/[%_]/g, '')}%`);
    const rows = await query.orderBy('e.competence_date', 'desc').orderBy('e.id').limit(q.limit + 1).offset(offset).execute();
    const total = sumCents(summaryRows.map((r) => r.amount_cents));
    const byCat = new Map<string, bigint>();
    for (const r of summaryRows) byCat.set(r.category_name ?? (r.kind === 'inventory_loss' ? 'Perdas de estoque' : 'Sem categoria'), (byCat.get(r.category_name ?? (r.kind === 'inventory_loss' ? 'Perdas de estoque' : 'Sem categoria')) ?? 0n) + r.amount_cents);
    const top = [...byCat.entries()].sort((a, b) => (a[1] > b[1] ? -1 : 1))[0];
    return {
      ...pageOf(rows, offset, q.limit),
      summary: {
        totalCents: total,
        count: summaryRows.length,
        averageCents: summaryRows.length ? total / BigInt(summaryRows.length) : null,
        topCategory: top ? { name: top[0], amountCents: top[1] } : null,
      },
    };
  });
}

export async function listExpenseCategories(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'finance.view');
  return tx(deps, actor, (trx) => trx.selectFrom('expense_categories').select(['id', 'name']).where('archived_at', 'is', null).orderBy('name').execute());
}

export async function createExpenseCategory(deps: AppDeps, actor: Actor, name: string) {
  requirePermission(actor, 'finance.manage');
  return tx(deps, actor, async (trx) => {
    try {
      return await trx.insertInto('expense_categories').values({ tenant_id: actor.tenantId, name: name.trim() }).returning(['id', 'name']).executeTakeFirstOrThrow();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Categoria já existe.');
      throw e;
    }
  });
}

// Caixa físico -------------------------------------------------------------------------------

export async function openCashSession(deps: AppDeps, actor: Actor, accountId: string, countedCents: bigint) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const acc = await trx.selectFrom('financial_accounts').select('kind').where('id', '=', accountId).executeTakeFirst();
    if (!acc || acc.kind !== 'cash') throw invalid('Sessão de caixa só para contas do tipo caixa.');
    try {
      const r = await trx.insertInto('cash_sessions').values({ tenant_id: actor.tenantId, account_id: accountId, opened_by: actor.userId, opening_counted_cents: countedCents }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, actor, 'finance.cash_opened', 'cash_session', r.id, { counted: countedCents });
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Já existe caixa aberto nesta conta.');
      throw e;
    }
  });
}

/** Fechamento: diferença entre contado e esperado exige justificativa. */
export async function closeCashSession(deps: AppDeps, actor: Actor, sessionId: string, countedCents: bigint, justification?: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const s = await trx.selectFrom('cash_sessions').selectAll().where('id', '=', sessionId).forUpdate().executeTakeFirst();
    if (!s || s.closed_at) throw conflict('Sessão de caixa não está aberta.');
    const b = await sql<{ bal: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::bigint as bal from cash_movements where account_id = ${s.account_id}`.execute(trx);
    const expected = b.rows[0]!.bal;
    const diff = countedCents - expected;
    if (diff !== 0n && (!justification || justification.trim().length < 5)) throw invalid('Diferença no caixa exige justificativa.', { justification: 'obrigatória' });
    await trx.updateTable('cash_sessions').set({ closed_at: new Date(), closed_by: actor.userId, expected_cents: expected, counted_cents: countedCents, difference_cents: diff, justification: justification ?? null }).where('id', '=', sessionId).execute();
    if (diff !== 0n) {
      await trx.insertInto('cash_movements').values({
        tenant_id: actor.tenantId, account_id: s.account_id, direction: diff > 0n ? 'in' : 'out', amount_cents: diff > 0n ? diff : -diff, kind: 'cash_adjustment',
        origin_type: 'cash_session', origin_id: s.id, occurred_on: todayLocal(actor.timezone), description: `Diferença de fechamento: ${justification}`, created_by: actor.userId,
      }).execute();
    }
    await audit(trx, actor, 'finance.cash_closed', 'cash_session', sessionId, { expected, counted: countedCents, diff });
    return { expectedCents: expected, differenceCents: diff };
  });
}

// Períodos -----------------------------------------------------------------------------------

export async function setPeriodStatus(deps: AppDeps, actor: Actor, period: string, status: 'closed' | 'reopened', reason: string) {
  requirePermission(actor, status === 'closed' ? 'finance.manage' : 'reversals.execute');
  if (!/^\d{4}-\d{2}$/.test(period)) throw invalid('Período inválido (AAAA-MM).');
  if (reason.trim().length < 3) throw invalid('Informe o motivo.');
  return tx(deps, actor, async (trx) => {
    await trx
      .insertInto('financial_periods')
      .values({ tenant_id: actor.tenantId, period, status, ...(status === 'closed' ? { closed_at: new Date(), closed_by: actor.userId } : { reopened_at: new Date(), reopened_by: actor.userId }), reason })
      .onConflict((oc) => oc.columns(['tenant_id', 'period']).doUpdateSet({ status, reason, ...(status === 'closed' ? { closed_at: new Date(), closed_by: actor.userId } : { reopened_at: new Date(), reopened_by: actor.userId }) }))
      .execute();
    await audit(trx, actor, `finance.period_${status}`, 'financial_period', period, { reason });
  });
}

export async function listPeriods(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'finance.view');
  return tx(deps, actor, (trx) => trx.selectFrom('financial_periods').selectAll().orderBy('period', 'desc').execute());
}

/** Crédito manual autorizado (ajuste) com trilha. */
export async function adjustStoreCredit(deps: AppDeps, actor: Actor, partyId: string, amountCents: bigint, reason: string) {
  requirePermission(actor, 'finance.manage');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo.');
  return tx(deps, actor, async (trx) => {
    if (amountCents > 0n) await issueStoreCredit(trx, actor, { partyId, amountCents, originType: 'manual', originId: null, reason, kind: 'adjustment' });
    else await revokeStoreCredit(trx, actor, { partyId, amountCents: -amountCents, originType: 'manual', originId: partyId, reason });
    await audit(trx, actor, 'finance.store_credit_adjusted', 'party', partyId, { amount: amountCents, reason });
  });
}

export { addDays };
