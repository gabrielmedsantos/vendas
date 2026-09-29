import { createHash, randomUUID } from 'node:crypto';
import { sql } from '@gct/db';
import { notFound } from '@gct/shared';
import { audit, requirePermission, requireWritable, tx, type Actor, type AppDeps } from './core';
import { checkLimit } from './billing';
import { processImage } from './images';

/** Encarte digital: produtos disponíveis para divulgar e logo da empresa. Nunca expõe custo. */

export interface FlyerProduct {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  category_name: string | null;
  retail_price_cents: bigint;
  available: number;
  image_id: string | null;
}

/** Produtos ativos, físicos, com preço e saldo disponível (físico − reservado) > 0. */
export async function listFlyerProducts(deps: AppDeps, actor: Actor): Promise<FlyerProduct[]> {
  requirePermission(actor, 'catalog.manage');
  return tx(deps, actor, async (trx) => {
    const r = await sql<FlyerProduct>`
      with st as (
        select v.product_id, coalesce(sum(b.on_hand - b.reserved), 0)::int as available
        from product_variants v join stock_balances b on b.variant_id = v.id
        where v.status = 'active'
        group by v.product_id
      )
      select p.id, p.name, p.brand, p.description, c.name as category_name, v.retail_price_cents, st.available,
             (select pi.attachment_id from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_id
      from products p
      join product_variants v on v.product_id = p.id and v.is_default
      join st on st.product_id = p.id
      left join categories c on c.id = p.category_id
      where p.status = 'active' and p.kind = 'physical' and st.available > 0 and v.retail_price_cents > 0
      order by c.name nulls last, p.name, p.id
      limit 500`.execute(trx);
    return r.rows;
  });
}

/** Troca a logo da empresa (WebP reprocessado, sem metadados). A logo anterior é apagada. */
export async function setBrandLogo(deps: AppDeps, actor: Actor, file: Buffer, originalName: string) {
  requirePermission(actor, 'settings.manage');
  requireWritable(actor);
  const img = await processImage(file);
  const key = `${actor.tenantId}/brand/${randomUUID()}.webp`;
  const old = await tx(deps, actor, async (trx) => {
    const t = await trx.selectFrom('tenants').select(['settings']).where('id', '=', actor.tenantId).forUpdate().executeTakeFirstOrThrow();
    const prevId = (t.settings as { brandLogoId?: string }).brandLogoId;
    await checkLimit(trx, actor.tenantId, 'storage_mb', Math.ceil(img.data.length / 1048576));
    await deps.storage.put(key, img.data, 'image/webp');
    const att = await trx
      .insertInto('attachments')
      .values({
        tenant_id: actor.tenantId, storage_key: key, original_name: originalName.slice(0, 120), mime: 'image/webp', size_bytes: BigInt(img.data.length),
        sha256: createHash('sha256').update(img.data).digest('hex'), width: img.width, height: img.height, owner_type: 'brand_logo', owner_id: actor.tenantId, created_by: actor.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.updateTable('tenants')
      .set({ settings: sql`settings || ${JSON.stringify({ brandLogoId: att.id })}::jsonb` })
      .where('id', '=', actor.tenantId)
      .execute();
    let prevKey: string | null = null;
    if (prevId) {
      const prev = await trx.deleteFrom('attachments').where('id', '=', prevId).where('owner_type', '=', 'brand_logo').returning('storage_key').executeTakeFirst();
      prevKey = prev?.storage_key ?? null;
    }
    await audit(trx, actor, 'tenant.logo_set', 'tenant', actor.tenantId, { attachmentId: att.id });
    return { id: att.id, prevKey };
  });
  if (old.prevKey) await deps.storage.delete(old.prevKey).catch(() => undefined);
  return { id: old.id };
}

export async function removeBrandLogo(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'settings.manage');
  const key = await tx(deps, actor, async (trx) => {
    const t = await trx.selectFrom('tenants').select(['settings']).where('id', '=', actor.tenantId).forUpdate().executeTakeFirstOrThrow();
    const prevId = (t.settings as { brandLogoId?: string }).brandLogoId;
    if (!prevId) throw notFound('Logo');
    await trx.updateTable('tenants').set({ settings: sql`settings - 'brandLogoId'` }).where('id', '=', actor.tenantId).execute();
    const prev = await trx.deleteFrom('attachments').where('id', '=', prevId).where('owner_type', '=', 'brand_logo').returning('storage_key').executeTakeFirst();
    await audit(trx, actor, 'tenant.logo_removed', 'tenant', actor.tenantId, {});
    return prev?.storage_key ?? null;
  });
  if (key) await deps.storage.delete(key).catch(() => undefined);
}
