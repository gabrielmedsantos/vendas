import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import { addProductImage, getTenantProfile, listFlyerProducts, readAttachment, removeBrandLogo, setBrandLogo, setProductStatus, updateTenantProfile, type Actor } from '@gct/app';
import { addMember, closeDeps, createTenant, makeParty, makeProduct, stockUp, testDeps, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let comEstoque: { productId: string; variantId: string };

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Encarte');
  actor = T.owner;
  const supplier = await makeParty(deps, actor, 'Fornecedor Encarte', { supplier: true, customer: false });
  comEstoque = await makeProduct(deps, actor, { name: 'Fone Encarte', priceCents: 2999n });
  const semEstoque = await makeProduct(deps, actor, { name: 'Caixa Sem Estoque' });
  const inativo = await makeProduct(deps, actor, { name: 'Relógio Inativo' });
  await stockUp(deps, actor, supplier, [{ variantId: comEstoque.variantId, quantity: 3, unitCostCents: 1500n }, { variantId: inativo.variantId, quantity: 1, unitCostCents: 500n }]);
  await setProductStatus(deps, actor, inativo.productId, 'inactive');
  void semEstoque;
  const img = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#1d3fbf' } }).png().toBuffer();
  await addProductImage(deps, actor, comEstoque.productId, img, 'fone.png');
});
afterAll(closeDeps);

describe('encarte digital', () => {
  it('lista só produtos ativos com saldo disponível, com foto e sem custo', async () => {
    const rows = await listFlyerProducts(deps, actor);
    expect(rows.map((r) => r.name)).toEqual(['Fone Encarte']);
    expect(rows[0]).toMatchObject({ retail_price_cents: 2999n, available: 3 });
    expect(rows[0]!.image_id).toBeTruthy();
    expect(Object.keys(rows[0]!).some((k) => k.includes('cost'))).toBe(false);
  });

  it('exige permissão de catálogo; outra empresa não vê os produtos', async () => {
    const seller = await addMember(deps, T.tenantId, 'seller');
    await expect(listFlyerProducts(deps, seller)).rejects.toMatchObject({ code: 'forbidden' });
    const other = await createTenant(deps, 'Outra Loja Encarte');
    expect(await listFlyerProducts(deps, other.owner)).toEqual([]);
  });

  it('logo: envia, troca (apaga a anterior), remove; cores e textos salvos por empresa', async () => {
    const png = (c: string) => sharp({ create: { width: 40, height: 20, channels: 4, background: c } }).png().toBuffer();
    const a = await setBrandLogo(deps, actor, await png('#ff0000'), 'logo.png');
    const b = await setBrandLogo(deps, actor, await png('#00ff00'), 'logo2.png');
    const t = await getTenantProfile(deps, actor);
    expect((t.settings as { brandLogoId?: string }).brandLogoId).toBe(b.id);
    await expect(readAttachment(deps, actor, a.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await readAttachment(deps, actor, b.id)).mime).toBe('image/webp');
    const other = await createTenant(deps, 'Loja Vizinha Encarte');
    await expect(readAttachment(deps, other.owner, b.id)).rejects.toMatchObject({ code: 'not_found' });

    await updateTenantProfile(deps, actor, { settings: { brandColors: { primary: '#123456', secondary: '#e3262f', accent: '#ffd400' }, flyer: { title: 'Mega Saldão', subtitle: 'x', footer: 'y', validity: '', cardSurchargeBps: 1114, cardInstallments: 12 } } });
    const t2 = await getTenantProfile(deps, actor);
    expect(t2.settings).toMatchObject({ brandLogoId: b.id, brandColors: { primary: '#123456' }, flyer: { title: 'Mega Saldão', cardSurchargeBps: 1114 } });
    expect(t2.email).toBe(t.email);

    await removeBrandLogo(deps, actor);
    const t3 = await getTenantProfile(deps, actor);
    expect((t3.settings as { brandLogoId?: string }).brandLogoId).toBeUndefined();
    const n = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('attachments').select('id').where('owner_type', '=', 'brand_logo').execute());
    expect(n).toHaveLength(0);
  });

  it('só quem gerencia a empresa troca a logo; imagem inválida é recusada', async () => {
    const seller = await addMember(deps, T.tenantId, 'seller');
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    await expect(setBrandLogo(deps, seller, png, 'x.png')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setBrandLogo(deps, actor, Buffer.from('não é imagem'), 'x.png')).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
