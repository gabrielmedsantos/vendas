import { z } from 'zod';
import { sql, type Tx } from '@gct/db';
import { conflict, invalid, normalizeSearch, notFound } from '@gct/shared';
import { audit, can, isUniqueViolation, requirePermission, requireWritable, tx, type Actor, type AppDeps } from './core';
import { checkLimit } from './billing';
import { decodeCursor, pageOf, zCentsNonNeg, zPageQuery, zText, zUuid, type Page } from './validation';

// ---------------------------------------------------------------------------
// Categorias

export async function listCategories(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'products.view');
  return tx(deps, actor, (trx) =>
    trx
      .selectFrom('categories as c')
      .leftJoin('products as p', (j) => j.onRef('p.category_id', '=', 'c.id').on('p.status', '<>', 'archived'))
      .select(['c.id', 'c.name', sql<number>`count(p.id)::int`.as('product_count')])
      .where('c.archived_at', 'is', null)
      .groupBy(['c.id', 'c.name'])
      .orderBy('c.name')
      .execute(),
  );
}

export const zCategory = z.object({ name: zText(80).min(1, 'Informe o nome') });

export async function createCategory(deps: AppDeps, actor: Actor, input: z.infer<typeof zCategory>) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    try {
      const row = await trx.insertInto('categories').values({ tenant_id: actor.tenantId, name: input.name }).returning(['id', 'name']).executeTakeFirstOrThrow();
      await audit(trx, actor, 'category.created', 'category', row.id, { name: input.name });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe uma categoria com esse nome.');
      throw e;
    }
  });
}

export async function renameCategory(deps: AppDeps, actor: Actor, id: string, input: z.infer<typeof zCategory>) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    try {
      const r = await trx.updateTable('categories').set({ name: input.name }).where('id', '=', id).where('archived_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('Categoria');
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe uma categoria com esse nome.');
      throw e;
    }
    await audit(trx, actor, 'category.renamed', 'category', id, { name: input.name });
  });
}

/** Arquivar exige que não haja produtos vinculados, ou reclassificação explícita. */
export async function archiveCategory(deps: AppDeps, actor: Actor, id: string, reassignTo?: string | null) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const cat = await trx.selectFrom('categories').select('id').where('id', '=', id).where('archived_at', 'is', null).forUpdate().executeTakeFirst();
    if (!cat) throw notFound('Categoria');
    const linked = await trx.selectFrom('products').select(sql<number>`count(*)::int`.as('n')).where('category_id', '=', id).executeTakeFirstOrThrow();
    if (linked.n > 0) {
      if (reassignTo === undefined) throw conflict(`Categoria possui ${linked.n} produto(s). Escolha para qual categoria reclassificar.`);
      if (reassignTo) {
        const target = await trx.selectFrom('categories').select('id').where('id', '=', reassignTo).where('archived_at', 'is', null).executeTakeFirst();
        if (!target || reassignTo === id) throw invalid('Categoria de destino inválida.');
      }
      await trx.updateTable('products').set({ category_id: reassignTo ?? null }).where('category_id', '=', id).execute();
    }
    await trx.updateTable('categories').set({ archived_at: new Date() }).where('id', '=', id).execute();
    await audit(trx, actor, 'category.archived', 'category', id, { reassignTo, moved: linked.n });
  });
}

// ---------------------------------------------------------------------------
// Produtos

const zVariant = z.object({
  id: zUuid.optional(),
  sku: zText(64).min(1, 'Informe o SKU'),
  barcode: zText(64).optional().nullable(),
  label: zText(120).optional().default(''),
  attributes: z.record(z.string().max(40), z.string().max(80)).optional().default({}),
  retailPriceCents: zCentsNonNeg,
  wholesalePriceCents: zCentsNonNeg.optional().nullable(),
  wholesaleMinQty: z.number().int().positive().optional().nullable(),
  suggestedPriceCents: zCentsNonNeg.optional().nullable(),
  minStock: z.number().int().min(0).max(1_000_000).optional().default(0),
});

export const zProduct = z.object({
  kind: z.enum(['physical', 'service']).default('physical'),
  tracking: z.enum(['quantity', 'serialized', 'none']).default('quantity'),
  name: zText(160).min(1, 'Informe o nome'),
  description: zText(4000).optional().nullable(),
  brand: zText(80).optional().nullable(),
  categoryId: zUuid.optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active'),
  conditionDefault: z.enum(['new', 'used', 'refurbished']).optional().nullable(),
  warrantyDays: z.number().int().min(0).max(3650).default(0),
  identifierKinds: z.array(z.enum(['imei1', 'imei2', 'serial', 'other'])).max(4).default([]),
  variants: z.array(zVariant).min(1, 'Informe ao menos uma variante').max(100),
});
export type ProductInput = z.input<typeof zProduct>;

function searchText(p: { name: string; brand?: string | null }, variants: { sku: string; barcode?: string | null; label?: string }[]) {
  return normalizeSearch([p.name, p.brand ?? '', ...variants.flatMap((v) => [v.sku, v.barcode ?? '', v.label ?? ''])].join(' '));
}

function checkProductShape(input: z.infer<typeof zProduct>) {
  if (input.kind === 'service' && input.tracking !== 'none') throw invalid('Serviço não controla estoque.', { tracking: 'inválido' });
  if (input.kind === 'physical' && input.tracking === 'none') throw invalid('Produto físico precisa controlar estoque.', { tracking: 'inválido' });
  const skus = new Set(input.variants.map((v) => v.sku.toLowerCase()));
  if (skus.size !== input.variants.length) throw invalid('SKUs repetidos no produto.', { variants: 'SKU duplicado' });
}

export async function createProduct(deps: AppDeps, actor: Actor, input: z.infer<typeof zProduct>) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  checkProductShape(input);
  return tx(deps, actor, async (trx) => {
    await checkLimit(trx, actor.tenantId, 'products', 1);
    if (input.categoryId) await assertCategory(trx, input.categoryId);
    const product = await trx
      .insertInto('products')
      .values({
        tenant_id: actor.tenantId,
        kind: input.kind,
        tracking: input.tracking,
        name: input.name,
        description: input.description ?? null,
        brand: input.brand ?? null,
        category_id: input.categoryId ?? null,
        status: input.status,
        condition_default: input.conditionDefault ?? null,
        warranty_days: input.warrantyDays,
        identifier_kinds: input.identifierKinds,
        search_text: searchText(input, input.variants),
        created_by: actor.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await insertVariants(trx, actor, product.id, input.variants);
    await audit(trx, actor, 'product.created', 'product', product.id, { name: input.name });
    return { id: product.id };
  });
}

async function assertCategory(trx: Tx, id: string) {
  const c = await trx.selectFrom('categories').select('id').where('id', '=', id).where('archived_at', 'is', null).executeTakeFirst();
  if (!c) throw invalid('Categoria inválida.', { categoryId: 'inválida' });
}

async function insertVariants(trx: Tx, actor: Actor, productId: string, variants: z.infer<typeof zVariant>[]) {
  try {
    for (const [i, v] of variants.entries()) {
      await trx
        .insertInto('product_variants')
        .values({
          tenant_id: actor.tenantId,
          product_id: productId,
          sku: v.sku,
          barcode: v.barcode || null,
          label: v.label ?? '',
          attributes: JSON.stringify(v.attributes ?? {}),
          retail_price_cents: v.retailPriceCents,
          wholesale_price_cents: v.wholesalePriceCents ?? null,
          wholesale_min_qty: v.wholesaleMinQty ?? null,
          suggested_price_cents: v.suggestedPriceCents ?? null,
          min_stock: v.minStock ?? 0,
          is_default: i === 0,
        })
        .execute();
    }
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('SKU ou código de barras já usado em outro produto.');
    throw e;
  }
}

/** Edição de cadastro: não altera snapshots de vendas/compras já confirmadas. */
export async function updateProduct(deps: AppDeps, actor: Actor, id: string, input: z.infer<typeof zProduct> & { version?: number }) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  checkProductShape(input);
  return tx(deps, actor, async (trx) => {
    const cur = await trx.selectFrom('products').selectAll().where('id', '=', id).where('status', '<>', 'archived').forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Produto');
    if (input.version !== undefined && input.version !== cur.version)
      throw conflict('Este produto foi alterado por outra pessoa. Recarregue antes de salvar.');
    if (cur.tracking !== input.tracking) {
      const hasStock = await trx
        .selectFrom('stock_movements as m')
        .innerJoin('product_variants as v', 'v.id', 'm.variant_id')
        .select('m.id')
        .where('v.product_id', '=', id)
        .limit(1)
        .executeTakeFirst();
      if (hasStock) throw conflict('Não é possível mudar o modo de controle após movimentar estoque.');
    }
    if (input.categoryId) await assertCategory(trx, input.categoryId);
    await trx
      .updateTable('products')
      .set({
        kind: input.kind,
        tracking: input.tracking,
        name: input.name,
        description: input.description ?? null,
        brand: input.brand ?? null,
        category_id: input.categoryId ?? null,
        status: input.status,
        condition_default: input.conditionDefault ?? null,
        warranty_days: input.warrantyDays,
        identifier_kinds: input.identifierKinds,
        search_text: searchText(input, input.variants),
        version: cur.version + 1,
      })
      .where('id', '=', id)
      .execute();
    const existing = await trx.selectFrom('product_variants').select(['id', 'retail_price_cents']).where('product_id', '=', id).execute();
    const keep = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
    for (const v of existing) {
      if (!keep.has(v.id)) await trx.updateTable('product_variants').set({ status: 'archived' }).where('id', '=', v.id).execute();
    }
    try {
      for (const v of input.variants) {
        if (v.id) {
          if (!existing.some((e) => e.id === v.id)) throw invalid('Variante não pertence ao produto.');
          await trx
            .updateTable('product_variants')
            .set({
              sku: v.sku,
              barcode: v.barcode || null,
              label: v.label ?? '',
              attributes: JSON.stringify(v.attributes ?? {}),
              retail_price_cents: v.retailPriceCents,
              wholesale_price_cents: v.wholesalePriceCents ?? null,
              wholesale_min_qty: v.wholesaleMinQty ?? null,
              suggested_price_cents: v.suggestedPriceCents ?? null,
              min_stock: v.minStock ?? 0,
              status: 'active',
            })
            .where('id', '=', v.id)
            .execute();
        }
      }
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('SKU ou código de barras já usado em outro produto.');
      throw e;
    }
    const added = input.variants.filter((v) => !v.id);
    if (added.length) await insertVariants(trx, actor, id, added);
    await audit(trx, actor, 'product.updated', 'product', id, {
      priceChanges: input.variants
        .filter((v) => v.id)
        .map((v) => ({ id: v.id, from: existing.find((e) => e.id === v.id)?.retail_price_cents, to: v.retailPriceCents }))
        .filter((c) => c.from !== c.to),
    });
  });
}

/**
 * Exclui produto cadastrado por engano que nunca foi usado (sem estoque, compra, venda, troca ou catálogo).
 * Produto com qualquer histórico não é excluído: use Arquivar.
 */
export async function deleteProduct(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  const used = conflict('Este produto já tem movimentação (estoque, compra, venda ou catálogo) e não pode ser excluído. Use Arquivar.');
  let keys: string[] = [];
  try {
    await tx(deps, actor, async (trx) => {
      const p = await trx.selectFrom('products').select(['id', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('Produto');
      const hist = await sql<{ n: number }>`
        select (select count(*) from stock_movements m join product_variants v on v.id = m.variant_id where v.product_id = ${id})
             + (select count(*) from purchase_items i join product_variants v on v.id = i.variant_id where v.product_id = ${id})
             + (select count(*) from sale_items i join product_variants v on v.id = i.variant_id where v.product_id = ${id})
             + (select count(*) from inventory_units u join product_variants v on v.id = u.variant_id where v.product_id = ${id}) as n`.execute(trx);
      if (Number(hist.rows[0]!.n) > 0) throw used;
      const imgs = await trx.selectFrom('product_images as pi').innerJoin('attachments as a', 'a.id', 'pi.attachment_id').select(['a.id', 'a.storage_key']).where('pi.product_id', '=', id).execute();
      await trx.deleteFrom('product_images').where('product_id', '=', id).execute();
      if (imgs.length) await trx.deleteFrom('attachments').where('id', 'in', imgs.map((i) => i.id)).execute();
      await trx.deleteFrom('product_variants').where('product_id', '=', id).execute();
      await trx.deleteFrom('products').where('id', '=', id).execute();
      await audit(trx, actor, 'product.deleted', 'product', id, { name: p.name });
      keys = imgs.map((i) => i.storage_key);
    });
  } catch (e) {
    // Referência não prevista (ex.: item em catálogo ou pedido): mesma resposta de "já usado".
    if ((e as { code?: string }).code === '23503') throw used;
    throw e;
  }
  for (const k of keys) await deps.storage.delete(k).catch(() => undefined);
}

export async function setProductStatus(deps: AppDeps, actor: Actor, id: string, status: 'active' | 'inactive' | 'archived') {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    if (status === 'archived') {
      const stock = await trx
        .selectFrom('stock_balances as b')
        .innerJoin('product_variants as v', 'v.id', 'b.variant_id')
        .select(sql<number>`coalesce(sum(b.on_hand + b.inspection), 0)::int`.as('n'))
        .where('v.product_id', '=', id)
        .executeTakeFirstOrThrow();
      if (stock.n > 0) throw conflict('Produto com estoque não pode ser arquivado. Zere o estoque por ajuste ou venda antes.');
    }
    const r = await trx.updateTable('products').set({ status }).where('id', '=', id).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Produto');
    await audit(trx, actor, `product.${status}`, 'product', id);
  });
}

export const zProductList = zPageQuery.extend({
  q: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'archived', 'all']).default('active'),
  filter: z.enum(['out_of_stock', 'low_stock', 'never_sold', 'with_stock']).optional(),
  categoryId: zUuid.optional(),
  kind: z.enum(['physical', 'service']).optional(),
  sort: z.enum(['name', '-name', 'created', '-created', 'price', '-price', 'stock', '-stock']).default('name'),
});

export interface ProductRow {
  id: string;
  variant_id: string;
  name: string;
  brand: string | null;
  kind: string;
  tracking: string;
  status: string;
  category_id: string | null;
  category_name: string | null;
  sku: string;
  label: string;
  variant_count: number;
  retail_price_cents: bigint;
  wholesale_price_cents: bigint | null;
  on_hand: number;
  reserved: number;
  inspection: number;
  min_stock: number;
  /** somente com permissão costs.view */
  stock_cost_cents?: bigint | null;
  unit_cost_cents?: bigint | null;
  margin_bps?: number | null;
  image_id: string | null;
}

/** Listagem por variante padrão com saldos; custo/margem só com permissão. */
export async function listProducts(deps: AppDeps, actor: Actor, q: z.infer<typeof zProductList>): Promise<Page<ProductRow> & { summary?: Record<string, unknown> }> {
  requirePermission(actor, 'products.view');
  const offset = decodeCursor(q.cursor);
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const orderMap: Record<string, string> = {
      name: 'p.name asc, p.id asc',
      '-name': 'p.name desc, p.id desc',
      created: 'p.created_at asc, p.id asc',
      '-created': 'p.created_at desc, p.id desc',
      price: 'v.retail_price_cents asc, p.id asc',
      '-price': 'v.retail_price_cents desc, p.id desc',
      stock: 'st.on_hand asc, p.id asc',
      '-stock': 'st.on_hand desc, p.id desc',
    };
    const where = [sql`true`];
    if (q.status !== 'all') where.push(sql`p.status = ${q.status}`);
    if (q.q) where.push(sql`p.search_text like ${'%' + normalizeSearch(q.q).replace(/[%_]/g, '') + '%'}`);
    if (q.categoryId) where.push(sql`p.category_id = ${q.categoryId}`);
    if (q.kind) where.push(sql`p.kind = ${q.kind}`);
    if (q.filter === 'out_of_stock') where.push(sql`p.kind = 'physical' and st.on_hand = 0`);
    if (q.filter === 'with_stock') where.push(sql`st.on_hand > 0`);
    if (q.filter === 'low_stock') where.push(sql`p.kind = 'physical' and st.on_hand <= st.min_stock and st.min_stock > 0`);
    if (q.filter === 'never_sold') where.push(sql`not exists (select 1 from sale_items si join product_variants vv on vv.id = si.variant_id where vv.product_id = p.id)`);
    const rows = await sql<ProductRow & { total: number }>`
      with st as (
        select v.product_id,
               coalesce(sum(b.on_hand), 0)::int as on_hand,
               coalesce(sum(b.reserved), 0)::int as reserved,
               coalesce(sum(b.inspection), 0)::int as inspection,
               coalesce(sum(v.min_stock), 0)::int as min_stock,
               count(distinct v.id)::int as variant_count
        from product_variants v
        left join stock_balances b on b.variant_id = v.id
        where v.status = 'active'
        group by v.product_id
      ), cost as (
        select v.product_id, sum(l.cost_remaining_cents) as stock_cost, sum(l.qty_remaining) as qty
        from inventory_lots l join product_variants v on v.id = l.variant_id
        where l.qty_remaining > 0
        group by v.product_id
      )
      select p.id, v.id as variant_id, p.name, p.brand, p.kind, p.tracking, p.status, p.category_id, c.name as category_name,
             v.sku, v.label, coalesce(st.variant_count, 1) as variant_count, v.retail_price_cents, v.wholesale_price_cents,
             coalesce(st.on_hand, 0) as on_hand, coalesce(st.reserved, 0) as reserved, coalesce(st.inspection, 0) as inspection,
             coalesce(st.min_stock, 0) as min_stock,
             cost.stock_cost as stock_cost_cents,
             case when cost.qty > 0 then round(cost.stock_cost / cost.qty)::bigint end as unit_cost_cents,
             (select pi.attachment_id from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_id,
             count(*) over ()::int as total
      from products p
      join product_variants v on v.product_id = p.id and v.is_default
      left join categories c on c.id = p.category_id
      left join st on st.product_id = p.id
      left join cost on cost.product_id = p.id
      where ${sql.join(where, sql` and `)}
      order by ${sql.raw(orderMap[q.sort]!)}
      limit ${q.limit + 1} offset ${offset}`.execute(trx);
    const total = rows.rows[0]?.total ?? 0;
    const data = rows.rows.map(({ total: _t, ...r }) => {
      if (!showCost) {
        const { stock_cost_cents: _a, unit_cost_cents: _b, ...rest } = r;
        return rest as ProductRow;
      }
      const unit = r.unit_cost_cents;
      const margin =
        unit !== null && unit !== undefined && r.retail_price_cents > 0n
          ? Number(((r.retail_price_cents - unit) * 10000n) / r.retail_price_cents)
          : null;
      return { ...r, margin_bps: margin };
    });
    const page = pageOf(data, offset, q.limit, total);
    const summary = await stockSummary(trx, showCost);
    return { ...page, summary };
  });
}

/** Totais do estoque: valor a custo (com permissão) e potencial de venda (estimativa). */
async function stockSummary(trx: Tx, showCost: boolean) {
  const r = await sql<{ items: number; products: number; potential: bigint; cost: bigint }>`
    select coalesce(sum(b.on_hand), 0)::int as items,
           count(distinct v.product_id) filter (where b.on_hand > 0)::int as products,
           coalesce(sum(b.on_hand::bigint * v.retail_price_cents), 0)::bigint as potential,
           (select coalesce(sum(cost_remaining_cents), 0) from inventory_lots where status = 'available')::bigint as cost
    from stock_balances b join product_variants v on v.id = b.variant_id`.execute(trx);
  const row = r.rows[0]!;
  return {
    itemsInStock: row.items,
    productsInStock: row.products,
    potentialSaleCents: row.potential,
    ...(showCost ? { stockCostCents: row.cost, potentialMarginCents: row.potential - row.cost } : {}),
  };
}

export async function getProduct(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const product = await trx
      .selectFrom('products as p')
      .leftJoin('categories as c', 'c.id', 'p.category_id')
      .select([
        'p.id', 'p.kind', 'p.tracking', 'p.name', 'p.description', 'p.brand', 'p.category_id', 'c.name as category_name',
        'p.status', 'p.condition_default', 'p.warranty_days', 'p.identifier_kinds', 'p.version', 'p.created_at', 'p.updated_at',
      ])
      .where('p.id', '=', id)
      .executeTakeFirst();
    if (!product) throw notFound('Produto');
    const variants = await trx
      .selectFrom('product_variants as v')
      .leftJoin('stock_balances as b', 'b.variant_id', 'v.id')
      .select([
        'v.id', 'v.sku', 'v.barcode', 'v.label', 'v.attributes', 'v.retail_price_cents', 'v.wholesale_price_cents',
        'v.wholesale_min_qty', 'v.suggested_price_cents', 'v.min_stock', 'v.is_default', 'v.status',
        sql<number>`coalesce(sum(b.on_hand), 0)::int`.as('on_hand'),
        sql<number>`coalesce(sum(b.reserved), 0)::int`.as('reserved'),
        sql<number>`coalesce(sum(b.inspection), 0)::int`.as('inspection'),
      ])
      .where('v.product_id', '=', id)
      .where('v.status', '=', 'active')
      .groupBy('v.id')
      .orderBy('v.is_default', 'desc')
      .orderBy('v.sku')
      .execute();
    const images = await trx
      .selectFrom('product_images')
      .select(['attachment_id', 'position'])
      .where('product_id', '=', id)
      .orderBy('position')
      .execute();
    const units =
      product.tracking === 'serialized'
        ? await trx
            .selectFrom('inventory_units as u')
            .innerJoin('product_variants as v', 'v.id', 'u.variant_id')
            .leftJoin('inventory_lots as l', 'l.id', 'u.current_lot_id')
            .select([
              'u.id', 'u.variant_id', 'u.internal_code', 'u.status', 'u.condition', 'u.battery_health_pct', 'u.accessories', 'u.defects',
              'u.notes', 'u.created_at',
              sql<unknown>`(select coalesce(json_agg(json_build_object('kind', ui.kind, 'value', ui.value)), '[]') from unit_identifiers ui where ui.unit_id = u.id)`.as('identifiers'),
              ...(showCost ? [sql<bigint | null>`l.cost_remaining_cents`.as('cost_cents')] : []),
            ])
            .where('v.product_id', '=', id)
            .where('u.status', 'not in', ['sold', 'lost', 'returned_to_supplier'])
            .orderBy('u.created_at', 'desc')
            .limit(200)
            .execute()
        : [];
    const lots = showCost
      ? await trx
          .selectFrom('inventory_lots as l')
          .innerJoin('product_variants as v', 'v.id', 'l.variant_id')
          .select(['l.id', 'l.variant_id', 'l.source_type', 'l.status', 'l.received_at', 'l.qty_received', 'l.qty_remaining', 'l.cost_received_cents', 'l.cost_remaining_cents'])
          .where('v.product_id', '=', id)
          .where('l.qty_remaining', '>', 0)
          .orderBy('l.received_at')
          .execute()
      : undefined;
    return { ...product, variants, images, units, lots, canSeeCost: showCost };
  });
}

export async function productHistory(deps: AppDeps, actor: Actor, id: string, limit = 100) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const rows = await trx
      .selectFrom('stock_movements as m')
      .innerJoin('product_variants as v', 'v.id', 'm.variant_id')
      .leftJoin('inventory_units as u', 'u.id', 'm.unit_id')
      .select([
        'm.id', 'm.created_at', 'm.direction', 'm.kind', 'm.bucket', 'm.quantity', 'm.physical_after', 'm.source_type', 'm.source_id',
        'm.reason', 'v.sku', 'u.internal_code', 'm.created_by',
        ...(showCost ? (['m.cost_cents'] as const) : []),
      ])
      .where('v.product_id', '=', id)
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .limit(Math.min(limit, 500))
      .execute();
    return rows;
  });
}

/** Busca rápida para venda/compra/troca: produtos ativos e unidades disponíveis. */
export async function searchSellable(deps: AppDeps, actor: Actor, term: string, opts: { includeInactive?: boolean } = {}) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  const norm = normalizeSearch(term).replace(/[%_]/g, '');
  const ident = term.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return tx(deps, actor, async (trx) => {
    const variants = await sql<{
      variant_id: string; product_id: string; name: string; sku: string; label: string; kind: string; tracking: string;
      retail_price_cents: bigint; wholesale_price_cents: bigint | null; wholesale_min_qty: number | null; available: number; unit_cost_cents: bigint | null;
    }>`
      select v.id as variant_id, p.id as product_id, p.name, v.sku, v.label, p.kind, p.tracking,
             v.retail_price_cents, v.wholesale_price_cents, v.wholesale_min_qty,
             coalesce((select sum(b.on_hand - b.reserved) from stock_balances b where b.variant_id = v.id), 0)::int as available,
             (select case when sum(l.qty_remaining) > 0 then round(sum(l.cost_remaining_cents) / sum(l.qty_remaining))::bigint end
                from inventory_lots l where l.variant_id = v.id and l.status = 'available' and l.qty_remaining > 0) as unit_cost_cents
      from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and ${opts.includeInactive ? sql`p.status <> 'archived'` : sql`p.status = 'active'`}
        and (${norm === '' ? sql`true` : sql`p.search_text like ${'%' + norm + '%'} or lower(v.sku) = ${term.toLowerCase()} or v.barcode = ${term}`})
      order by p.name, v.sku
      limit 20`.execute(trx);
    const units =
      ident.length >= 3
        ? await sql<{ unit_id: string; variant_id: string; internal_code: string; status: string; name: string; sku: string; retail_price_cents: bigint; condition: string | null; cost_cents: bigint | null; matched: string }>`
            select u.id as unit_id, u.variant_id, u.internal_code, u.status, p.name, v.sku, v.retail_price_cents, u.condition,
                   l.cost_remaining_cents as cost_cents, ui.value as matched
            from unit_identifiers ui
            join inventory_units u on u.id = ui.unit_id
            join product_variants v on v.id = u.variant_id
            join products p on p.id = v.product_id
            left join inventory_lots l on l.id = u.current_lot_id
            where ui.normalized like ${ident + '%'} or u.internal_code = ${term.trim().toUpperCase()}
            limit 10`.execute(trx)
        : { rows: [] };
    const strip = <T extends { unit_cost_cents?: unknown; cost_cents?: unknown }>(r: T) => {
      if (showCost) return r;
      const { unit_cost_cents: _a, cost_cents: _b, ...rest } = r;
      return rest;
    };
    return { variants: variants.rows.map(strip), units: units.rows.map(strip) };
  });
}

export async function availableUnits(deps: AppDeps, actor: Actor, variantId: string) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const rows = await trx
      .selectFrom('inventory_units as u')
      .leftJoin('inventory_lots as l', 'l.id', 'u.current_lot_id')
      .select([
        'u.id', 'u.internal_code', 'u.condition', 'u.battery_health_pct', 'u.status',
        sql<unknown>`(select coalesce(json_agg(json_build_object('kind', ui.kind, 'value', ui.value)), '[]') from unit_identifiers ui where ui.unit_id = u.id)`.as('identifiers'),
        ...(showCost ? [sql<bigint | null>`l.cost_remaining_cents`.as('cost_cents')] : []),
      ])
      .where('u.variant_id', '=', variantId)
      .where('u.status', '=', 'available')
      .orderBy('u.created_at')
      .execute();
    return rows;
  });
}

/** Resumo de uma variante para pré-seleção em venda/compra/troca. */
export async function getSellableVariant(deps: AppDeps, actor: Actor, variantId: string) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const r = await sql<Record<string, unknown>>`
      select v.id as variant_id, p.id as product_id, p.name, v.sku, v.label, p.kind, p.tracking, p.status,
             v.retail_price_cents, v.wholesale_price_cents, v.wholesale_min_qty,
             coalesce((select sum(b.on_hand - b.reserved) from stock_balances b where b.variant_id = v.id), 0)::int as available,
             (select case when sum(l.qty_remaining) > 0 then round(sum(l.cost_remaining_cents) / sum(l.qty_remaining))::bigint end
                from inventory_lots l where l.variant_id = v.id and l.status = 'available' and l.qty_remaining > 0) as unit_cost_cents
      from product_variants v join products p on p.id = v.product_id where v.id = ${variantId}`.execute(trx);
    const row = r.rows[0];
    if (!row) throw notFound('Produto');
    if (!showCost) delete row.unit_cost_cents;
    return row;
  });
}
