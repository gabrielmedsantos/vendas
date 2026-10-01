import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';

/** Recibo da venda: dados do cliente editáveis, prévia ao vivo, valor por extenso e PDF (A4 e bobina). */
const run = Date.now().toString(36);
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };
async function post(r: APIRequestContext, path: string, data: unknown, key = true) {
  const res = await r.post(`/api/v1/${path}`, { data, headers: { ...H, ...(key ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

test('recibo da venda', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: H.origin, viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Recibo', email: `recibo-${run}@example.test`, password: 'senha-recibo-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'TechFlash Exemplo' }, false);
  const cli = await post(r, 'parties', { name: 'Maria Cliente', isCustomer: true, phone: '85999990000', address: { street: 'Rua das Flores', number: '12', district: 'Centro' }, city: 'Fortaleza', state: 'CE' }, false);
  const p = await post(r, 'products/with-stock', {
    product: { name: 'Poltrona Inflável com Pufe', warrantyDays: 90, variants: [{ sku: `REC-${run}`, retailPriceCents: '6000' }] },
    stock: { entries: [{ variantIndex: 0, quantity: 3, unitCostCents: '3000' }], source: { mode: 'opening' } },
  });
  const v = (await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].id;
  const sale = await post(r, 'sales', { customerId: cli.id, items: [{ variantId: v, quantity: 2, unitPriceCents: '6000' }], payments: [{ kind: 'pix', amountCents: '3000' }, { kind: 'credit', amountCents: '9000', installments: 3 }] });

  const page = await ctx.newPage();
  await page.goto(`/app/vendas/${sale.saleId}`);
  await page.getByRole('button', { name: 'Recibo' }).click();
  const modal = page.getByRole('dialog');
  const preview = modal.getByLabel('Prévia do recibo');
  await expect(modal.getByLabel('Nome do cliente')).toHaveValue('Maria Cliente');
  await expect(modal.getByLabel('Endereço')).toHaveValue(/Rua das Flores, 12/);
  await expect(preview).toContainText('RECIBO DE VENDA');
  await expect(preview).toContainText('cento e vinte reais');
  await expect(preview).toContainText('3x de R$ 30,00');
  await expect(preview).toContainText('Garantia: 90 dias');
  await expect(preview).toContainText('(85) 99999-0000');
  // Editar na hora: aparece na prévia.
  await modal.getByLabel('CPF/CNPJ').fill('123.456.789-09');
  await modal.getByLabel('Observações').fill('Entrega combinada para sábado.');
  await expect(preview).toContainText('123.456.789-09');
  await expect(preview).toContainText('Entrega combinada para sábado.');
  await page.screenshot({ path: '../test-results/recibo-a4.png' });
  const [pdf] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: 'Baixar PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe('recibo-000001.pdf');
  const bytes = readFileSync(await pdf.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  // Bobina 80 mm.
  await modal.getByRole('radio', { name: 'Bobina 80 mm' }).click();
  await expect(preview).toContainText('Maria Cliente');
  await page.screenshot({ path: '../test-results/recibo-bobina.png' });
  const [pdf2] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: 'Baixar PDF' }).click()]);
  expect(readFileSync(await pdf2.path()).subarray(0, 5).toString()).toBe('%PDF-');
  await ctx.close();
});
