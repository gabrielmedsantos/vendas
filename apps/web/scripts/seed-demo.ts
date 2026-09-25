/**
 * Dados de demonstração (desenvolvimento/homologação): duas empresas fictícias
 * com compras, vendas, troca, crediário e despesa passando pelas mesmas regras
 * da aplicação (nada é inserido "por fora" nas tabelas de negócio).
 *
 * Uso: SEED_PASSWORD='senha-com-10+' pnpm --filter @gct/web seed:demo
 * Recusa rodar com NODE_ENV=production ou APP_URL https, salvo SEED_ALLOW_REMOTE=1.
 * Idempotente por e-mail: se o usuário demo já existe, não recria. SEED_TAG muda os e-mails
 * (ex.: SEED_TAG=v2) para gerar um novo conjunto sem tocar no anterior.
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { createDatabases, databaseConfigFromEnv, withTenant } from '@gct/db';
import * as A from '@gct/app';
import { todayLocal } from '@gct/app';

const password = process.env.SEED_PASSWORD ?? '';
if (password.length < 10) throw new Error('Defina SEED_PASSWORD (mínimo 10 caracteres) para os usuários demo.');
if ((process.env.NODE_ENV === 'production' || (process.env.APP_URL ?? '').startsWith('https://')) && process.env.SEED_ALLOW_REMOTE !== '1')
  throw new Error('Seed recusado em produção. Use SEED_ALLOW_REMOTE=1 apenas em homologação isolada.');

const dbs = createDatabases(databaseConfigFromEnv());
const deps: A.AppDeps = { dbs, storage: new A.LocalStorage(process.env.STORAGE_PATH ?? './storage'), mailer: new A.MemoryMailer() };
const key = () => randomUUID();
const tag = (process.env.SEED_TAG ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const mail = (base: string) => `${base}${tag ? `-${tag}` : ''}@example.test`;

async function demoUser(email: string, name: string): Promise<string | null> {
  const exists = await dbs.authPool.query('select id from "user" where email = $1', [email]);
  if (exists.rows[0]) return null;
  const id = randomUUID().replace(/-/g, '').slice(0, 32);
  await dbs.authPool.query('insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())', [id, name, email]);
  await dbs.authPool.query(
    'insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())',
    [randomUUID(), id, 'credential', id, await hashPassword(password)],
  );
  return id;
}

async function accountsOf(actor: A.Actor) {
  return withTenant(dbs.app, actor, async (trx) => {
    const rows = await trx.selectFrom('financial_accounts').select(['id', 'kind']).execute();
    return { cash: rows.find((r) => r.kind === 'cash')!.id, bank: rows.find((r) => r.kind === 'bank')!.id };
  });
}

async function variantOf(actor: A.Actor, productId: string) {
  return withTenant(dbs.app, actor, (trx) => trx.selectFrom('product_variants').select('id').where('product_id', '=', productId).executeTakeFirstOrThrow()).then((v) => v.id);
}

async function seedPhones() {
  const userId = await demoUser(mail('demo-celulares'), 'Pessoa Demo Celulares');
  if (!userId) return console.log('demo-celulares já existe; pulando.');
  const { tenantId } = await A.provisionTenant(deps, userId, { name: 'Loja Demo Celulares' });
  const actor = await A.resolveActor(deps, userId, tenantId);
  const acc = await accountsOf(actor);
  const today = todayLocal(actor.timezone);
  await A.updateTenantProfile(deps, actor, { settings: { warrantyTerms: 'Garantia comercial contra defeitos de funcionamento. Não cobre quedas, oxidação ou mau uso. (Texto de demonstração.)' } });

  const supplier = await A.createParty(deps, actor, A.zParty.parse({ name: 'Distribuidora Fictícia Ltda', isSupplier: true, isCustomer: false }));
  const ana = await A.createParty(deps, actor, A.zParty.parse({ name: 'Cliente Demonstração Ana', isCustomer: true, phone: '11999990001' }));
  const bruno = await A.createParty(deps, actor, A.zParty.parse({ name: 'Cliente Demonstração Bruno', isCustomer: true, phone: '11999990002' }));

  const phone = await A.createProduct(deps, actor, A.zProduct.parse({ name: 'Smartphone Demo X 128 GB', tracking: 'serialized', identifierKinds: ['imei1'], warrantyDays: 90, variants: [{ sku: 'DEMO-SPX-128', retailPriceCents: '189900' }] }));
  const cable = await A.createProduct(deps, actor, A.zProduct.parse({ name: 'Cabo USB-C Demo', warrantyDays: 30, variants: [{ sku: 'DEMO-CABO-C', retailPriceCents: '3990', minStock: 5 }] }));
  const phoneV = await variantOf(actor, phone.id);
  const cableV = await variantOf(actor, cable.id);

  const buy = await A.quickPurchase(deps, actor, A.zPurchase.parse({
    supplierId: supplier.id, purchaseDate: today,
    items: [
      { variantId: phoneV, quantity: 3, unitCostCents: '140000', unitSpecs: ['DEMO-000000000000001', 'DEMO-000000000000002', 'DEMO-000000000000003'].map((v) => ({ identifiers: [{ kind: 'imei1', value: v }], condition: 'new' })) },
      { variantId: cableV, quantity: 20, unitCostCents: '1200' },
    ],
    paymentTerms: { mode: 'pay_now', accountId: acc.bank, method: 'pix' },
  }), key());
  const [u1, u2] = buy.unitIds;

  await A.confirmSale(deps, actor, A.zSale.parse({ customerId: ana.id, items: [{ variantId: phoneV, unitId: u1, quantity: 1, unitPriceCents: '189900' }, { variantId: cableV, quantity: 1, unitPriceCents: '3990' }], payments: [{ kind: 'pix', amountCents: '193890' }] }), key());
  await A.confirmSale(deps, actor, A.zSale.parse({ customerId: bruno.id, items: [{ variantId: cableV, quantity: 2, unitPriceCents: '3990' }], payments: [{ kind: 'installment', amountCents: '7980', installments: 2 }] }), key());
  // Troca: cliente entrega um usado avaliado em R$ 1.100 e paga a diferença no Pix.
  await A.confirmTrade(deps, actor, A.zTrade.parse({
    partyId: bruno.id,
    outgoing: [{ variantId: phoneV, unitId: u2, quantity: 1, unitPriceCents: '189900' }],
    incoming: [{ newProduct: { name: 'Smartphone Demo Usado 64 GB' }, agreedCents: '110000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-000000000000099' }], condition: 'used' } }],
    differencePolicy: 'receive',
    differencePayments: [{ kind: 'pix', amountCents: '79900' }],
  }), key());
  await A.createExpense(deps, actor, A.zExpense.parse({ description: 'Aluguel da loja (demo)', competenceDate: today, amountCents: '250000', payNow: { accountId: acc.bank, method: 'pix' } }), key());
  await A.createServiceOrder(deps, actor, { title: 'Troca de película (demo)', partyId: ana.id, priceCents: 3000n });
  console.log(`Loja Demo Celulares criada: ${mail('demo-celulares')}`);
}

async function seedClothes() {
  const userId = await demoUser(mail('demo-brecho'), 'Pessoa Demo Brechó');
  if (!userId) return console.log('demo-brecho já existe; pulando.');
  const { tenantId } = await A.provisionTenant(deps, userId, { name: 'Brechó Demo' });
  const actor = await A.resolveActor(deps, userId, tenantId);
  const acc = await accountsOf(actor);
  const today = todayLocal(actor.timezone);
  const supplier = await A.createParty(deps, actor, A.zParty.parse({ name: 'Fornecedora Demonstração', isSupplier: true, isCustomer: true }));
  const jacket = await A.createProduct(deps, actor, A.zProduct.parse({ name: 'Jaqueta Jeans Demo', variants: [{ sku: 'DEMO-JAQ-M', label: 'M', retailPriceCents: '12000' }] }));
  const jacketV = await variantOf(actor, jacket.id);
  await A.quickPurchase(deps, actor, A.zPurchase.parse({ supplierId: supplier.id, purchaseDate: today, items: [{ variantId: jacketV, quantity: 6, unitCostCents: '3500' }], paymentTerms: { mode: 'installments', count: 2, firstDueDate: today, interval: 30 } }), key());
  await A.confirmSale(deps, actor, A.zSale.parse({ items: [{ variantId: jacketV, quantity: 2, unitPriceCents: '12000' }], discountCents: '2000', payments: [{ kind: 'cash', amountCents: '22000', accountId: acc.cash }] }), key());
  console.log(`Brechó Demo criado: ${mail('demo-brecho')}`);
}

try {
  await seedPhones();
  await seedClothes();
  await A.processOutboxBatch(deps, 100);
} catch (e) {
  const err = e as { message: string; fields?: unknown };
  console.error(`Seed interrompido: ${err.message}${err.fields ? ` ${JSON.stringify(err.fields)}` : ''}`);
  process.exitCode = 1;
} finally {
  await dbs.close();
}
