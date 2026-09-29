import { z } from 'zod';
import { jsonb, nextNumber, sql, withTenant, type Tx } from '@gct/db';
import { AppError, conflict, invalid, notFound, slugify } from '@gct/shared';
import { audit, isUniqueViolation, requirePermission, requireWritable, tx, type Actor, type AppDeps } from './core';
import { requireFeature } from './billing';
import { releaseReservations, reserve } from './inventory';
import { zText, zUuid } from './validation';

// ---------------------------------------------------------------------------
// Gestão do catálogo (dentro da empresa)

export const zCatalog = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,47}$/, 'Use letras minúsculas, números e hífen (3 a 48).'),
  title: zText(80).min(2),
  description: zText(500).optional().nullable(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#8a62ff'),
  contactWhatsapp: z.string().trim().regex(/^\+?\d{10,15}$/, 'WhatsApp com DDD, só números').optional().nullable().or(z.literal('')),
  showPrices: z.boolean().default(true),
  acceptOrders: z.boolean().default(false),
});

export async function getCatalogAdmin(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'catalog.manage');
  return tx(deps, actor, async (trx) => {
    const catalog = await trx.selectFrom('catalogs').selectAll().orderBy('created_at').executeTakeFirst();
    // Garante que fotos adicionadas depois da publicação apareçam no catálogo público.
    if (catalog?.published) await syncPublicImages(trx);
    const items = catalog
      ? await trx
          .selectFrom('catalog_items as ci')
          .innerJoin('product_variants as v', 'v.id', 'ci.variant_id')
          .innerJoin('products as p', 'p.id', 'v.product_id')
          .select(['ci.variant_id', 'ci.position', 'p.name', 'v.sku', 'v.label', 'v.retail_price_cents', 'p.status'])
          .select(sql<string | null>`(select pi.attachment_id from product_images pi where pi.product_id = p.id order by pi.position limit 1)`.as('image_id'))
          .where('ci.catalog_id', '=', catalog.id)
          .orderBy('ci.position')
          .execute()
      : [];
    return { catalog: catalog ?? null, items };
  });
}

/** Recalcula quais fotos podem ser servidas publicamente (somente de itens em catálogo publicado). */
async function syncPublicImages(trx: Tx) {
  await sql`
    update attachments a set is_public = exists (
      select 1 from product_images pi
      join product_variants v on v.product_id = pi.product_id
      join catalog_items ci on ci.variant_id = v.id
      join catalogs c on c.id = ci.catalog_id and c.published
      where pi.attachment_id = a.id)
    where a.owner_type = 'product'`.execute(trx);
}

export async function saveCatalog(deps: AppDeps, actor: Actor, input: z.infer<typeof zCatalog>) {
  requirePermission(actor, 'catalog.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    await requireFeature(trx, actor.tenantId, 'catalog');
    const existing = await trx.selectFrom('catalogs').select('id').executeTakeFirst();
    const values = {
      slug: slugify(input.slug) || input.slug,
      title: input.title,
      description: input.description ?? null,
      theme: jsonb({ accentColor: input.accentColor }),
      contact_whatsapp: input.contactWhatsapp || null,
      show_prices: input.showPrices,
      accept_orders: input.acceptOrders,
    };
    try {
      const r = existing
        ? await trx.updateTable('catalogs').set(values).where('id', '=', existing.id).returning('id').executeTakeFirstOrThrow()
        : await trx.insertInto('catalogs').values({ tenant_id: actor.tenantId, ...values }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, actor, 'catalog.saved', 'catalog', r.id, { slug: values.slug });
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Este endereço já está em uso. Escolha outro.');
      throw e;
    }
  });
}

export async function setCatalogItems(deps: AppDeps, actor: Actor, variantIds: string[]) {
  requirePermission(actor, 'catalog.manage');
  requireWritable(actor);
  if (variantIds.length > 500) throw invalid('Máximo de 500 itens no catálogo.');
  return tx(deps, actor, async (trx) => {
    const c = await trx.selectFrom('catalogs').select('id').executeTakeFirst();
    if (!c) throw notFound('Catálogo');
    const valid = variantIds.length
      ? await trx.selectFrom('product_variants as v').innerJoin('products as p', 'p.id', 'v.product_id').select('v.id').where('v.id', 'in', variantIds).where('p.status', '=', 'active').execute()
      : [];
    if (valid.length !== new Set(variantIds).size) throw invalid('Algum produto está inativo ou não existe.');
    await trx.deleteFrom('catalog_items').where('catalog_id', '=', c.id).execute();
    for (const [i, v] of [...new Set(variantIds)].entries()) {
      await trx.insertInto('catalog_items').values({ tenant_id: actor.tenantId, catalog_id: c.id, variant_id: v, position: i }).execute();
    }
    await syncPublicImages(trx);
    await audit(trx, actor, 'catalog.items_set', 'catalog', c.id, { count: variantIds.length });
  });
}

/** Publicar é ação explícita; despublicar retira fotos do acesso público. */
export async function setCatalogPublished(deps: AppDeps, actor: Actor, published: boolean) {
  requirePermission(actor, 'catalog.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const c = await trx.selectFrom('catalogs').select('id').executeTakeFirst();
    if (!c) throw notFound('Catálogo');
    await trx.updateTable('catalogs').set({ published, published_at: published ? new Date() : null }).where('id', '=', c.id).execute();
    await syncPublicImages(trx);
    await audit(trx, actor, published ? 'catalog.published' : 'catalog.unpublished', 'catalog', c.id);
  });
}

export async function catalogAnalytics(deps: AppDeps, actor: Actor, days = 30) {
  requirePermission(actor, 'catalog.manage');
  return tx(deps, actor, async (trx) => {
    await requireFeature(trx, actor.tenantId, 'catalog_analytics');
    const since = new Date(Date.now() - days * 86400000);
    const byKind = await trx
      .selectFrom('catalog_events')
      .select(['kind', sql<number>`count(*)::int`.as('n')])
      .where('created_at', '>=', since)
      .groupBy('kind')
      .execute();
    const top = await sql<{ name: string; views: number }>`
      select p.name, count(*)::int as views from catalog_events e
      join product_variants v on v.id = e.variant_id join products p on p.id = v.product_id
      where e.kind = 'product_view' and e.created_at >= ${since} group by p.name order by 2 desc limit 10`.execute(trx);
    return { days, byKind, topProducts: top.rows, note: 'Visitas e cliques não são vendas: receita só existe quando a venda é confirmada.' };
  });
}

// ---------------------------------------------------------------------------
// Pedidos recebidos pelo catálogo (dentro da empresa)

export async function listPublicOrders(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'sales.view');
  return tx(deps, actor, async (trx) => {
    const orders = await trx
      .selectFrom('public_orders')
      .select(['id', 'number', 'contact_name', 'contact_phone', 'notes', 'status', 'total_cents', 'reservation_expires_at', 'sale_id', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    const items = orders.length
      ? await trx.selectFrom('public_order_items').select(['order_id', 'variant_id', 'description', 'quantity', 'unit_price_cents']).where('order_id', 'in', orders.map((o) => o.id)).execute()
      : [];
    return orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) }));
  });
}

/** Reserva por prazo limitado após o operador validar disponibilidade. */
export async function reservePublicOrder(deps: AppDeps, actor: Actor, orderId: string, hours = 24) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const o = await trx.selectFrom('public_orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
    if (!o) throw notFound('Pedido');
    if (o.status !== 'pending') throw conflict('Pedido não está pendente.');
    const items = await trx.selectFrom('public_order_items').select(['variant_id', 'quantity']).where('order_id', '=', orderId).orderBy('variant_id').execute();
    const serial = await trx.selectFrom('product_variants as v').innerJoin('products as p', 'p.id', 'v.product_id').select(['v.id', 'p.tracking']).where('v.id', 'in', items.map((i) => i.variant_id)).execute();
    const expires = new Date(Date.now() + hours * 3600_000);
    for (const i of items) {
      if (serial.find((s) => s.id === i.variant_id)?.tracking === 'serialized') {
        const units = await trx.selectFrom('inventory_units').select('id').where('variant_id', '=', i.variant_id).where('status', '=', 'available').orderBy('created_at').limit(i.quantity).execute();
        if (units.length < i.quantity) throw new AppError('insufficient_stock', 'Unidades indisponíveis para reservar.');
        for (const u of units) await reserve(trx, actor, { variantId: i.variant_id, unitId: u.id, quantity: 1, sourceType: 'public_order', sourceId: orderId, expiresAt: expires });
      } else {
        await reserve(trx, actor, { variantId: i.variant_id, quantity: i.quantity, sourceType: 'public_order', sourceId: orderId, expiresAt: expires });
      }
    }
    await trx.updateTable('public_orders').set({ status: 'reserved', reservation_expires_at: expires }).where('id', '=', orderId).execute();
    await audit(trx, actor, 'catalog.order_reserved', 'public_order', orderId, { hours });
  });
}

export async function closePublicOrder(deps: AppDeps, actor: Actor, orderId: string, status: 'converted' | 'canceled', saleId?: string) {
  requirePermission(actor, 'sales.create');
  return tx(deps, actor, async (trx) => {
    const o = await trx.selectFrom('public_orders').select(['status']).where('id', '=', orderId).forUpdate().executeTakeFirst();
    if (!o) throw notFound('Pedido');
    if (!['pending', 'reserved'].includes(o.status)) throw conflict('Pedido já encerrado.');
    await releaseReservations(trx, actor, 'public_order', orderId);
    await trx.updateTable('public_orders').set({ status, sale_id: saleId ?? null }).where('id', '=', orderId).execute();
    await audit(trx, actor, `catalog.order_${status}`, 'public_order', orderId, { saleId });
  });
}

// ---------------------------------------------------------------------------
// Lado público (papel gct_public, projeção explícita)

export interface PublicCatalogDTO {
  slug: string;
  title: string;
  description: string | null;
  storeName: string;
  accentColor: string;
  contactWhatsapp: string | null;
  showPrices: boolean;
  acceptOrders: boolean;
  items: { variantId: string; name: string; description: string | null; brand: string | null; label: string; category: string | null; priceCents: string | null; available: boolean; imageIds: string[] }[];
}

async function publicScope<T>(deps: AppDeps, slug: string, fn: (trx: Tx, catalog: { id: string; tenant_id: string }) => Promise<T>): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(slug)) throw notFound('Catálogo');
  const c = await deps.dbs.public.selectFrom('catalogs').select(['id', 'tenant_id']).where('slug', '=', slug).where('published', '=', true).executeTakeFirst();
  if (!c) throw notFound('Catálogo');
  return withTenant(deps.dbs.public, { tenantId: c.tenant_id }, (trx) => fn(trx, c));
}

/** Somente campos públicos: nunca custo, identificadores de unidade, cliente ou fornecedor. */
export async function getPublicCatalog(deps: AppDeps, slug: string): Promise<PublicCatalogDTO> {
  return publicScope(deps, slug, async (trx, c) => {
    const cat = await trx
      .selectFrom('catalogs')
      .select(['slug', 'title', 'description', 'theme', 'contact_whatsapp', 'show_prices', 'accept_orders'])
      .where('id', '=', c.id)
      .executeTakeFirstOrThrow();
    const tenant = await trx.selectFrom('tenants').select(['name', 'status']).where('id', '=', c.tenant_id).executeTakeFirstOrThrow();
    if (tenant.status !== 'active') throw notFound('Catálogo');
    const rows = await sql<{ variant_id: string; name: string; description: string | null; brand: string | null; label: string; category: string | null; price: bigint; available: number; product_id: string }>`
      select v.id as variant_id, p.id as product_id, p.name, p.description, p.brand, v.label, cat.name as category, v.retail_price_cents as price,
             coalesce((select sum(b.on_hand - b.reserved) from stock_balances b where b.variant_id = v.id), 0)::int as available
      from catalog_items ci
      join product_variants v on v.id = ci.variant_id
      join products p on p.id = v.product_id
      left join categories cat on cat.id = p.category_id
      where ci.catalog_id = ${c.id} and p.status = 'active' and v.status = 'active'
      order by ci.position`.execute(trx);
    const imgs = rows.rows.length
      ? await trx
          .selectFrom('product_images as pi')
          .innerJoin('attachments as a', 'a.id', 'pi.attachment_id')
          .select(['pi.product_id', 'pi.attachment_id', 'pi.position'])
          .where('pi.product_id', 'in', rows.rows.map((r) => r.product_id))
          .where('a.is_public', '=', true)
          .orderBy('pi.position')
          .execute()
      : [];
    return {
      slug: cat.slug,
      title: cat.title,
      description: cat.description,
      storeName: tenant.name,
      accentColor: ((cat.theme as { accentColor?: string }).accentColor ?? '#8a62ff').slice(0, 7),
      contactWhatsapp: cat.contact_whatsapp,
      showPrices: cat.show_prices,
      acceptOrders: cat.accept_orders,
      items: rows.rows.map((r) => ({
        variantId: r.variant_id,
        name: r.name,
        description: r.description,
        brand: r.brand,
        label: r.label,
        category: r.category,
        priceCents: cat.show_prices ? r.price.toString() : null,
        available: r.available > 0,
        imageIds: imgs.filter((i) => i.product_id === r.product_id).map((i) => i.attachment_id),
      })),
    };
  });
}

export async function readPublicImage(deps: AppDeps, slug: string, attachmentId: string): Promise<Buffer> {
  const key = await publicScope(deps, slug, (trx) =>
    trx.selectFrom('attachments').select(['storage_key']).where('id', '=', attachmentId).where('is_public', '=', true).executeTakeFirst(),
  );
  if (!key) throw notFound('Imagem');
  return deps.storage.get(key.storage_key);
}

export async function recordCatalogEvent(deps: AppDeps, slug: string, kind: 'view' | 'product_view' | 'contact_click', variantId?: string) {
  await publicScope(deps, slug, async (trx, c) => {
    await trx.insertInto('catalog_events').values({ tenant_id: c.tenant_id, catalog_id: c.id, kind, variant_id: variantId ?? null }).execute();
  });
}

export const zPublicOrder = z.object({
  contactName: zText(120).min(2, 'Informe seu nome'),
  contactPhone: z.string().trim().regex(/^[\d\s()+-]{8,30}$/, 'Telefone inválido'),
  notes: zText(500).optional().nullable(),
  items: z.array(z.object({ variantId: zUuid, quantity: z.number().int().min(1).max(20) })).min(1).max(30),
});

/**
 * Solicitação de pedido: fica pendente; não reserva nem confirma venda.
 * Preços congelados do catálogo; contato mínimo.
 */
export async function createPublicOrder(deps: AppDeps, slug: string, input: z.infer<typeof zPublicOrder>) {
  return publicScope(deps, slug, async (trx, c) => {
    const cat = await trx.selectFrom('catalogs').select(['accept_orders']).where('id', '=', c.id).executeTakeFirstOrThrow();
    if (!cat.accept_orders) throw conflict('Este catálogo não recebe pedidos pelo site.');
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    const rows = await sql<{ id: string; name: string; label: string; price: bigint }>`
      select v.id, p.name, v.label, v.retail_price_cents as price from catalog_items ci
      join product_variants v on v.id = ci.variant_id join products p on p.id = v.product_id
      where ci.catalog_id = ${c.id} and v.id = any(${ids}::uuid[]) and p.status = 'active'`.execute(trx);
    if (rows.rows.length !== ids.length) throw invalid('Algum item não está mais disponível no catálogo.');
    const number = await nextNumber(trx, c.tenant_id, 'public_order');
    const total = input.items.reduce((a, i) => a + rows.rows.find((r) => r.id === i.variantId)!.price * BigInt(i.quantity), 0n);
    const order = await trx
      .insertInto('public_orders')
      .values({ tenant_id: c.tenant_id, catalog_id: c.id, number, contact_name: input.contactName, contact_phone: input.contactPhone, notes: input.notes ?? null, total_cents: total })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const i of input.items) {
      const r = rows.rows.find((x) => x.id === i.variantId)!;
      await trx
        .insertInto('public_order_items')
        .values({ tenant_id: c.tenant_id, order_id: order.id, variant_id: i.variantId, description: `${r.name}${r.label ? ` ${r.label}` : ''}`, quantity: i.quantity, unit_price_cents: r.price })
        .execute();
    }
    await trx.insertInto('catalog_events').values({ tenant_id: c.tenant_id, catalog_id: c.id, kind: 'order_request' }).execute();
    await trx
      .insertInto('notifications')
      .values({ tenant_id: c.tenant_id, kind: 'public_order', severity: 'info', title: `Novo pedido pelo catálogo (#${number})`, body: 'Confira a disponibilidade e responda ao cliente.', link: '/app/catalogo' })
      .execute();
    return { number: number.toString(), totalCents: total.toString() };
  });
}
