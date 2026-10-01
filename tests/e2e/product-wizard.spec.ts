import { expect, test, type Page } from '@playwright/test';

/** Cadastro de produto em etapas, com estoque inicial pago agora e fornecedor novo; tudo numa ação. */
const run = Date.now().toString(36);
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

async function money(page: Page, label: string | RegExp, value: string) {
  const input = page.getByRole('textbox', { name: label }).first();
  await input.fill(value);
  await input.blur();
}

/** PNG 1×1 válido (foto de teste). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('novo produto em etapas com estoque, custo e fornecedor', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: H.origin, viewport: { width: 1280, height: 900 } });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Cadastro', email: `cadastro-${run}@example.test`, password: 'senha-cadastro-123' }, headers: H })).ok()).toBeTruthy();
  expect((await r.post('/api/v1/tenants', { data: { name: 'Loja Cadastro' }, headers: H })).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/app/produtos/novo');

  // 1. Geral
  await page.getByLabel('Nome do produto').fill('Poltrona Inflável com Pufe');
  await page.getByLabel('Marca').fill('Compra Teca');
  await page.getByLabel('Fotos do produto').setInputFiles({ name: 'poltrona.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByAltText('Foto 1')).toBeVisible();
  await page.screenshot({ path: '../test-results/novo-produto-1-geral.png' });
  await page.getByRole('button', { name: 'Próximo' }).click();
  // 2. Preço: custo 30 + margem 50% → 60
  await money(page, 'Preço de custo (por unidade)', '30');
  await page.getByLabel('Margem desejada (%)').fill('50');
  await expect(page.getByRole('textbox', { name: 'Preço de venda (varejo)' })).toHaveValue('60,00');
  await expect(page.getByText('Margem estimada:')).toContainText('50%');
  await page.screenshot({ path: '../test-results/novo-produto-2-preco.png' });
  await page.getByRole('button', { name: 'Próximo' }).click();
  // 3. Estoque
  await page.getByLabel('Estoque atual (quantidade)').fill('10');
  await page.getByLabel('Alerta de estoque baixo').check();
  await page.getByRole('button', { name: 'Gerar' }).click();
  await expect(page.getByLabel('SKU (código interno)')).toHaveValue(/^POL-INF-\d{4}$/);
  await page.screenshot({ path: '../test-results/novo-produto-3-estoque.png' });
  // 5. Origem: sem fornecedor não deixa cadastrar e leva para a etapa certa.
  await page.getByRole('tab', { name: /Origem do estoque/ }).click();
  await expect(page.getByText('Entrada de 10 unidade(s)')).toBeVisible();
  await page.getByRole('button', { name: /Cadastrar com 10 em estoque/ }).click();
  await expect(page.getByText('Escolha ou digite o fornecedor.')).toBeVisible();
  await page.getByLabel('Ou digite um fornecedor novo').fill('Distribuidora Nova Fortaleza');
  await page.screenshot({ path: '../test-results/novo-produto-5-origem.png' });
  await page.getByRole('button', { name: /Cadastrar com 10 em estoque/ }).click();

  await expect(page.getByRole('heading', { name: 'Poltrona Inflável com Pufe' })).toBeVisible();
  await expect(page.getByText('Produto cadastrado.')).toBeVisible();
  const id = page.url().split('/').pop()!;
  const prod = await (await r.get(`/api/v1/products/${id}`)).json();
  expect(prod.variants[0]).toMatchObject({ onHand: 10, retailPriceCents: '6000', minStock: 2 });
  expect(prod.images).toHaveLength(1);
  const compras = await (await r.get('/api/v1/purchases')).json();
  expect(compras.data).toHaveLength(1);
  const fluxo = await (await r.get('/api/v1/finance/cash-flow')).json();
  expect(fluxo.summary.outCents).toBe('30000');
  await ctx.close();
});
