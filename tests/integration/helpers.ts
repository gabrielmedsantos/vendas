import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabases, sql, withTenant, type Databases } from '@gct/db';
import {
  LocalStorage, MemoryMailer, provisionTenant, resolveActor, createProduct, createParty, quickPurchase, zProduct, zParty, zPurchase,
  type Actor, type AppDeps,
} from '@gct/app';
import { effectivePermissions, type Role } from '@gct/shared';
import { URLS } from './env';

let shared: { dbs: Databases; deps: AppDeps } | null = null;

export function testDeps(): AppDeps {
  if (!shared) {
    const dbs = createDatabases({ appUrl: URLS.app, authUrl: URLS.auth, platformUrl: URLS.platform, publicUrl: URLS.public, poolMax: 20 });
    const deps: AppDeps = { dbs, storage: new LocalStorage(mkdtempSync(join(tmpdir(), 'gct-storage-'))), mailer: new MemoryMailer() };
    shared = { dbs, deps };
  }
  return shared.deps;
}

export async function closeDeps() {
  if (shared) await shared.dbs.close();
  shared = null;
}

export async function createUser(deps: AppDeps, name = 'Pessoa Teste'): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `u-${id.slice(0, 8)}@example.test`;
  await deps.dbs.authPool.query('insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)', [id, name, email]);
  return { id, email };
}

export interface TenantFixture {
  tenantId: string;
  owner: Actor;
  ownerUser: { id: string; email: string };
}

export async function createTenant(deps: AppDeps, name = 'Empresa Demo'): Promise<TenantFixture> {
  const user = await createUser(deps, `Dono ${name}`);
  const { tenantId } = await provisionTenant(deps, user.id, { name });
  const owner = await resolveActor(deps, user.id, tenantId);
  return { tenantId, owner, ownerUser: user };
}

/** Adiciona membro com papel (via papel de plataforma, como faria um convite aceito). */
export async function addMember(deps: AppDeps, tenantId: string, role: Role, grants: string[] = []): Promise<Actor> {
  const u = await createUser(deps, `Membro ${role}`);
  await deps.dbs.platform.insertInto('memberships').values({ tenant_id: tenantId, user_id: u.id, role, grants }).execute();
  return resolveActor(deps, u.id, tenantId);
}

export function withPerms(actor: Actor, role: Role, grants: string[] = []): Actor {
  return { ...actor, role, permissions: effectivePermissions(role, grants) };
}

/**
 * Contas para os testes de várias contas. Empresa nova nasce com uma conta só ("Conta da loja");
 * aqui se cria um caixa separado para dinheiro (configuração ainda suportada), como a loja faria em Financeiro.
 */
export async function accounts(deps: AppDeps, actor: Actor) {
  return withTenant(deps.dbs.app, actor, async (trx) => {
    let rows = await trx.selectFrom('financial_accounts').select(['id', 'kind', 'name']).where('status', '=', 'active').execute();
    if (!rows.some((r) => r.kind === 'cash')) {
      const c = await trx.insertInto('financial_accounts').values({ tenant_id: actor.tenantId, name: 'Caixa da loja', kind: 'cash' }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('payment_methods').set({ account_id: c.id }).where('kind', '=', 'cash').execute();
      rows = await trx.selectFrom('financial_accounts').select(['id', 'kind', 'name']).where('status', '=', 'active').execute();
    }
    return { cash: rows.find((r) => r.kind === 'cash')!.id, bank: rows.find((r) => r.kind === 'bank')!.id };
  });
}

export async function makeProduct(deps: AppDeps, actor: Actor, opts: { name?: string; sku?: string; tracking?: 'quantity' | 'serialized'; priceCents?: bigint; minStock?: number } = {}) {
  const input = zProduct.parse({
    name: opts.name ?? 'Produto Demo',
    tracking: opts.tracking ?? 'quantity',
    identifierKinds: opts.tracking === 'serialized' ? ['imei1'] : [],
    variants: [{ sku: opts.sku ?? `SKU-${randomUUID().slice(0, 8)}`, retailPriceCents: String(opts.priceCents ?? 10000n), minStock: opts.minStock ?? 0 }],
  });
  const { id } = await createProduct(deps, actor, input);
  const v = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('product_variants').select('id').where('product_id', '=', id).executeTakeFirstOrThrow());
  return { productId: id, variantId: v.id };
}

export async function makeParty(deps: AppDeps, actor: Actor, name = 'Cliente Demonstração', roles: { customer?: boolean; supplier?: boolean } = { customer: true, supplier: true }) {
  const r = await createParty(deps, actor, zParty.parse({ name, isCustomer: roles.customer ?? true, isSupplier: roles.supplier ?? false }));
  return r.id;
}

/** Entrada de estoque por compra paga à vista (custo por unidade). */
export async function stockUp(
  deps: AppDeps,
  actor: Actor,
  supplierId: string,
  items: { variantId: string; quantity: number; unitCostCents: bigint; units?: { identifiers: { kind: 'imei1' | 'serial'; value: string }[]; condition?: 'new' | 'used' }[] }[],
) {
  const acc = await accounts(deps, actor);
  const input = zPurchase.parse({
    supplierId,
    purchaseDate: todayIn(actor),
    items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitCostCents: String(i.unitCostCents), unitSpecs: i.units })),
    paymentTerms: { mode: 'pay_now', accountId: acc.bank, method: 'pix' },
  });
  return quickPurchase(deps, actor, input, randomUUID());
}

export function todayIn(actor: Actor): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: actor.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Saldos de contas (soma de movimentos). */
export async function accountBalance(deps: AppDeps, actor: Actor, accountId: string): Promise<bigint> {
  return withTenant(deps.dbs.app, actor, async (trx) => {
    const r = await sql<{ b: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::bigint as b from cash_movements where account_id = ${accountId}`.execute(trx);
    return r.rows[0]!.b;
  });
}

/**
 * Reconciliadores: estoque vs ledger, lotes vs saldo, títulos vs alocações,
 * contas vs movimentos, crédito vs lançamentos. Retorna lista de diferenças.
 */
export async function reconcile(deps: AppDeps, actor: Actor): Promise<string[]> {
  return withTenant(deps.dbs.app, actor, async (trx) => {
    const diffs: string[] = [];
    const stock = await sql<{ variant_id: string; bal: number; ledger: number; lots: number }>`
      select b.variant_id, (b.on_hand + b.inspection) as bal,
        coalesce((select sum(case when m.direction='in' then m.quantity else -m.quantity end) from stock_movements m where m.variant_id = b.variant_id and m.kind <> 'inspection_release'), 0)::int as ledger,
        coalesce((select sum(l.qty_remaining) from inventory_lots l where l.variant_id = b.variant_id), 0)::int as lots
      from stock_balances b`.execute(trx);
    for (const s of stock.rows) {
      if (s.bal !== s.ledger) diffs.push(`estoque ${s.variant_id}: saldo ${s.bal} ≠ ledger ${s.ledger}`);
      if (s.bal !== s.lots) diffs.push(`estoque ${s.variant_id}: saldo ${s.bal} ≠ lotes ${s.lots}`);
    }
    const buckets = await sql<{ variant_id: string; on_hand: number; lots_av: number; inspection: number; lots_insp: number }>`
      select b.variant_id, b.on_hand, b.inspection,
        coalesce((select sum(qty_remaining) from inventory_lots l where l.variant_id = b.variant_id and l.status='available'),0)::int as lots_av,
        coalesce((select sum(qty_remaining) from inventory_lots l where l.variant_id = b.variant_id and l.status='inspection'),0)::int as lots_insp
      from stock_balances b`.execute(trx);
    for (const b of buckets.rows) {
      if (b.on_hand !== b.lots_av) diffs.push(`disponível ${b.variant_id}: ${b.on_hand} ≠ lotes ${b.lots_av}`);
      if (b.inspection !== b.lots_insp) diffs.push(`inspeção ${b.variant_id}: ${b.inspection} ≠ lotes ${b.lots_insp}`);
    }
    const units = await sql<{ id: string }>`
      select u.id from inventory_units u left join inventory_lots l on l.id = u.current_lot_id
      where (u.status in ('available','reserved','inspection') and coalesce(l.qty_remaining,0) <> 1)
         or (u.status in ('sold','lost','returned_to_supplier') and coalesce(l.qty_remaining,0) <> 0)`.execute(trx);
    for (const u of units.rows) diffs.push(`unidade ${u.id} inconsistente com lote`);
    const titles = await sql<{ id: string; balance: bigint; computed: bigint }>`
      select t.id, t.balance_cents as balance,
        t.original_cents
        - coalesce((select sum(case when s.reversal_of is null then a.amount_cents else -a.amount_cents end) from settlement_allocations a join settlements s on s.id = a.settlement_id where a.title_id = t.id), 0)
        - coalesce((select sum(case when o.reversal_of is null then a.amount_cents else -a.amount_cents end) from offset_allocations a join offsets o on o.id = a.offset_id where a.title_id = t.id), 0)
        + coalesce((select sum(e.amount_cents) from store_credit_entries e where e.title_id = t.id), 0)
        - coalesce((select sum(amount_cents) from title_adjustments where title_id = t.id), 0) as computed
      from financial_titles t`.execute(trx);
    for (const t of titles.rows) if (t.balance !== t.computed) diffs.push(`título ${t.id}: saldo ${t.balance} ≠ calculado ${t.computed}`);
    const credits = await sql<{ party_id: string; bal: bigint; sum: bigint }>`
      select c.party_id, c.balance_cents as bal, coalesce((select sum(amount_cents) from store_credit_entries e where e.party_id = c.party_id), 0) as sum
      from store_credit_balances c`.execute(trx);
    for (const c of credits.rows) if (c.bal !== c.sum) diffs.push(`crédito ${c.party_id}: ${c.bal} ≠ ${c.sum}`);
    const settlementsCash = await sql<{ id: string }>`
      select s.id from settlements s where s.reversal_of is null and
        (case when s.direction='in' then s.net_cents else s.gross_cents end) > 0 and
        not exists (select 1 from cash_movements m where m.origin_type='settlement' and m.origin_id = s.id and m.amount_cents = (case when s.direction='in' then s.net_cents else s.gross_cents end))`.execute(trx);
    for (const s of settlementsCash.rows) diffs.push(`liquidação ${s.id} sem movimento de caixa correspondente`);
    const trades = await sql<{ id: string }>`
      select t.id from trades t join sales s on s.id = t.sale_id join purchases p on p.id = t.purchase_id
      where s.total_cents <> t.sale_total_cents or p.total_cents <> t.purchase_total_cents`.execute(trx);
    for (const t of trades.rows) diffs.push(`troca ${t.id}: totais divergentes de venda/compra`);
    return diffs;
  });
}
