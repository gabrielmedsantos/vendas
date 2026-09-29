import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';

/**
 * Jornada principal (doc 09): cadastro → compra → recebimento → venda →
 * troca → receber diferença → devolução parcial → relatório.
 * Dados sintéticos; nenhum IMEI real.
 */
const run = Date.now().toString(36);
const email = `e2e-${run}@example.test`;
const password = 'senha-e2e-segura-1';

async function money(page: Page, label: string | RegExp, value: string) {
  const input = page.getByRole('textbox', { name: label }).first();
  await input.fill(value);
  await input.blur();
}

async function pickProduct(page: Page, term: string, text: RegExp, nth = 0) {
  const search = page.getByLabel('Buscar produto').nth(nth);
  await search.click();
  await search.pressSequentially(term, { delay: 20 });
  await page.getByRole('button', { name: text }).first().click();
}

async function pickParty(page: Page, label: string, name: string) {
  await page.getByLabel(label, { exact: true }).fill(name.slice(0, 6));
  await page.getByRole('button', { name: new RegExp(name) }).first().click();
}

test.describe.serial('jornada completa', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test('cadastro e empresa', async () => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome completo').fill('Pessoa E2E');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByLabel('Confirme a senha').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.waitForURL('**/app/empresas');
    await page.getByRole('textbox', { name: 'Nome fantasia' }).fill(`Loja E2E ${run}`);
    await page.getByRole('button', { name: 'Criar empresa' }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  });

  test('produtos', async () => {
    for (const p of [
      { name: 'Celular Demo', sku: `CEL-${run}`, price: '4000', serial: true },
      { name: 'Capa Demo', sku: `CAPA-${run}`, price: '50', serial: false },
    ]) {
      await page.goto('/app/produtos/novo');
      if (p.serial) await page.getByLabel('Controle de estoque').selectOption('serialized');
      await page.getByRole('textbox', { name: 'Nome', exact: true }).fill(p.name);
      await page.getByRole('textbox', { name: 'SKU', exact: true }).fill(p.sku);
      await money(page, 'Preço de varejo', p.price);
      await page.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(page.getByRole('heading', { name: p.name })).toBeVisible();
    }
  });

  test('compra com recebimento e IMEI', async () => {
    await page.goto('/app/compras/nova');
    await page.getByRole('button', { name: 'Cadastrar fornecedor' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Nome', exact: true }).fill('Distribuidora Demo');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await pickProduct(page, 'Celular', /Celular Demo/);
    await page.getByLabel('IMEI', { exact: true }).fill(`DEMO-IMEI-${run}-OUT`);
    await money(page, /Custo unitário acordado/, '3000');
    await pickProduct(page, 'Capa', /Capa Demo/);
    const qtys = page.getByLabel('Quantidade');
    await qtys.nth(1).fill('10');
    await page.getByLabel(/Custo unitário acordado/).nth(1).fill('20');
    await page.getByLabel(/Custo unitário acordado/).nth(1).blur();
    await page.getByRole('button', { name: 'Confirmar compra e receber tudo' }).click();
    await expect(page.getByRole('heading', { name: /Compra #/ })).toBeVisible();
    await expect(page.getByText('Recebida').first()).toBeVisible();
    // Lista de compras mostra o 1º item (com miniatura) e quantos itens a mais.
    await page.goto('/app/compras');
    const linha = page.getByRole('row').filter({ hasText: 'Distribuidora Demo' }).first();
    await expect(linha.getByText(/Celular Demo/)).toBeVisible();
    await expect(linha.getByText('+1 item')).toBeVisible();
  });

  test('gerar anúncio do produto', async () => {
    await page.goto('/app/produtos');
    await page.getByRole('link', { name: /Celular Demo/ }).first().click();
    await page.getByRole('button', { name: 'Anunciar' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByLabel('Título', { exact: true })).toHaveValue(/Novo com garantia de 3 meses/);
    await expect(modal.getByLabel('Descrição curta')).toHaveValue(/Cartão em até 12x/);
    await expect(modal.getByLabel('Descrição completa')).toHaveValue(/3 meses de garantia da loja\./);
    await modal.getByLabel('O produto é novo ou seminovo?').selectOption('semi_new');
    await modal.getByLabel('Estado do seminovo').fill('bateria 90%');
    await expect(modal.getByLabel('Descrição curta')).toHaveValue(/Seminovo: bateria 90%/);
    await modal.getByLabel('Entrega').fill('Entregamos em toda Fortaleza e região');
    await modal.getByRole('button', { name: 'Salvar estas opções como padrão' }).click();
    await expect(page.getByText('Padrão de anúncio salvo para a empresa.')).toBeVisible();
    await modal.getByLabel('Descrição curta').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../test-results/anuncio.png' });
    await modal.getByRole('button', { name: 'Fechar' }).first().click();
    await page.getByRole('button', { name: 'Anunciar' }).click();
    await expect(page.getByRole('dialog').getByLabel('Descrição curta')).toHaveValue(/Entregamos em toda Fortaleza e região/);
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
  });

  test('encarte digital com logo e cores da marca', async () => {
    await page.goto('/app/catalogo');
    await page.getByRole('tab', { name: 'Encarte digital' }).or(page.getByRole('button', { name: 'Encarte digital' })).first().click();
    await expect(page.getByTestId('flyer-preview')).toBeVisible();
    // Logo com azul, amarelo e vermelho → cores do encarte tiradas da logo.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#1e3a8a"/><circle cx="70" cy="60" r="45" fill="#facc15"/><rect x="140" y="30" width="130" height="60" rx="12" fill="#dc2626"/></svg>`;
    const logo = await sharp(Buffer.from(svg)).png().toBuffer();
    await page.locator('#logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
    await expect(page.getByText('Cores tiradas da logo. Ajuste se quiser.')).toBeVisible();
    await expect(page.getByLabel('Cor do título (hex)')).toHaveValue(/^#f[89a-f]c[b-d]1[0-9a-f]$/);
    await page.getByLabel('Título', { exact: true }).fill('Mega Saldão');
    await page.getByLabel('Acréscimo no cartão (%)').fill('11,14');
    await page.getByLabel('Validade das ofertas').fill('Ofertas válidas até 31/10');
    await page.getByRole('button', { name: 'Salvar identidade e textos' }).click();
    await expect(page.getByText('Identidade visual e textos salvos.')).toBeVisible();
    await expect(page.getByTestId('flyer-preview')).toContainText('Celular Demo');
    await expect(page.getByTestId('flyer-preview')).toContainText('no cartão');
    await page.getByTestId('flyer-preview').screenshot({ path: '../test-results/encarte-previa.png' });
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    expect(pdf.suggestedFilename()).toBe('mega-saldao.pdf');
    await pdf.saveAs('../test-results/encarte.pdf');
    await expect(page.getByText('PDF do encarte baixado.')).toBeVisible();
  });

  test('venda simples com Pix', async () => {
    await page.goto('/app/vendas/nova');
    await pickProduct(page, 'Capa', /Capa Demo/);
    await page.getByRole('button', { name: 'Aumentar' }).click();
    await page.getByLabel('Forma 1').selectOption({ label: 'Pix' });
    await page.getByRole('button', { name: 'Revisar e confirmar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page.getByRole('heading', { name: /Venda #/ })).toBeVisible();
    await expect(page.getByText('R$ 100,00').first()).toBeVisible();
    // Contrato de venda: gera, cria link e o cliente abre sem login.
    await page.getByRole('button', { name: 'Gerar contrato de venda' }).click();
    const contrato = page.getByRole('listitem').filter({ hasText: 'Contrato de venda' });
    await contrato.getByRole('button', { name: 'Enviar ao cliente' }).click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Gerar link para o cliente' }).click();
    const link = await page.getByLabel('Link do documento').inputValue();
    expect(link).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole('link', { name: /Enviar pelo WhatsApp/ })).toHaveAttribute('href', /wa\.me/);
    await page.screenshot({ path: '../test-results/enviar-contrato.png' });
    const anon = await page.context().browser()!.newContext();
    const res = await anon.request.get(new URL(link).pathname, { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect((await anon.request.get('/d/' + 'x'.repeat(43), { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' })).status()).toBe(404);
    await anon.close();
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
  });

  test('troca: cliente entrega usado e paga a diferença', async () => {
    await page.goto('/app/trocas/nova');
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Nome', exact: true }).fill('Cliente Demonstração');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await pickProduct(page, 'Celular', /Celular Demo/);
    await page.getByLabel('Unidade').selectOption({ index: 1 });
    await page.getByLabel('Nome do produto recebido').fill('Celular usado Demo');
    await page.getByLabel('IMEI 1').fill(`DEMO-IMEI-${run}-IN`);
    await money(page, 'Valor acordado (avaliação)', '1500');
    await expect(page.getByText('Cliente paga à empresa').first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Diferença' })).toContainText('R$ 2.500,00');
    await page.getByLabel('Forma 1').selectOption({ label: 'Pix' });
    await expect(page.getByText('Resultado bruto da venda')).toBeVisible();
    await page.getByRole('button', { name: 'Revisar troca' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar troca' }).click();
    await expect(page.getByRole('heading', { name: /Troca #/ })).toBeVisible();
    await expect(page.getByText('R$ 1.500,00').first()).toBeVisible();
    await expect(page.getByText('Recebido · Pix')).toBeVisible();
  });

  test('venda no crediário, recebimento parcial e devolução parcial', async () => {
    await page.goto('/app/vendas/nova');
    await pickProduct(page, 'Capa', /Capa Demo/);
    await page.getByRole('spinbutton', { name: 'Quantidade' }).first().fill('3');
    await pickParty(page, 'Cliente', 'Cliente Demonstração');
    await page.getByLabel('Forma 1').selectOption({ label: 'Crediário / fiado' });
    await page.getByRole('button', { name: 'Revisar e confirmar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page.getByRole('heading', { name: /Venda #/ })).toBeVisible();
    const saleUrl = page.url();

    await page.goto('/app/financeiro/receber');
    await page.getByRole('checkbox', { name: /Venda #/ }).first().check();
    await page.getByRole('button', { name: 'Receber selecionados' }).click();
    await page.getByLabel(/Venda #.*saldo/).fill('40');
    await page.getByLabel(/Venda #.*saldo/).blur();
    await page.getByRole('checkbox', { name: /Confirmo que o valor/ }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByText('Parcial').first()).toBeVisible();

    await page.goto(saleUrl);
    await page.getByRole('button', { name: 'Devolução' }).click();
    await page.getByLabel(/Capa Demo \(devolvível 3\)/).fill('1');
    await page.getByRole('textbox', { name: 'Motivo' }).fill('Defeito de costura');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar devolução' }).click();
    await expect(page.getByText(/Devolução nº/)).toBeVisible();
  });

  test('relatório de resultado', async () => {
    await page.goto('/app/relatorios');
    await expect(page.getByRole('cell', { name: '= Receita líquida' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '= Resultado bruto' })).toBeVisible();
  });

  test('ordem de serviço: criar, andar e entregar', async () => {
    await page.goto('/app/servicos');
    await page.getByRole('button', { name: 'Nova ordem' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Serviço' }).fill('Troca de bateria E2E');
    await money(page, 'Valor combinado', '120');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('cell', { name: 'Troca de bateria E2E' }).click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('button', { name: 'Iniciar' }).click();
    await detail.getByRole('button', { name: 'Marcar pronta' }).click();
    await detail.getByRole('button', { name: 'Entregar ao cliente' }).click();
    await expect(detail.getByText('Entregue', { exact: true })).toBeVisible();
    await expect(detail.getByText(/Pronta → Entregue/)).toBeVisible();
  });

  test('central de ajuda', async () => {
    await page.goto('/app/ajuda');
    await page.getByRole('textbox', { name: 'Buscar na ajuda' }).fill('compensação');
    await page.getByRole('link', { name: /Entendendo a troca/ }).click();
    await expect(page.getByRole('heading', { name: 'Entendendo a troca com diferença' })).toBeVisible();
    await expect(page.getByText(/cliente paga R\$ 500/)).toBeVisible();
  });
});
