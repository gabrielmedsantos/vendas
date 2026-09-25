import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Capturas visuais (doc 06): shell, painel, venda e troca nos quatro tamanhos.
 * Semeia dados sintéticos pela própria API. Saída em test-results/screens.
 */
const run = Date.now().toString(36);
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

async function post(r: APIRequestContext, path: string, data: unknown, key = true) {
  const res = await r.post(`/api/v1/${path}`, { data, headers: { ...H, ...(key ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

test('capturas por viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' });
  const r = ctx.request;
  const email = `visual-${run}@example.test`;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Visual', email, password: 'senha-visual-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'Loja Visual Demo' }, false);
  const cat = await post(r, 'categories', { name: 'Eletrônicos' }, false);
  const cel = await post(r, 'products', { name: 'Celular Demo 128 GB', tracking: 'serialized', categoryId: cat.id, identifierKinds: ['imei1'], variants: [{ sku: `CEL-${run}`, retailPriceCents: '400000' }] }, false);
  const capa = await post(r, 'products', { name: 'Capa Demo', categoryId: cat.id, variants: [{ sku: `CAPA-${run}`, retailPriceCents: '5000', minStock: 5 }] }, false);
  const celV = (await (await r.get(`/api/v1/products/${cel.id}`)).json()).variants[0].id;
  const capaV = (await (await r.get(`/api/v1/products/${capa.id}`)).json()).variants[0].id;
  const sup = await post(r, 'parties', { name: 'Distribuidora Demo', isCustomer: false, isSupplier: true }, false);
  const cli = await post(r, 'parties', { name: 'Cliente Demonstração', isCustomer: true }, false);
  const acc = (await (await r.get('/api/v1/finance/accounts')).json()) as { id: string; kind: string }[];
  const bank = acc.find((a) => a.kind === 'bank')!.id;
  const pur = await post(r, 'purchases/quick', {
    supplierId: sup.id, purchaseDate: new Date().toISOString().slice(0, 10),
    items: [
      { variantId: celV, quantity: 2, unitCostCents: '300000', unitSpecs: [{ identifiers: [{ kind: 'imei1', value: `DEMO-IMEI-${run}-1` }] }, { identifiers: [{ kind: 'imei1', value: `DEMO-IMEI-${run}-2` }] }] },
      { variantId: capaV, quantity: 6, unitCostCents: '2000' },
    ],
    paymentTerms: { mode: 'pay_now', accountId: bank, method: 'pix' },
  });
  await post(r, 'sales', { items: [{ variantId: capaV, quantity: 2, unitPriceCents: '5000' }], payments: [{ kind: 'pix', amountCents: '10000' }] });
  await post(r, 'trades', {
    partyId: cli.id,
    outgoing: [{ variantId: celV, unitId: pur.unitIds[0], quantity: 1, unitPriceCents: '400000' }],
    incoming: [{ newProduct: { name: 'Celular usado Demo' }, agreedCents: '150000', unit: { identifiers: [{ kind: 'imei1', value: `DEMO-IMEI-${run}-IN` }], condition: 'used' } }],
    differencePolicy: 'receive', differencePayments: [{ kind: 'pix', amountCents: '250000' }],
  });
  await post(r, 'sales', { customerId: cli.id, items: [{ variantId: capaV, quantity: 1, unitPriceCents: '5000' }], payments: [{ kind: 'installment', amountCents: '5000', installments: 1 }] });

  const pages = [
    { path: '/app', name: 'inicio' },
    { path: '/app/vendas/nova', name: 'nova-venda' },
    { path: '/app/trocas/nova', name: 'nova-troca' },
    { path: '/app/produtos', name: 'produtos' },
    { path: '/app/financeiro/receber', name: 'receber' },
  ];
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    for (const p of pages) {
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');
      if (p.name === 'nova-troca') {
        await page.getByLabel('Buscar produto').first().pressSequentially('Celular', { delay: 10 });
        await page.getByRole('button', { name: /Celular Demo 128/ }).first().click();
        await page.getByLabel('Unidade').selectOption({ index: 1 });
        await page.getByLabel('Nome do produto recebido').fill('Celular usado Demo 2');
        await page.getByRole('textbox', { name: /Valor acordado/ }).fill('1800');
        await page.getByRole('textbox', { name: /Valor acordado/ }).blur();
        await page.waitForTimeout(800);
      }
      await page.screenshot({ path: `../test-results/screens/${vp.name}-${p.name}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${vp.name} ${p.name} sem rolagem horizontal da página`).toBeLessThanOrEqual(1);
    }
    expect(errors, `erros de console em ${vp.name}`).toEqual([]);
    await page.close();
  }
});
