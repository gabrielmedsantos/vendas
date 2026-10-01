import { expect, test, type APIRequestContext } from '@playwright/test';

/** Loja de exemplo com movimento em vários dias: fotos do Início e do Fluxo de caixa (computador e celular). */
const run = Date.now().toString(36);
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

async function post(r: APIRequestContext, path: string, data: unknown, key = true) {
  const res = await r.post(`/api/v1/${path}`, { data, headers: { ...H, ...(key ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}
// Datas no fuso da loja (America/Sao_Paulo), não no do computador que roda o teste.
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const DAY = 86400000;

test('telas do Início e do Fluxo de caixa com dados', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL: H.origin, viewport: { width: 1440, height: 1000 } });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Visual', email: `visual-${run}@example.test`, password: 'senha-visual-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'Loja Visual' }, false);
  await post(r, 'tenant/onboarding/dismiss', {}, false);
  const conta = ((await (await r.get('/api/v1/finance/accounts')).json()) as { id: string }[])[0]!.id;
  const sup = await post(r, 'parties', { name: 'Distribuidora Exemplo', isCustomer: false, isSupplier: true }, false);
  const clientes = await Promise.all(['Ana Souza', 'Bruno Lima', 'Carla Dias'].map((name) => post(r, 'parties', { name, isCustomer: true, isSupplier: false }, false)));
  const canais = (await (await r.get('/api/v1/channels')).json()) as { id: string; name: string }[];
  const hoje = new Date();
  const diaHoje = Number(iso(hoje).slice(8, 10));
  const primeiro = new Date(hoje.getTime() - (diaHoje - 1) * DAY);
  await post(r, 'finance/cash-movements', { accountId: conta, kind: 'opening', amountCents: '150000', occurredOn: iso(primeiro), description: 'Saldo inicial' });
  const prods = [];
  for (const [i, [name, price, cost, min]] of ([['Fone Bluetooth TWS', '8990', '3500', 3], ['Carregador Turbo 20W', '5990', '2200', 5], ['Smartwatch D20', '12990', '6000', 2], ['Capinha Silicone', '2990', '700', 10]] as const).entries()) {
    const p = await post(r, 'products', { name, variants: [{ sku: `VIS-${run}-${i}`, retailPriceCents: price, minStock: min }] }, false);
    const v = (await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].id;
    prods.push({ v, price, cost, qty: i === 3 ? 12 : 8 });
  }
  await post(r, 'purchases/quick', { supplierId: sup.id, purchaseDate: iso(primeiro), items: prods.map((p) => ({ variantId: p.v, quantity: p.qty, unitCostCents: p.cost })), paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } });
  const kinds = ['pix', 'credit', 'cash', 'debit', 'pix'] as const;
  const dias = Math.min(diaHoje, 12);
  for (let k = 0; k < dias; k++) {
    const dia = new Date(hoje.getTime() - (dias - 1 - k) * DAY);
    const p = prods[k % prods.length]!;
    const q = 1 + (k % 3 === 0 ? 1 : 0);
    const total = String(Number(p.price) * q);
    await post(r, 'sales', {
      saleDate: iso(dia), customerId: k % 2 || k === dias - 2 ? clientes[k % 3].id : undefined, channelId: canais[k % Math.max(1, canais.length)]?.id,
      items: [{ variantId: p.v, quantity: q, unitPriceCents: p.price }],
      payments: [k === dias - 2 ? { kind: 'installment', amountCents: total, installments: 2, firstDueDate: iso(new Date(hoje.getTime() + 5 * DAY)) } : { kind: kinds[k % kinds.length], amountCents: total }],
    });
  }
  await post(r, 'finance/expenses', { description: 'Anúncios Instagram', competenceDate: iso(hoje), amountCents: '15000', payNow: { accountId: conta, method: 'pix' } });
  await post(r, 'finance/expenses', { description: 'Aluguel do ponto', competenceDate: iso(hoje), amountCents: '80000', dueDate: iso(new Date(hoje.getTime() + 3 * DAY)) });

  const page = await ctx.newPage();
  await page.goto('/app');
  await expect(page.getByText('Lucro bruto').first()).toBeVisible();
  await expect(page.getByText('Defina uma meta de faturamento')).toBeVisible();
  await page.getByRole('button', { name: 'Definir meta' }).click();
  await page.getByLabel('Meta de faturamento do mês').fill('3000');
  await page.getByRole('button', { name: 'Salvar meta' }).click();
  await expect(page.getByText(/Faltam R\$/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../test-results/inicio.png', fullPage: true });

  await page.goto('/app/financeiro');
  await expect(page.getByText('Entradas no período')).toBeVisible();
  await expect(page.getByText('Saldo em caixa hoje')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../test-results/fluxo-de-caixa.png', fullPage: true });
  // Clique numa origem filtra a lista.
  await page.getByRole('button', { name: /Despesas/ }).first().click();
  await expect(page.locator('tbody tr').filter({ hasText: 'Anúncios Instagram' })).toHaveCount(1);
  await expect(page.locator('tbody tr').filter({ hasText: 'Entrada' })).toHaveCount(0);
  // Período anterior: mês passado sem movimento.
  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect(page.getByText('Nenhuma entrada ou saída neste período.')).toBeVisible();

  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto('/app');
  await expect(mob.getByText('Lucro bruto').first()).toBeVisible();
  await mob.screenshot({ path: '../test-results/inicio-celular.png', fullPage: true });
  expect(await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await mob.goto('/app/financeiro');
  await expect(mob.getByText('Entradas no período')).toBeVisible();
  await mob.screenshot({ path: '../test-results/fluxo-celular.png', fullPage: true });
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});
