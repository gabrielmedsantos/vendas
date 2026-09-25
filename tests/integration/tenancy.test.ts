import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql, withTenant } from '@gct/db';
import {
  acceptInvite, createInvite, revokeInvite, listMembers, getProduct, listProducts, listTenantsForUser, resolveActor, updateMember, updateProduct,
  zProduct, zProductList, listParties, zPartyList, createProduct,
} from '@gct/app';
import { AppError } from '@gct/shared';
import { addMember, closeDeps, createTenant, createUser, makeParty, makeProduct, testDeps, type TenantFixture } from './helpers';
import { URLS } from './env';

const deps = testDeps();
let A: TenantFixture;
let B: TenantFixture;
let productA: { productId: string; variantId: string };

beforeAll(async () => {
  A = await createTenant(deps, 'Empresa Demo A');
  B = await createTenant(deps, 'Empresa Demo B');
  productA = await makeProduct(deps, A.owner, { name: 'Celular Demo A', sku: 'DEMO-SAI-001' });
  await makeProduct(deps, B.owner, { name: 'Camiseta Demo B', sku: 'DEMO-SAI-001' });
  await makeParty(deps, A.owner, 'Cliente Demonstração A');
});
afterAll(closeDeps);

describe('isolamento por empresa', () => {
  it('T-001: empresa B não lê nem altera produto de A (404 genérico)', async () => {
    await expect(getProduct(deps, B.owner, productA.productId)).rejects.toMatchObject({ code: 'not_found' });
    const input = zProduct.parse({ name: 'Invasão', variants: [{ sku: 'X-1', retailPriceCents: '1' }] });
    await expect(updateProduct(deps, B.owner, productA.productId, input)).rejects.toMatchObject({ code: 'not_found' });
    const list = await listProducts(deps, B.owner, zProductList.parse({ q: 'Celular' }));
    expect(list.data).toHaveLength(0);
    const parties = await listParties(deps, B.owner, zPartyList.parse({ q: 'Demonstração A' }));
    expect(parties.data).toHaveLength(0);
    // Produto de A permanece intacto.
    const p = await getProduct(deps, A.owner, productA.productId);
    expect(p.name).toBe('Celular Demo A');
  });

  it('SKU é único por empresa, não global', async () => {
    const a = await listProducts(deps, A.owner, zProductList.parse({ q: 'DEMO-SAI-001' }));
    const b = await listProducts(deps, B.owner, zProductList.parse({ q: 'DEMO-SAI-001' }));
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
    await expect(
      createProduct(deps, A.owner, zProduct.parse({ name: 'Duplicado', variants: [{ sku: 'demo-sai-001', retailPriceCents: '1' }] })),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('usuário sem vínculo não resolve contexto da empresa', async () => {
    await expect(resolveActor(deps, B.ownerUser.id, A.tenantId)).rejects.toMatchObject({ code: 'not_found' });
    const mine = await listTenantsForUser(deps, A.ownerUser.id);
    expect(mine.map((t) => t.id)).toEqual([A.tenantId]);
  });

  it('T-002: sem app.tenant_id nenhuma linha é visível e escrita é negada', async () => {
    const c = new pg.Client({ connectionString: URLS.app });
    await c.connect();
    try {
      const r = await c.query('select count(*)::int as n from products');
      expect(r.rows[0].n).toBe(0);
      const t = await c.query('select count(*)::int as n from tenants');
      expect(t.rows[0].n).toBe(0);
      await expect(
        c.query(`insert into categories (tenant_id, name) values ($1, 'x')`, [A.tenantId]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await c.end();
    }
  });

  it('T-003: papel de runtime não desliga RLS nem tem privilégios elevados', async () => {
    const c = new pg.Client({ connectionString: URLS.app });
    await c.connect();
    try {
      const role = await c.query(`select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user`);
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
      await c.query('set row_security = off');
      await expect(c.query('select * from products')).rejects.toThrow(/row-level security/);
      await expect(c.query('alter table products disable row level security')).rejects.toThrow(/must be owner/);
      await expect(c.query('select * from "user"')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  it('contexto de tenant não vaza entre transações no pool', async () => {
    await withTenant(deps.dbs.app, { tenantId: A.tenantId }, async (trx) => {
      const r = await sql<{ n: number }>`select count(*)::int as n from products`.execute(trx);
      expect(r.rows[0]!.n).toBeGreaterThan(0);
    });
    const after = await sql<{ t: string | null }>`select nullif(current_setting('app.tenant_id', true), '') as t`.execute(deps.dbs.app);
    expect(after.rows[0]!.t).toBeNull();
  });

  it('FK composta impede referência a registro de outra empresa mesmo com contexto forjado', async () => {
    const catB = await withTenant(deps.dbs.app, { tenantId: B.tenantId }, (trx) =>
      trx.insertInto('categories').values({ tenant_id: B.tenantId, name: 'Categoria B' }).returning('id').executeTakeFirstOrThrow(),
    );
    await expect(
      withTenant(deps.dbs.app, { tenantId: A.tenantId }, (trx) =>
        trx.updateTable('products').set({ category_id: catB.id }).where('id', '=', productA.productId).execute(),
      ),
    ).rejects.toThrow(/foreign key/);
    // Inserir com tenant_id de outra empresa viola WITH CHECK.
    await expect(
      withTenant(deps.dbs.app, { tenantId: A.tenantId }, (trx) => trx.insertInto('categories').values({ tenant_id: B.tenantId, name: 'Forjada' }).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it('papel público não lê colunas de custo nem produtos fora de catálogo publicado', async () => {
    const c = new pg.Client({ connectionString: URLS.public });
    await c.connect();
    try {
      await c.query(`select set_config('app.tenant_id', $1, false)`, [A.tenantId]);
      await expect(c.query('select cost_remaining_cents from inventory_lots')).rejects.toThrow(/permission denied/);
      await expect(c.query('select suggested_price_cents from product_variants')).rejects.toThrow(/permission denied/);
      const r = await c.query('select id from product_variants');
      expect(r.rows).toHaveLength(0);
    } finally {
      await c.end();
    }
  });
});

describe('membros e permissões', () => {
  it('RF-02: vendedor não recebe custo pela API e não ajusta estoque', async () => {
    const seller = await addMember(deps, A.tenantId, 'seller');
    const list = await listProducts(deps, seller, zProductList.parse({}));
    expect(list.data.length).toBeGreaterThan(0);
    for (const row of list.data) {
      expect(row).not.toHaveProperty('stock_cost_cents');
      expect(row).not.toHaveProperty('unit_cost_cents');
    }
    expect(list.summary).not.toHaveProperty('stockCostCents');
    const detail = await getProduct(deps, seller, productA.productId);
    expect(detail.lots).toBeUndefined();
    await expect(
      updateProduct(deps, seller, productA.productId, zProduct.parse({ name: 'x', variants: [{ sku: 'y', retailPriceCents: '1' }] })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('não remove o último proprietário', async () => {
    const m = await withTenant(deps.dbs.app, A.owner, (trx) => trx.selectFrom('memberships').select('id').where('user_id', '=', A.ownerUser.id).executeTakeFirstOrThrow());
    await expect(updateMember(deps, A.owner, m.id, { remove: true })).rejects.toMatchObject({ code: 'conflict' });
    await expect(updateMember(deps, A.owner, m.id, { role: 'manager' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('convite é de uso único, expira e exige o mesmo e-mail', async () => {
    const invitee = await createUser(deps, 'Convidado');
    const inv = await createInvite(deps, A.owner, { email: invitee.email, role: 'finance' }, 'http://localhost:3000');
    const token = inv.link.split('/convite/')[1]!;
    const intruder = await createUser(deps, 'Intruso');
    await expect(acceptInvite(deps, intruder, token)).rejects.toMatchObject({ code: 'forbidden' });
    const r = await acceptInvite(deps, invitee, token);
    expect(r.tenantId).toBe(A.tenantId);
    await expect(acceptInvite(deps, invitee, token)).rejects.toBeInstanceOf(AppError);
    const actor = await resolveActor(deps, invitee.id, A.tenantId);
    expect(actor.role).toBe('finance');
    expect(actor.permissions.has('finance.settle_receivable')).toBe(true);
    expect(actor.permissions.has('sales.create')).toBe(false);
  });

  it('convite por link: qualquer pessoa aceita uma vez; revogado e proprietário por link são recusados', async () => {
    const inv = await createInvite(deps, A.owner, { role: 'seller', label: 'Vendedor por link' }, 'http://localhost:3000');
    const token = inv.link.split('/convite/')[1]!;
    const primeira = await createUser(deps, 'Quem abriu primeiro');
    const segunda = await createUser(deps, 'Quem abriu depois');
    expect((await acceptInvite(deps, primeira, token)).tenantId).toBe(A.tenantId);
    expect((await resolveActor(deps, primeira.id, A.tenantId)).role).toBe('seller');
    await expect(acceptInvite(deps, segunda, token)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(resolveActor(deps, segunda.id, A.tenantId)).rejects.toBeInstanceOf(AppError);

    const rev = await createInvite(deps, A.owner, { role: 'viewer' }, 'http://localhost:3000');
    await revokeInvite(deps, A.owner, rev.inviteId);
    await expect(acceptInvite(deps, segunda, rev.link.split('/convite/')[1]!)).rejects.toMatchObject({ code: 'validation_failed' });

    await expect(createInvite(deps, A.owner, { role: 'owner' }, 'http://localhost:3000')).rejects.toMatchObject({ code: 'validation_failed' });
    const lista = await listMembers(deps, A.owner);
    expect(lista.invites.some((i) => i.label === 'Vendedor por link')).toBe(false); // aceito sai da lista
  });
});
