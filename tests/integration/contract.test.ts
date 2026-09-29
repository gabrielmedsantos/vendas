import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import {
  confirmSale, processOutboxBatch, readDocumentPdf, readSharedDocument, requestDocumentAction, shareDocument, updateProduct, getProduct, zProduct, zSale, type Actor,
} from '@gct/app';
import { closeDeps, createTenant, makeParty, makeProduct, stockUp, testDeps, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let saleId: string;

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Contrato');
  actor = T.owner;
  const supplier = await makeParty(deps, actor, 'Fornecedor Contrato', { supplier: true, customer: false });
  const customer = await makeParty(deps, actor, 'Maria Cliente Demo');
  const p = await makeProduct(deps, actor, { name: 'Celular Contrato 128 GB', tracking: 'serialized', priceCents: 150000n });
  const cur = await getProduct(deps, actor, p.productId);
  await updateProduct(deps, actor, p.productId, { ...zProduct.parse({ name: cur.name, tracking: 'serialized', identifierKinds: ['imei1'], warrantyDays: 90, variants: [{ id: cur.variants[0]!.id, sku: cur.variants[0]!.sku, retailPriceCents: '150000' }] }), version: cur.version });
  const r = await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 90000n, units: [{ identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-CONTRATO-1' }], condition: 'used' }] }]);
  const s = await confirmSale(deps, actor, zSale.parse({ customerId: customer, items: [{ variantId: p.variantId, unitId: r.unitIds[0], quantity: 1, unitPriceCents: '150000' }], payments: [{ kind: 'pix', amountCents: '150000' }] }), randomUUID());
  saleId = s.saleId;
});
afterAll(closeDeps);

describe('contrato de venda', () => {
  it('gera o contrato da venda confirmada com cliente, IMEI, condição, garantia e sem custo', async () => {
    const { id } = await requestDocumentAction(deps, actor, 'sale_contract', 'sale', saleId);
    const again = await requestDocumentAction(deps, actor, 'sale_contract', 'sale', saleId);
    expect(again.id).toBe(id);
    await processOutboxBatch(deps, 100, actor.tenantId);
    const doc = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('documents').select(['status', 'snapshot']).where('id', '=', id).executeTakeFirstOrThrow());
    expect(doc.status).toBe('ready');
    const snap = JSON.stringify(doc.snapshot);
    expect(snap).toContain('Maria Cliente Demo');
    expect(snap).toContain('DEMO-IMEI-CONTRATO-1');
    expect(snap).toContain('"condition":"used"');
    expect(snap).toContain('não cobre mau uso');
    expect(snap).not.toMatch(/cost/i);
    const pdf = await readDocumentPdf(deps, actor, id);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.SALVAR_PDF) writeFileSync(process.env.SALVAR_PDF, pdf.data);
  });

  it('link para o cliente abre só este documento, sem login; token inválido ou de outra empresa não abre', async () => {
    const { id } = await requestDocumentAction(deps, actor, 'sale_contract', 'sale', saleId);
    const { token, expiresAt } = await shareDocument(deps, actor, id);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const f = await readSharedDocument(deps, token);
    expect(f.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(f.filename).toContain('Contrato de venda');
    await expect(readSharedDocument(deps, 'x'.repeat(43))).rejects.toMatchObject({ code: 'not_found' });
    await expect(readSharedDocument(deps, '../../etc')).rejects.toMatchObject({ code: 'not_found' });
    // No banco fica só o hash do token.
    const rows = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('document_shares').select(['token_hash']).execute());
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    // Link vencido deixa de abrir.
    await withTenant(deps.dbs.app, actor, (trx) => trx.updateTable('document_shares').set({ expires_at: new Date(Date.now() - 1000) }).execute());
    await expect(readSharedDocument(deps, token)).rejects.toMatchObject({ code: 'not_found' });
    // Outra empresa não gera link para documento que não é dela.
    const other = await createTenant(deps, 'Outra Loja Contrato');
    await expect(shareDocument(deps, other.owner, id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('venda em rascunho ou inexistente não gera contrato', async () => {
    await expect(requestDocumentAction(deps, actor, 'sale_contract', 'sale', randomUUID())).rejects.toMatchObject({ code: 'not_found' });
  });
});
