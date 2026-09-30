import sharp from 'sharp';
import { expect, test, type APIRequestContext } from '@playwright/test';

/** Encarte digital com muitos produtos com foto: capa + páginas 3×3; gera o PDF. Saída em test-results/. */
const run = Date.now().toString(36);
const H = { origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

async function post(r: APIRequestContext, path: string, data: unknown, key = true) {
  const res = await r.post(`/api/v1/${path}`, { data, headers: { ...H, ...(key ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Foto sintética parecida com foto de loja: produto pequeno no meio de um fundo branco/cinza (JPEG),
 * com margem grande. `complexo` = fundo com listras coloridas (não deve ser removido).
 */
function foto(cor: string, forma: 'circle' | 'rect', fundo: string, complexo = false) {
  const shape = forma === 'circle'
    ? `<circle cx="400" cy="400" r="150" fill="${cor}"/><circle cx="400" cy="400" r="60" fill="#ffffff"/>`
    : `<rect x="310" y="230" width="180" height="320" rx="30" fill="${cor}"/><rect x="330" y="260" width="140" height="240" rx="12" fill="#111827"/>`;
  const bg = complexo
    ? Array.from({ length: 16 }, (_, i) => `<rect x="${i * 50}" y="0" width="50" height="800" fill="hsl(${i * 23} 70% 55%)"/>`).join('')
    : `<rect width="800" height="800" fill="${fundo}"/>`;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">${bg}${shape}</svg>`)).jpeg({ quality: 85 }).toBuffer();
}

test('encarte com 17 produtos com foto', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', viewport: { width: 1600, height: 1000 } });
  const r = ctx.request;
  expect((await r.post('/api/auth/sign-up/email', { data: { name: 'Pessoa Encarte', email: `encarte-${run}@example.test`, password: 'senha-encarte-123' }, headers: H })).ok()).toBeTruthy();
  await post(r, 'tenants', { name: 'Loja Encarte Demo' }, false);
  const sup = await post(r, 'parties', { name: 'Fornecedor Demo', isCustomer: false, isSupplier: true }, false);
  const acc = (await (await r.get('/api/v1/finance/accounts')).json()) as { id: string; kind: string }[];
  const nomes = ['Fone Bluetooth TWS', 'Smartwatch D20', 'Caixa de Som 20W', 'Headphone Bluetooth', 'Carregador Turbo 20W', 'Power Bank 10.000mAh', 'Câmera Wi-Fi 1080p', 'Mouse Gamer RGB', 'Teclado Mecânico', 'Cabo USB-C 2m', 'Suporte Veicular', 'Ring Light 10"', 'Relógio Smart W9 Ultra', 'Fone Gamer', 'Balança Digital 10kg', 'Mochila Sport', 'Cortador de Cabelo'];
  const cores = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#6366f1'];
  const items: { variantId: string; quantity: number; unitCostCents: string }[] = [];
  for (const [i, nome] of nomes.entries()) {
    const p = await post(r, 'products', { name: nome, brand: i % 3 === 0 ? 'Marca Demo' : undefined, description: i === 0 ? 'Bluetooth 5.3\nCase com LED\nAté 20 h de bateria' : undefined, variants: [{ sku: `ENC-${run}-${i}`, retailPriceCents: String(1999 + i * 2500) }] }, false);
    const res = await r.post(`/api/v1/products/${p.id}/images`, { headers: H, multipart: { file: { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await foto(cores[i % cores.length]!, i % 2 ? 'rect' : 'circle', i % 4 === 3 ? '#f2f2f2' : '#ffffff', i === 6) } } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const v = (await (await r.get(`/api/v1/products/${p.id}`)).json()).variants[0].id;
    items.push({ variantId: v, quantity: 3, unitCostCents: '1000' });
  }
  await post(r, 'purchases/quick', { supplierId: sup.id, purchaseDate: new Date().toISOString().slice(0, 10), items, paymentTerms: { mode: 'pay_now', accountId: acc.find((a) => a.kind === 'bank')!.id, method: 'pix' } });

  const page = await ctx.newPage();
  await page.goto('/app/catalogo');
  await page.getByRole('tab', { name: 'Encarte digital' }).click();
  const preview = page.getByTestId('flyer-preview');
  await expect(preview).toContainText('Fone Bluetooth TWS');
  await expect(page.getByText('Página 3 de 3')).toBeVisible();
  // Ordem dos produtos: ordenar, mover com a seta e continuar igual depois de recarregar.
  const lista = page.getByRole('list', { name: 'Ordem dos produtos no encarte' });
  await page.getByLabel('Ordenar por').selectOption('priceDesc');
  await expect(lista.getByRole('listitem').first()).toContainText('Cortador de Cabelo');
  await page.getByLabel('Subir Mochila Sport').click();
  await expect(lista.getByRole('listitem').nth(0)).toContainText('Mochila Sport');
  await expect(page.getByText('Ordem salva')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Encarte digital' }).click();
  await expect(lista.getByRole('listitem').nth(0)).toContainText('Mochila Sport');
  await expect(lista.getByRole('listitem').nth(1)).toContainText('Cortador de Cabelo');
  await expect(preview).toContainText('Mochila Sport');
  await lista.screenshot({ path: '../test-results/ordem.png' });
  await page.getByLabel('Destacar Relógio Smart W9 Ultra').click();
  await page.getByLabel('Título', { exact: true }).fill('Mega Saldão');
  await page.getByLabel('Validade das ofertas').fill('Ofertas válidas de 01/10 a 31/10');
  await page.getByLabel('Acréscimo no cartão (%)').fill('11,14');
  await expect(preview).toContainText('no cartão');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  await pdf.saveAs('../test-results/encarte-completo.pdf');
  await page.screenshot({ path: '../test-results/encarte-layout.png', fullPage: false });
  await expect(page.getByText('PDF do encarte baixado.')).toBeVisible();
  // Vídeo 9:16 animado: prévia tocando e MP4 gerado no navegador.
  await page.getByRole('tab', { name: 'Vídeo 9:16' }).click();
  await page.screenshot({ path: '../test-results/encarte-video-layout.png', fullPage: true });
  await expect(page.getByTestId('video-preview')).toBeVisible();
  // Narração com voz padrão: ouvir antes e gerar o vídeo com áudio.
  await page.getByLabel('Texto falado').fill('Compre na TechFlash Fortal os mais baratos, com 3 meses de garantia, parcelado em até 12 vezes no cartão.');
  const narr = page.waitForResponse((r) => r.url().includes('/api/v1/flyer/narration'));
  await page.getByRole('button', { name: 'Ouvir' }).click();
  expect((await narr).status()).toBe(200);
  await page.getByRole('button', { name: 'Gerar vídeo' }).click();
  await expect(page.getByText('Vídeo pronto.')).toBeVisible({ timeout: 180_000 });
  const [mp4] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Baixar MP4' }).click()]);
  expect(mp4.suggestedFilename()).toBe('mega-saldao.mp4');
  await mp4.saveAs('../test-results/encarte.mp4');
  await ctx.close();
});
