import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { withTenant } from '@gct/db';
import {
  addProductImage, createPublicOrder, getCatalogAdmin, getPublicCatalog, listPublicOrders, readPublicImage, reservePublicOrder, saveCatalog, setCatalogItems, setCatalogPublished,
  zCatalog, type Actor,
} from '@gct/app';
import { closeDeps, createTenant, makeParty, makeProduct, stockUp, testDeps, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let phone: { productId: string; variantId: string };
let hidden: { productId: string; variantId: string };
let imageId: string;
const slug = `loja-demo-${randomUUID().slice(0, 6)}`;

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Catálogo');
  actor = T.owner;
  const sup = await makeParty(deps, actor, 'Fornecedor Catálogo', { supplier: true, customer: false });
  phone = await makeProduct(deps, actor, { name: 'Celular Vitrine', tracking: 'serialized', priceCents: 199900n });
  hidden = await makeProduct(deps, actor, { name: 'Produto Oculto', priceCents: 1000n });
  await stockUp(deps, actor, sup, [{ variantId: phone.variantId, quantity: 1, unitCostCents: 123456n, units: [{ identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-VITRINE-999' }] }] }]);
  // Foto com EXIF (incluindo GPS) deve ser reprocessada sem metadados.
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#8a62ff' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'DADO-PRIVADO' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 0/1' } })
    .toBuffer();
  imageId = (await addProductImage(deps, actor, phone.productId, jpeg, 'foto.jpg')).id;
  await saveCatalog(deps, actor, zCatalog.parse({ slug, title: 'Vitrine Demo', acceptOrders: true }));
  await setCatalogItems(deps, actor, [phone.variantId]);
});
afterAll(closeDeps);

describe('catálogo público', () => {
  it('não publicado não é encontrado', async () => {
    await expect(getPublicCatalog(deps, slug)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('T-020: DTO público nunca contém custo, IMEI ou dados privados', async () => {
    await setCatalogPublished(deps, actor, true);
    const dto = await getPublicCatalog(deps, slug);
    expect(dto.items.map((i) => i.name)).toEqual(['Celular Vitrine']);
    const text = JSON.stringify(dto);
    expect(text).not.toContain('123456');
    expect(text).not.toContain('DEMO-IMEI');
    expect(text.toLowerCase()).not.toMatch(/cost|custo|imei|supplier|fornecedor|document/);
    expect(dto.items[0]!.priceCents).toBe('199900');
    expect(dto.items[0]!.imageIds).toEqual([imageId]);
  });

  it('imagem pública é servida sem metadados; imagem fora do catálogo não', async () => {
    const img = await readPublicImage(deps, slug, imageId);
    const meta = await sharp(img).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    await expect(readPublicImage(deps, slug, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('foto adicionada depois de publicar aparece no catálogo público na hora; produto fora do catálogo não', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#22c55e' } }).png().toBuffer();
    const nova = (await addProductImage(deps, actor, phone.productId, png, 'nova.png')).id;
    const cat = await getPublicCatalog(deps, slug);
    expect(cat.items.find((i) => i.variantId === phone.variantId)!.imageIds).toContain(nova);
    await expect(readPublicImage(deps, slug, nova)).resolves.toBeTruthy();
    const oculta = (await addProductImage(deps, actor, hidden.productId, png, 'oculta.png')).id;
    await expect(readPublicImage(deps, slug, oculta)).rejects.toMatchObject({ code: 'not_found' });
    const admin = await getCatalogAdmin(deps, actor);
    expect(admin.items.find((i) => i.variant_id === phone.variantId)!.image_id).toBe(imageId);
  });

  it('pedido público fica pendente, com preço congelado e sem reserva automática', async () => {
    const r = await createPublicOrder(deps, slug, { contactName: 'Visitante Demo', contactPhone: '11 99999-0000', items: [{ variantId: phone.variantId, quantity: 1 }] });
    expect(r.totalCents).toBe('199900');
    const orders = await listPublicOrders(deps, actor);
    expect(orders[0]!.status).toBe('pending');
    const bal = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select('reserved').where('variant_id', '=', phone.variantId).executeTakeFirstOrThrow());
    expect(bal.reserved).toBe(0);
    await reservePublicOrder(deps, actor, orders[0]!.id, 2);
    const bal2 = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select('reserved').where('variant_id', '=', phone.variantId).executeTakeFirstOrThrow());
    expect(bal2.reserved).toBe(1);
    // Item fora do catálogo não pode ser pedido.
    await expect(createPublicOrder(deps, slug, { contactName: 'Visitante', contactPhone: '11999990000', items: [{ variantId: hidden.variantId, quantity: 1 }] })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('despublicar retira o catálogo e as fotos do acesso público', async () => {
    await setCatalogPublished(deps, actor, false);
    await expect(getPublicCatalog(deps, slug)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readPublicImage(deps, slug, imageId)).rejects.toMatchObject({ code: 'not_found' });
    const att = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('attachments').select('is_public').where('id', '=', imageId).executeTakeFirstOrThrow());
    expect(att.is_public).toBe(false);
  });
});
