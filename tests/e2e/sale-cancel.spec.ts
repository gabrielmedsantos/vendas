import { expect, test, type APIRequestContext } from '@playwright/test';

/** Venda lançada por engano: cancelar pela tela devolve o valor, volta o item ao estoque e marca "Cancelada". */
const run = Date.now().toString(36);
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

async function post(r: APIRequestContext, path: string, data: unknown, key = true) {
  const res = await r.post(`/api/v1/${path}`, { data, headers: { ...H, ...(key ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

test('cancelar venda de teste pela tela', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: H.origin, viewport: { width: 1400, height: 900 } });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Cancela', email: `cancela-${run}@example.test`, password: 'senha-cancela-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'Loja Cancela' }, false);
  const sup = await post(r, 'parties', { name: 'Fornecedor', isCustomer: false, isSupplier: true }, false);
  const conta = ((await (await r.get('/api/v1/finance/accounts')).json()) as { id: string }[])[0]!.id;
  const p = await post(r, 'products', { name: 'Poltrona Inflável Teste', variants: [{ sku: `CAN-${run}`, retailPriceCents: '13000' }] }, false);
  const variantId = (await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].id;
  await post(r, 'purchases/quick', { supplierId: sup.id, purchaseDate: new Date().toISOString().slice(0, 10), items: [{ variantId, quantity: 1, unitCostCents: '7400' }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } });
  const sale = await post(r, 'sales', { items: [{ variantId, quantity: 1, unitPriceCents: '13000' }], payments: [{ kind: 'pix', amountCents: '13000' }] });
  const saldo = async () => ((await (await r.get('/api/v1/finance/accounts')).json()) as { balanceCents: string }[]).reduce((a, x) => a + BigInt(x.balanceCents), 0n);
  const antes = await saldo();

  const page = await ctx.newPage();
  await page.goto('/app/vendas');
  await expect(page.getByText(/Lançou uma venda por engano\?/)).toBeVisible();
  await page.getByRole('row', { name: /#1/ }).getByRole('cell', { name: 'Pix' }).click(); // a linha inteira abre a venda
  await expect(page).toHaveURL(new RegExp(`/app/vendas/${sale.saleId}`));
  await page.getByRole('button', { name: 'Cancelar venda' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByLabel(/Os produtos não saíram da loja/)).toBeChecked();
  await modal.getByLabel('Motivo').fill('Venda de teste');
  await page.screenshot({ path: '../test-results/cancelar-venda.png' });
  await modal.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText(/Venda cancelada; estorno registrado e itens de volta ao estoque/)).toBeVisible();

  expect(await saldo()).toBe(antes - 13000n);
  const prod = await (await r.get(`/api/v1/products/${p.id}`)).json();
  expect(prod.variants[0].onHand).toBe(1);
  await page.goto('/app/vendas');
  await expect(page.getByText('Nenhuma venda registrada ainda')).toBeVisible(); // saiu das ativas
  await page.getByRole('tab', { name: 'Canceladas e devoluções' }).click();
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /#1/ }).getByRole('cell').nth(7)).toHaveText('R$ 0,00'); // resultado estornado
  await page.screenshot({ path: '../test-results/vendas-canceladas.png' });
  await ctx.close();
});

test('excluir venda de teste pela tela', async ({ browser }) => {
  const run2 = `${run}x`;
  const ctx = await browser.newContext({ baseURL: H.origin, viewport: { width: 1400, height: 900 } });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Exclui', email: `exclui-${run2}@example.test`, password: 'senha-exclui-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'Loja Exclui' }, false);
  const p = await post(r, 'products/with-stock', { product: { name: 'Pufe Teste', variants: [{ sku: `EXC-${run2}`, retailPriceCents: '13000' }] }, stock: { entries: [{ variantIndex: 0, quantity: 1, unitCostCents: '7000' }], source: { mode: 'opening' } } });
  const variantId = (await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].id;
  const sale = await post(r, 'sales', { items: [{ variantId, quantity: 1, unitPriceCents: '13000' }], payments: [{ kind: 'pix', amountCents: '13000' }] });
  const saldo = async () => ((await (await r.get('/api/v1/finance/accounts')).json()) as { balanceCents: string }[]).reduce((a, x) => a + BigInt(x.balanceCents), 0n);
  const comVenda = await saldo();

  const page = await ctx.newPage();
  await page.goto(`/app/vendas/${sale.saleId}`);
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: 'Excluir venda' })).toBeDisabled();
  await modal.getByLabel('Motivo').fill('Venda de teste');
  await page.screenshot({ path: '../test-results/excluir-venda.png' });
  await modal.getByRole('button', { name: 'Excluir venda' }).click();
  await expect(page).toHaveURL(/\/app\/vendas$/);
  await expect(page.getByText('Venda excluída.')).toBeVisible();
  await expect(page.getByText('Nenhuma venda registrada ainda')).toBeVisible();
  expect(await saldo()).toBe(comVenda - 13000n);
  expect((await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].onHand).toBe(1);
  await page.getByRole('tab', { name: 'Canceladas e devoluções' }).click();
  await expect(page.getByText('Nenhuma venda registrada ainda')).toBeVisible();
  await page.getByRole('tab', { name: 'Excluídas' }).click();
  await expect(page.getByText('Excluída', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '#1' }).click();
  await expect(page.getByText(/Venda excluída em/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);
  await ctx.close();
});
