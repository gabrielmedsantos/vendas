import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError, conflict, invalid, notFound } from '@gct/shared';
import { audit, can, requirePermission, requireWritable, tx, type Actor, type AppDeps } from './core';
import { checkLimit } from './billing';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;

/**
 * Valida o formato real (não a extensão), limita dimensões e reprocessa para
 * WebP sem metadados (EXIF/GPS removidos). Nunca executa nem busca URLs.
 */
export async function processImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (input.length === 0 || input.length > MAX_IMAGE_BYTES) throw invalid('Imagem deve ter até 5 MB.');
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw invalid('Arquivo não é uma imagem válida.');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw invalid('Formatos aceitos: JPEG, PNG ou WebP.');
  const out = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

export async function addProductImage(deps: AppDeps, actor: Actor, productId: string, file: Buffer, originalName: string) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  const img = await processImage(file);
  const key = `${actor.tenantId}/products/${randomUUID()}.webp`;
  return tx(deps, actor, async (trx) => {
    const p = await trx.selectFrom('products').select('id').where('id', '=', productId).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Produto');
    const count = await trx.selectFrom('product_images').select((eb) => eb.fn.countAll<number>().as('n')).where('product_id', '=', productId).executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_IMAGES_PER_PRODUCT) throw conflict(`Limite de ${MAX_IMAGES_PER_PRODUCT} fotos por produto.`);
    await checkLimit(trx, actor.tenantId, 'storage_mb', Math.ceil(img.data.length / 1048576));
    await deps.storage.put(key, img.data, 'image/webp');
    const att = await trx
      .insertInto('attachments')
      .values({
        tenant_id: actor.tenantId, storage_key: key, original_name: originalName.slice(0, 120), mime: 'image/webp', size_bytes: BigInt(img.data.length),
        sha256: createHash('sha256').update(img.data).digest('hex'), width: img.width, height: img.height, owner_type: 'product', owner_id: productId, created_by: actor.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.insertInto('product_images').values({ tenant_id: actor.tenantId, product_id: productId, attachment_id: att.id, position: Number(count.n) }).execute();
    await audit(trx, actor, 'product.image_added', 'product', productId, { attachmentId: att.id });
    return { id: att.id };
  });
}

export async function removeProductImage(deps: AppDeps, actor: Actor, productId: string, attachmentId: string) {
  requirePermission(actor, 'products.manage');
  const key = await tx(deps, actor, async (trx) => {
    const a = await trx.selectFrom('attachments').select(['storage_key']).where('id', '=', attachmentId).where('owner_id', '=', productId).executeTakeFirst();
    if (!a) throw notFound('Foto');
    await trx.deleteFrom('product_images').where('attachment_id', '=', attachmentId).execute();
    await trx.deleteFrom('attachments').where('id', '=', attachmentId).execute();
    await audit(trx, actor, 'product.image_removed', 'product', productId, { attachmentId });
    return a.storage_key;
  });
  await deps.storage.delete(key);
}

/** Download autenticado de anexo da própria empresa (RLS). */
export async function readAttachment(deps: AppDeps, actor: Actor, id: string): Promise<{ data: Buffer; mime: string }> {
  if (!can(actor, 'products.view') && !can(actor, 'finance.view')) throw new AppError('forbidden', 'Sem permissão.');
  const a = await tx(deps, actor, (trx) => trx.selectFrom('attachments').select(['storage_key', 'mime']).where('id', '=', id).executeTakeFirst());
  if (!a) throw notFound('Arquivo');
  return { data: await deps.storage.get(a.storage_key), mime: a.mime };
}
