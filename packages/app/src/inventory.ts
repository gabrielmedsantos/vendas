import { z } from 'zod';
import { nextNumber, sql, type Tx } from '@gct/db';
import { consumeFifo, type LotConsumption } from '@gct/domain';
import { AppError, conflict, invalid, normalizeIdentifier, notFound } from '@gct/shared';
import { audit, can, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { decodeCursor, pageOf, zCentsNonNeg, zPageQuery, zQty, zText, zUuid } from './validation';

export interface StockCtx {
  tenantId: string;
  userId: string;
}

export type MovementKind =
  | 'purchase_receipt' | 'sale' | 'sale_return' | 'trade_in' | 'trade_out' | 'adjustment_in' | 'adjustment_out'
  | 'loss' | 'supplier_return' | 'inspection_release' | 'inspection_hold' | 'reversal';

export async function defaultLocation(trx: Tx): Promise<string> {
  const loc = await trx.selectFrom('locations').select('id').where('is_default', '=', true).executeTakeFirst();
  if (!loc) throw new AppError('internal', 'Local padrão de estoque não configurado.');
  return loc.id;
}

interface BalanceRow {
  on_hand: number;
  reserved: number;
  inspection: number;
}

/** Garante e bloqueia a linha de saldo (ordem canônica é responsabilidade do chamador). */
export async function lockBalance(trx: Tx, tenantId: string, variantId: string, locationId: string): Promise<BalanceRow> {
  await trx
    .insertInto('stock_balances')
    .values({ tenant_id: tenantId, variant_id: variantId, location_id: locationId })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const row = await sql<BalanceRow>`
    select on_hand, reserved, inspection from stock_balances
    where tenant_id = ${tenantId} and variant_id = ${variantId} and location_id = ${locationId}
    for update`.execute(trx);
  return row.rows[0]!;
}

async function applyBalance(
  trx: Tx,
  tenantId: string,
  variantId: string,
  locationId: string,
  delta: { onHand?: number; reserved?: number; inspection?: number },
): Promise<BalanceRow> {
  const r = await sql<BalanceRow>`
    update stock_balances
       set on_hand = on_hand + ${delta.onHand ?? 0},
           reserved = reserved + ${delta.reserved ?? 0},
           inspection = inspection + ${delta.inspection ?? 0},
           version = version + 1,
           updated_at = now()
     where tenant_id = ${tenantId} and variant_id = ${variantId} and location_id = ${locationId}
     returning on_hand, reserved, inspection`.execute(trx);
  return r.rows[0]!;
}

async function movement(
  trx: Tx,
  ctx: StockCtx,
  m: {
    variantId: string; locationId: string; lotId?: string | null; unitId?: string | null; direction: 'in' | 'out';
    kind: MovementKind; bucket: 'available' | 'inspection'; quantity: number; costCents: bigint; physicalAfter: number;
    sourceType: string; sourceId?: string | null; reason?: string | null; reversalOf?: string | null;
  },
): Promise<string> {
  const row = await trx
    .insertInto('stock_movements')
    .values({
      tenant_id: ctx.tenantId,
      variant_id: m.variantId,
      location_id: m.locationId,
      lot_id: m.lotId ?? null,
      unit_id: m.unitId ?? null,
      direction: m.direction,
      kind: m.kind,
      bucket: m.bucket,
      quantity: m.quantity,
      cost_cents: m.costCents,
      physical_after: m.physicalAfter,
      source_type: m.sourceType,
      source_id: m.sourceId ?? null,
      reason: m.reason ?? null,
      reversal_of: m.reversalOf ?? null,
      created_by: ctx.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface StockInInput {
  variantId: string;
  locationId: string;
  quantity: number;
  costCents: bigint;
  bucket: 'available' | 'inspection';
  lotSource: 'purchase_receipt' | 'trade_in' | 'sale_return' | 'adjustment' | 'opening';
  kind: MovementKind;
  sourceType: string;
  sourceId?: string | null;
  unitId?: string | null;
  reason?: string | null;
}

/** Entrada: cria lote (ciclo de aquisição), atualiza saldo e registra movimento. */
export async function stockIn(trx: Tx, ctx: StockCtx, input: StockInInput): Promise<{ lotId: string; movementId: string }> {
  if (input.unitId && input.quantity !== 1) throw invalid('Unidade serializada entra com quantidade 1.');
  await lockBalance(trx, ctx.tenantId, input.variantId, input.locationId);
  const lot = await trx
    .insertInto('inventory_lots')
    .values({
      tenant_id: ctx.tenantId,
      variant_id: input.variantId,
      location_id: input.locationId,
      unit_id: input.unitId ?? null,
      source_type: input.lotSource,
      source_id: input.sourceId ?? null,
      status: input.bucket,
      qty_received: input.quantity,
      qty_remaining: input.quantity,
      cost_received_cents: input.costCents,
      cost_remaining_cents: input.costCents,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const bal = await applyBalance(trx, ctx.tenantId, input.variantId, input.locationId,
    input.bucket === 'available' ? { onHand: input.quantity } : { inspection: input.quantity });
  if (input.unitId) {
    await trx
      .updateTable('inventory_units')
      .set({ current_lot_id: lot.id, status: input.bucket === 'available' ? 'available' : 'inspection', location_id: input.locationId })
      .where('id', '=', input.unitId)
      .execute();
  }
  const movementId = await movement(trx, ctx, {
    variantId: input.variantId,
    locationId: input.locationId,
    lotId: lot.id,
    unitId: input.unitId,
    direction: 'in',
    kind: input.kind,
    bucket: input.bucket,
    quantity: input.quantity,
    costCents: input.costCents,
    physicalAfter: bal.on_hand + bal.inspection,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    reason: input.reason,
  });
  return { lotId: lot.id, movementId };
}

export interface StockOutResult {
  consumptions: (LotConsumption & { unitId: string | null })[];
  costCents: bigint;
}

/**
 * Saída por quantidade (FIFO) com saldo bloqueado. Nunca deixa estoque negativo;
 * reservas de terceiros não podem ser consumidas.
 */
export async function stockOutFifo(
  trx: Tx,
  ctx: StockCtx,
  input: { variantId: string; locationId: string; quantity: number; kind: MovementKind; sourceType: string; sourceId?: string | null; reason?: string | null; consumeReserved?: number },
): Promise<StockOutResult> {
  const bal = await lockBalance(trx, ctx.tenantId, input.variantId, input.locationId);
  const fromReserved = input.consumeReserved ?? 0;
  const freeNeeded = input.quantity - fromReserved;
  if (bal.on_hand - bal.reserved < freeNeeded || bal.reserved < fromReserved)
    throw new AppError('insufficient_stock', `Estoque disponível insuficiente (disponível: ${Math.max(0, bal.on_hand - bal.reserved)}).`);
  const lots = await sql<{ id: string; qty_remaining: number; cost_remaining_cents: bigint }>`
    select id, qty_remaining, cost_remaining_cents from inventory_lots
    where tenant_id = ${ctx.tenantId} and variant_id = ${input.variantId} and location_id = ${input.locationId}
      and status = 'available' and qty_remaining > 0 and unit_id is null
    order by received_at, id
    for update`.execute(trx);
  const consumptions = consumeFifo(
    lots.rows.map((l) => ({ id: l.id, remainingQty: l.qty_remaining, remainingCostCents: l.cost_remaining_cents })),
    input.quantity,
  );
  let physical = bal.on_hand + bal.inspection;
  for (const c of consumptions) {
    await sql`update inventory_lots set qty_remaining = qty_remaining - ${c.quantity}, cost_remaining_cents = cost_remaining_cents - ${c.costCents}
              where tenant_id = ${ctx.tenantId} and id = ${c.lotId}`.execute(trx);
    physical -= c.quantity;
    await movement(trx, ctx, {
      variantId: input.variantId, locationId: input.locationId, lotId: c.lotId, direction: 'out', kind: input.kind, bucket: 'available',
      quantity: c.quantity, costCents: c.costCents, physicalAfter: physical, sourceType: input.sourceType, sourceId: input.sourceId, reason: input.reason,
    });
  }
  await applyBalance(trx, ctx.tenantId, input.variantId, input.locationId, { onHand: -input.quantity, reserved: -fromReserved });
  return { consumptions: consumptions.map((c) => ({ ...c, unitId: null })), costCents: consumptions.reduce((a, c) => a + c.costCents, 0n) };
}

/** Saída de unidade serializada (custo específico). Unidade bloqueada antes da verificação. */
export async function stockOutUnit(
  trx: Tx,
  ctx: StockCtx,
  input: { unitId: string; variantId?: string; kind: MovementKind; sourceType: string; sourceId?: string | null; reason?: string | null; newStatus?: 'sold' | 'lost' | 'returned_to_supplier'; allowReservedBy?: { sourceType: string; sourceId: string } },
): Promise<StockOutResult> {
  const unit = await sql<{ id: string; variant_id: string; location_id: string; status: string; current_lot_id: string | null }>`
    select id, variant_id, location_id, status, current_lot_id from inventory_units
    where tenant_id = ${ctx.tenantId} and id = ${input.unitId} for update`.execute(trx);
  const u = unit.rows[0];
  if (!u) throw notFound('Unidade');
  if (input.variantId && u.variant_id !== input.variantId) throw invalid('Unidade não pertence ao produto escolhido.');
  let fromReserved = 0;
  if (u.status === 'reserved') {
    const res = input.allowReservedBy
      ? await trx.selectFrom('reservations').select('id').where('unit_id', '=', u.id).where('status', '=', 'active')
          .where('source_type', '=', input.allowReservedBy.sourceType).where('source_id', '=', input.allowReservedBy.sourceId).executeTakeFirst()
      : undefined;
    if (!res) throw new AppError('insufficient_stock', 'Unidade reservada para outra operação.');
    await trx.updateTable('reservations').set({ status: 'consumed' }).where('id', '=', res.id).execute();
    fromReserved = 1;
  } else if (u.status !== 'available') {
    throw new AppError('insufficient_stock', 'Unidade não está disponível (já vendida, reservada ou em inspeção).');
  }
  await lockBalance(trx, ctx.tenantId, u.variant_id, u.location_id);
  const lot = await sql<{ id: string; qty_remaining: number; cost_remaining_cents: bigint }>`
    select id, qty_remaining, cost_remaining_cents from inventory_lots where tenant_id = ${ctx.tenantId} and id = ${u.current_lot_id} for update`.execute(trx);
  const l = lot.rows[0];
  if (!l || l.qty_remaining !== 1) throw new AppError('internal', 'Lote da unidade inconsistente.');
  await sql`update inventory_lots set qty_remaining = 0, cost_remaining_cents = 0 where tenant_id = ${ctx.tenantId} and id = ${l.id}`.execute(trx);
  const bal = await applyBalance(trx, ctx.tenantId, u.variant_id, u.location_id, { onHand: -1, reserved: -fromReserved });
  await trx.updateTable('inventory_units').set({ status: input.newStatus ?? 'sold', version: sql`version + 1` }).where('id', '=', u.id).execute();
  await movement(trx, ctx, {
    variantId: u.variant_id, locationId: u.location_id, lotId: l.id, unitId: u.id, direction: 'out', kind: input.kind, bucket: 'available',
    quantity: 1, costCents: l.cost_remaining_cents, physicalAfter: bal.on_hand + bal.inspection, sourceType: input.sourceType, sourceId: input.sourceId, reason: input.reason,
  });
  return { consumptions: [{ lotId: l.id, quantity: 1, costCents: l.cost_remaining_cents, unitId: u.id }], costCents: l.cost_remaining_cents };
}

export interface UnitSpec {
  identifiers?: { kind: 'imei1' | 'imei2' | 'serial' | 'other'; value: string }[];
  condition?: 'new' | 'used' | 'refurbished' | 'defective' | null;
  batteryHealthPct?: number | null;
  accessories?: string | null;
  defects?: string | null;
  checklist?: Record<string, boolean | string>;
  notes?: string | null;
}

export const zUnitSpec = z.object({
  identifiers: z
    .array(z.object({ kind: z.enum(['imei1', 'imei2', 'serial', 'other']), value: zText(64).min(1) }))
    .max(4)
    .default([]),
  condition: z.enum(['new', 'used', 'refurbished', 'defective']).optional().nullable(),
  batteryHealthPct: z.number().int().min(0).max(100).optional().nullable(),
  accessories: zText(500).optional().nullable(),
  defects: zText(1000).optional().nullable(),
  checklist: z.record(z.string().max(60), z.union([z.boolean(), z.string().max(200)])).optional().default({}),
  notes: zText(1000).optional().nullable(),
});

/**
 * Cria unidade ou reabre a identidade existente (recompra/devolução): mesma
 * unidade, novo ciclo de lote. Identificador de unidade em estoque = conflito.
 */
export async function upsertUnitForEntry(trx: Tx, ctx: StockCtx, variantId: string, locationId: string, spec: UnitSpec): Promise<string> {
  const ids = (spec.identifiers ?? []).map((i) => ({ ...i, normalized: normalizeIdentifier(i.value) })).filter((i) => i.normalized);
  const kinds = new Set(ids.map((i) => i.kind));
  if (kinds.size !== ids.length) throw invalid('Tipo de identificador repetido na mesma unidade.');
  let existingUnit: { id: string; status: string; variant_id: string } | undefined;
  for (const i of ids) {
    const found = await trx
      .selectFrom('unit_identifiers as ui')
      .innerJoin('inventory_units as u', 'u.id', 'ui.unit_id')
      .select(['u.id', 'u.status', 'u.variant_id'])
      .where('ui.kind', '=', i.kind)
      .where('ui.normalized', '=', i.normalized)
      .forUpdate()
      .executeTakeFirst();
    if (found) {
      if (existingUnit && existingUnit.id !== found.id) throw conflict('Identificadores pertencem a unidades diferentes.');
      existingUnit = found;
    }
  }
  const unitFields = {
    condition: spec.condition ?? null,
    battery_health_pct: spec.batteryHealthPct ?? null,
    accessories: spec.accessories ?? null,
    defects: spec.defects ?? null,
    checklist: JSON.stringify(spec.checklist ?? {}),
    notes: spec.notes ?? null,
  };
  if (existingUnit) {
    if (!['sold', 'returned_to_supplier', 'lost'].includes(existingUnit.status))
      throw conflict('Já existe unidade em estoque com este identificador.');
    if (existingUnit.variant_id !== variantId) throw conflict('Identificador já registrado para outro produto.');
    await trx.updateTable('inventory_units').set({ ...unitFields, status: 'inspection', location_id: locationId }).where('id', '=', existingUnit.id).execute();
    for (const i of ids) {
      await trx
        .insertInto('unit_identifiers')
        .values({ tenant_id: ctx.tenantId, unit_id: existingUnit.id, kind: i.kind, value: i.value, normalized: i.normalized })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    return existingUnit.id;
  }
  const n = await nextNumber(trx, ctx.tenantId, 'unit');
  const unit = await trx
    .insertInto('inventory_units')
    .values({
      tenant_id: ctx.tenantId,
      variant_id: variantId,
      location_id: locationId,
      internal_code: `U-${n.toString().padStart(6, '0')}`,
      status: 'inspection',
      ...unitFields,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const i of ids) {
    await trx.insertInto('unit_identifiers').values({ tenant_id: ctx.tenantId, unit_id: unit.id, kind: i.kind, value: i.value, normalized: i.normalized }).execute();
  }
  return unit.id;
}

/** Libera item da inspeção para venda (lote e unidade ficam disponíveis). */
export async function releaseInspection(deps: AppDeps, actor: Actor, input: { lotId: string; notes?: string }) {
  if (!can(actor, 'purchases.receive') && !can(actor, 'inventory.adjust')) requirePermission(actor, 'inventory.adjust');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const lot = await trx.selectFrom('inventory_lots').selectAll().where('id', '=', input.lotId).forUpdate().executeTakeFirst();
    if (!lot) throw notFound('Lote');
    if (lot.status !== 'inspection' || lot.qty_remaining === 0) throw conflict('Lote não está em inspeção.');
    await lockBalance(trx, actor.tenantId, lot.variant_id, lot.location_id);
    await trx.updateTable('inventory_lots').set({ status: 'available' }).where('id', '=', lot.id).execute();
    const bal = await applyBalance(trx, actor.tenantId, lot.variant_id, lot.location_id, { inspection: -lot.qty_remaining, onHand: lot.qty_remaining });
    if (lot.unit_id) await trx.updateTable('inventory_units').set({ status: 'available' }).where('id', '=', lot.unit_id).execute();
    await movement(trx, actor, {
      variantId: lot.variant_id, locationId: lot.location_id, lotId: lot.id, unitId: lot.unit_id, direction: 'in', kind: 'inspection_release',
      bucket: 'available', quantity: lot.qty_remaining, costCents: lot.cost_remaining_cents, physicalAfter: bal.on_hand + bal.inspection,
      sourceType: 'inspection', sourceId: lot.id, reason: input.notes ?? null,
    });
    await audit(trx, actor, 'inventory.inspection_released', 'lot', lot.id, { qty: lot.qty_remaining });
  });
}

/** Itens em inspeção/quarentena aguardando liberação. */
export async function listInspection(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, (trx) =>
    trx
      .selectFrom('inventory_lots as l')
      .innerJoin('product_variants as v', 'v.id', 'l.variant_id')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .leftJoin('inventory_units as u', 'u.id', 'l.unit_id')
      .select([
        'l.id as lot_id', 'l.source_type', 'l.source_id', 'l.received_at', 'l.qty_remaining', 'p.name', 'v.sku', 'u.internal_code', 'u.condition', 'u.defects',
        ...(showCost ? (['l.cost_remaining_cents'] as const) : []),
      ])
      .where('l.status', '=', 'inspection')
      .where('l.qty_remaining', '>', 0)
      .orderBy('l.received_at')
      .execute(),
  );
}

// ---------------------------------------------------------------------------
// Ajustes

export const zAdjustment = z.object({
  variantId: zUuid,
  direction: z.enum(['in', 'out']),
  kind: z.enum(['adjustment', 'loss', 'opening']).default('adjustment'),
  quantity: zQty,
  unitCostCents: zCentsNonNeg.optional(),
  unitId: zUuid.optional(),
  unit: zUnitSpec.optional(),
  reason: zText(500).min(3, 'Informe o motivo'),
});

/**
 * Ajuste auditado com motivo. Saída por perda gera despesa de perda (custo
 * histórico) na competência; entrada exige custo informado.
 */
export async function adjustStock(deps: AppDeps, actor: Actor, input: z.infer<typeof zAdjustment>) {
  requirePermission(actor, 'inventory.adjust');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const v = await trx
      .selectFrom('product_variants as v')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .select(['v.id', 'p.tracking', 'p.kind', 'p.name'])
      .where('v.id', '=', input.variantId)
      .executeTakeFirst();
    if (!v) throw notFound('Produto');
    if (v.kind === 'service') throw invalid('Serviço não movimenta estoque.');
    const loc = await defaultLocation(trx);
    if (input.direction === 'in') {
      if (input.kind === 'loss') throw invalid('Perda é sempre saída.');
      if (input.unitCostCents === undefined) throw invalid('Informe o custo unitário da entrada.', { unitCostCents: 'obrigatório' });
      if (v.tracking === 'serialized') {
        if (input.quantity !== 1) throw invalid('Unidade serializada: ajuste uma unidade por vez.');
        const unitId = await upsertUnitForEntry(trx, actor, v.id, loc, input.unit ?? {});
        const r = await stockIn(trx, actor, {
          variantId: v.id, locationId: loc, quantity: 1, costCents: input.unitCostCents, bucket: 'available',
          lotSource: input.kind === 'opening' ? 'opening' : 'adjustment', kind: 'adjustment_in', sourceType: 'adjustment', unitId, reason: input.reason,
        });
        await audit(trx, actor, 'inventory.adjusted_in', 'variant', v.id, { qty: 1, unitId, reason: input.reason });
        return { lotId: r.lotId, unitId };
      }
      const r = await stockIn(trx, actor, {
        variantId: v.id, locationId: loc, quantity: input.quantity, costCents: input.unitCostCents * BigInt(input.quantity), bucket: 'available',
        lotSource: input.kind === 'opening' ? 'opening' : 'adjustment', kind: 'adjustment_in', sourceType: 'adjustment', reason: input.reason,
      });
      await audit(trx, actor, 'inventory.adjusted_in', 'variant', v.id, { qty: input.quantity, reason: input.reason });
      return { lotId: r.lotId };
    }
    const kind: MovementKind = input.kind === 'loss' ? 'loss' : 'adjustment_out';
    const out =
      v.tracking === 'serialized'
        ? await (async () => {
            if (!input.unitId) throw invalid('Escolha a unidade a baixar.', { unitId: 'obrigatório' });
            return stockOutUnit(trx, actor, { unitId: input.unitId, variantId: v.id, kind, sourceType: 'adjustment', reason: input.reason, newStatus: 'lost' });
          })()
        : await stockOutFifo(trx, actor, { variantId: v.id, locationId: loc, quantity: input.quantity, kind, sourceType: 'adjustment', reason: input.reason });
    if (out.costCents > 0n) {
      await trx
        .insertInto('expenses')
        .values({
          tenant_id: actor.tenantId,
          kind: 'inventory_loss',
          description: `${input.kind === 'loss' ? 'Perda' : 'Ajuste de saída'}: ${v.name}`,
          competence_date: todayLocal(actor.timezone),
          amount_cents: out.costCents,
          source_type: 'stock_adjustment',
          source_id: out.consumptions[0]!.lotId,
          notes: input.reason,
          created_by: actor.userId,
        })
        .execute();
    }
    await audit(trx, actor, 'inventory.adjusted_out', 'variant', v.id, { qty: input.quantity, kind, cost: out.costCents, reason: input.reason });
    return { costCents: out.costCents };
  });
}

// ---------------------------------------------------------------------------
// Inventário físico

export async function startInventoryCount(deps: AppDeps, actor: Actor, notes?: string) {
  requirePermission(actor, 'inventory.adjust');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const loc = await defaultLocation(trx);
    const open = await trx.selectFrom('inventory_counts').select('id').where('status', '=', 'draft').executeTakeFirst();
    if (open) throw conflict('Já existe um inventário em andamento.');
    const c = await trx
      .insertInto('inventory_counts')
      .values({ tenant_id: actor.tenantId, location_id: loc, notes: notes ?? null, created_by: actor.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Somente itens por quantidade; serializados são conferidos por unidade.
    await sql`
      insert into inventory_count_items (tenant_id, count_id, variant_id, expected_qty, counted_qty)
      select ${actor.tenantId}, ${c.id}, v.id, coalesce(b.on_hand, 0), coalesce(b.on_hand, 0)
      from product_variants v join products p on p.id = v.product_id
      left join stock_balances b on b.variant_id = v.id and b.location_id = ${loc}
      where p.kind = 'physical' and p.tracking = 'quantity' and p.status <> 'archived' and v.status = 'active'`.execute(trx);
    await audit(trx, actor, 'inventory.count_started', 'inventory_count', c.id);
    return { id: c.id };
  });
}

export async function getInventoryCount(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'inventory.adjust');
  return tx(deps, actor, async (trx) => {
    const count = await trx.selectFrom('inventory_counts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!count) throw notFound('Inventário');
    const items = await trx
      .selectFrom('inventory_count_items as i')
      .innerJoin('product_variants as v', 'v.id', 'i.variant_id')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .select(['i.id', 'i.variant_id', 'p.name', 'v.sku', 'i.expected_qty', 'i.counted_qty'])
      .where('i.count_id', '=', id)
      .orderBy('p.name')
      .execute();
    return { count, items };
  });
}

export async function recordCount(deps: AppDeps, actor: Actor, id: string, items: { variantId: string; countedQty: number }[]) {
  requirePermission(actor, 'inventory.adjust');
  return tx(deps, actor, async (trx) => {
    const c = await trx.selectFrom('inventory_counts').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!c || c.status !== 'draft') throw conflict('Inventário não está em andamento.');
    for (const i of items) {
      if (!Number.isInteger(i.countedQty) || i.countedQty < 0) throw invalid('Quantidade contada inválida.');
      await trx.updateTable('inventory_count_items').set({ counted_qty: i.countedQty }).where('count_id', '=', id).where('variant_id', '=', i.variantId).execute();
    }
  });
}

/** Confirma divergências revisadas: gera ajustes auditados (perda para faltas). */
export async function confirmInventoryCount(deps: AppDeps, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'inventory.adjust');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const c = await trx.selectFrom('inventory_counts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!c || c.status !== 'draft') throw conflict('Inventário não está em andamento.');
    const items = await trx.selectFrom('inventory_count_items').selectAll().where('count_id', '=', id).orderBy('variant_id').execute();
    let adjustments = 0;
    for (const item of items) {
      const bal = await lockBalance(trx, actor.tenantId, item.variant_id, c.location_id);
      const diff = item.counted_qty - bal.on_hand;
      if (diff === 0) continue;
      adjustments++;
      if (diff < 0) {
        const out = await stockOutFifo(trx, actor, { variantId: item.variant_id, locationId: c.location_id, quantity: -diff, kind: 'loss', sourceType: 'inventory_count', sourceId: id, reason });
        if (out.costCents > 0n)
          await trx.insertInto('expenses').values({
            tenant_id: actor.tenantId, kind: 'inventory_loss', description: 'Diferença de inventário', competence_date: todayLocal(actor.timezone),
            amount_cents: out.costCents, source_type: 'inventory_count', source_id: id, notes: reason, created_by: actor.userId,
          }).execute();
      } else {
        // Sobra: entra ao custo médio atual disponível (ou zero sem base), documentado no motivo.
        const avg = await sql<{ c: bigint | null }>`
          select case when sum(qty_remaining) > 0 then sum(cost_remaining_cents) / sum(qty_remaining) end as c
          from inventory_lots where variant_id = ${item.variant_id} and qty_remaining > 0 and status = 'available'`.execute(trx);
        const unit = avg.rows[0]?.c ?? 0n;
        await stockIn(trx, actor, {
          variantId: item.variant_id, locationId: c.location_id, quantity: diff, costCents: unit * BigInt(diff), bucket: 'available',
          lotSource: 'adjustment', kind: 'adjustment_in', sourceType: 'inventory_count', sourceId: id, reason,
        });
      }
    }
    await trx.updateTable('inventory_counts').set({ status: 'confirmed', confirmed_at: new Date(), confirmed_by: actor.userId }).where('id', '=', id).execute();
    await audit(trx, actor, 'inventory.count_confirmed', 'inventory_count', id, { adjustments, reason });
    return { adjustments };
  });
}

export const zMovementList = zPageQuery.extend({
  variantId: zUuid.optional(),
  kind: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function listMovements(deps: AppDeps, actor: Actor, q: z.infer<typeof zMovementList>) {
  requirePermission(actor, 'products.view');
  const showCost = can(actor, 'costs.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('stock_movements as m')
      .innerJoin('product_variants as v', 'v.id', 'm.variant_id')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .leftJoin('inventory_units as u', 'u.id', 'm.unit_id')
      .select([
        'm.id', 'm.created_at', 'm.direction', 'm.kind', 'm.bucket', 'm.quantity', 'm.physical_after', 'm.source_type', 'm.source_id',
        'm.reason', 'p.name', 'v.sku', 'u.internal_code',
        ...(showCost ? (['m.cost_cents'] as const) : []),
      ]);
    if (q.variantId) query = query.where('m.variant_id', '=', q.variantId);
    if (q.kind) query = query.where('m.kind', '=', q.kind);
    const rows = await query.orderBy('m.created_at', 'desc').orderBy('m.id', 'desc').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

// ---------------------------------------------------------------------------
// Reservas (pedidos não entregues e pedidos públicos)

export async function reserve(
  trx: Tx,
  ctx: StockCtx,
  input: { variantId: string; unitId?: string | null; quantity: number; sourceType: string; sourceId: string; expiresAt: Date },
): Promise<string> {
  const loc = await defaultLocation(trx);
  if (input.unitId) {
    const u = await sql<{ status: string; variant_id: string }>`select status, variant_id from inventory_units where tenant_id = ${ctx.tenantId} and id = ${input.unitId} for update`.execute(trx);
    if (!u.rows[0] || u.rows[0].status !== 'available') throw new AppError('insufficient_stock', 'Unidade indisponível para reserva.');
    await lockBalance(trx, ctx.tenantId, u.rows[0].variant_id, loc);
    await trx.updateTable('inventory_units').set({ status: 'reserved' }).where('id', '=', input.unitId).execute();
    await applyBalance(trx, ctx.tenantId, u.rows[0].variant_id, loc, { reserved: 1 });
  } else {
    const bal = await lockBalance(trx, ctx.tenantId, input.variantId, loc);
    if (bal.on_hand - bal.reserved < input.quantity) throw new AppError('insufficient_stock', 'Estoque insuficiente para reservar.');
    await applyBalance(trx, ctx.tenantId, input.variantId, loc, { reserved: input.quantity });
  }
  const r = await trx
    .insertInto('reservations')
    .values({
      tenant_id: ctx.tenantId, source_type: input.sourceType, source_id: input.sourceId, variant_id: input.variantId, location_id: loc,
      unit_id: input.unitId ?? null, quantity: input.quantity, expires_at: input.expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

/** Libera reservas ativas de uma origem (cancelamento, expiração ou antes de confirmar). */
export async function releaseReservations(trx: Tx, ctx: StockCtx, sourceType: string, sourceId: string, status: 'released' | 'expired' = 'released'): Promise<number> {
  const rows = await trx
    .selectFrom('reservations')
    .selectAll()
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .where('status', '=', 'active')
    .orderBy('variant_id')
    .forUpdate()
    .execute();
  for (const r of rows) {
    await lockBalance(trx, ctx.tenantId, r.variant_id, r.location_id);
    await applyBalance(trx, ctx.tenantId, r.variant_id, r.location_id, { reserved: -r.quantity });
    if (r.unit_id) await trx.updateTable('inventory_units').set({ status: 'available' }).where('id', '=', r.unit_id).where('status', '=', 'reserved').execute();
    await trx.updateTable('reservations').set({ status }).where('id', '=', r.id).execute();
  }
  return rows.length;
}

/** Saída de um lote específico inteiro (reversão de entrada). Exige lote intacto. */
export async function stockOutWholeLot(trx: Tx, ctx: StockCtx, lotId: string, input: { kind: MovementKind; sourceType: string; sourceId: string; reason: string; unitStatus?: 'returned_to_supplier' | 'lost' }) {
  const lot = await trx.selectFrom('inventory_lots').selectAll().where('id', '=', lotId).forUpdate().executeTakeFirst();
  if (!lot) throw notFound('Lote');
  if (lot.qty_remaining !== lot.qty_received) throw conflict('Item recebido já foi vendido ou consumido; estorno simples bloqueado.');
  await lockBalance(trx, ctx.tenantId, lot.variant_id, lot.location_id);
  if (lot.unit_id) {
    const u = await sql<{ status: string }>`select status from inventory_units where tenant_id = ${ctx.tenantId} and id = ${lot.unit_id} for update`.execute(trx);
    if (!u.rows[0] || !['inspection', 'available'].includes(u.rows[0].status)) throw conflict('Unidade recebida não está mais disponível; estorno simples bloqueado.');
    await trx.updateTable('inventory_units').set({ status: input.unitStatus ?? 'returned_to_supplier' }).where('id', '=', lot.unit_id).execute();
  }
  await sql`update inventory_lots set qty_remaining = 0, cost_remaining_cents = 0 where tenant_id = ${ctx.tenantId} and id = ${lot.id}`.execute(trx);
  const bal = await applyBalance(trx, ctx.tenantId, lot.variant_id, lot.location_id,
    lot.status === 'available' ? { onHand: -lot.qty_remaining } : { inspection: -lot.qty_remaining });
  if (bal.reserved > bal.on_hand) throw conflict('Estoque reservado impede o estorno.');
  await movement(trx, ctx, {
    variantId: lot.variant_id, locationId: lot.location_id, lotId: lot.id, unitId: lot.unit_id, direction: 'out', kind: input.kind,
    bucket: lot.status as 'available' | 'inspection', quantity: lot.qty_remaining, costCents: lot.cost_remaining_cents,
    physicalAfter: bal.on_hand + bal.inspection, sourceType: input.sourceType, sourceId: input.sourceId, reason: input.reason,
  });
  return { costCents: lot.cost_remaining_cents };
}
