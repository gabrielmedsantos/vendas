import { expect, test } from '@playwright/test';

/** Convite por link: dono gera o link; outra pessoa cria conta a partir dele e entra na empresa. */
const run = Date.now().toString(36);
const senha = 'senha-e2e-segura-1';

test('convite por link, sem e-mail', async ({ browser }) => {
  const dono = await browser.newPage();
  await dono.goto('/cadastro');
  await dono.getByLabel('Nome completo').fill('Dono Convite');
  await dono.getByLabel('E-mail').fill(`dono-${run}@example.test`);
  await dono.getByLabel('Senha', { exact: true }).fill(senha);
  await dono.getByLabel('Confirme a senha').fill(senha);
  await dono.getByRole('checkbox').check();
  await dono.getByRole('button', { name: 'Criar conta' }).click();
  await dono.waitForURL('**/app/empresas');
  await dono.getByRole('textbox', { name: 'Nome fantasia' }).fill(`Loja Convite ${run}`);
  await dono.getByRole('button', { name: 'Criar empresa' }).click();
  await dono.waitForURL(/\/app$/);

  await dono.goto('/app/configuracoes/equipe');
  await dono.getByRole('button', { name: 'Convidar' }).click();
  const modal = dono.getByRole('dialog');
  await expect(modal.getByRole('tab', { name: 'Por link' }).or(modal.getByRole('button', { name: 'Por link' })).first()).toBeVisible();
  await modal.getByLabel('Para quem é (opcional)').fill('Vendedor por link');
  await modal.getByRole('button', { name: 'Gerar convite' }).click();
  const link = await modal.getByLabel('Link do convite').inputValue();
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{20,}$/);
  await expect(modal.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute('href', /wa\.me/);
  await modal.getByRole('button', { name: 'Concluir' }).click();
  await expect(dono.getByText(/Vendedor por link/)).toBeVisible();

  // Outra pessoa, sem conta, abre o link.
  const ctx = await browser.newContext();
  const nova = await ctx.newPage();
  await nova.goto(new URL(link).pathname);
  await nova.getByRole('link', { name: 'Criar conta' }).click();
  await nova.getByLabel('Nome completo').fill('Vendedora Convidada');
  await nova.getByLabel('E-mail').fill(`vendedora-${run}@example.test`);
  await nova.getByLabel('Senha', { exact: true }).fill(senha);
  await nova.getByLabel('Confirme a senha').fill(senha);
  await nova.getByRole('checkbox').check();
  await nova.getByRole('button', { name: 'Criar conta' }).click();
  await nova.waitForURL(/\/convite\//);
  await nova.getByRole('button', { name: 'Aceitar convite' }).click();
  await nova.waitForURL(/\/app$/);
  await expect(nova.getByText(`Loja Convite ${run}`).first()).toBeVisible();
  await expect(nova.getByText('Vendedor').first()).toBeVisible();

  // O mesmo link não serve de novo (tentativa com outra conta logada).
  await dono.goto(new URL(link).pathname);
  await dono.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(dono.getByText('Convite inválido ou expirado.')).toBeVisible();
});
