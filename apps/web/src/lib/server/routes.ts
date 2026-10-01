import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import * as A from '@gct/app';
import { AppError, HEX_COLOR, NARRATION_SPEED, PERMISSIONS, ROLE_LABELS, ROLES, speechScript } from '@gct/shared';
import { clientIp, fileResponse, getSession, queryObject, rateLimit, TENANT_COOKIE, type RouteDef } from './http';

const p = A.parse;
const zId = z.object({ id: z.string().uuid() });
const id = (params: Record<string, string>) => p(zId, params).id;
const zReason = z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(500) });

async function setTenantCookie(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.APP_URL ?? '').startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

export const routes: RouteDef[] = [
  // ---------------------------------------------------------------- sessão e empresas
  {
    method: 'GET', path: 'me', noTenant: true,
    handler: async ({ deps, session, requestId }) => {
      const tenants = await A.listTenantsForUser(deps, session.user.id);
      const jar = await cookies();
      const selected = jar.get(TENANT_COOKIE)?.value ?? (tenants.length === 1 ? tenants[0]!.id : undefined);
      let current = null;
      if (selected && tenants.some((t) => t.id === selected)) {
        const actor = await A.resolveActor(deps, session.user.id, selected, requestId);
        const profile = await A.getTenantProfile(deps, actor);
        current = {
          id: actor.tenantId, name: profile.name, slug: profile.slug, timezone: actor.timezone, status: actor.tenantStatus, role: actor.role,
          roleLabel: ROLE_LABELS[actor.role], permissions: [...actor.permissions], discountLimitBps: actor.discountLimitBps,
        };
      }
      return { user: session.user, tenants, current };
    },
  },
  {
    method: 'POST', path: 'session/tenant', noTenant: true,
    handler: async ({ deps, session, body, requestId }) => {
      const { tenantId } = p(z.object({ tenantId: z.string().uuid() }), await body());
      await A.resolveActor(deps, session.user.id, tenantId, requestId);
      await setTenantCookie(tenantId);
      return { tenantId };
    },
  },
  {
    method: 'POST', path: 'tenants', noTenant: true, rate: { max: 5, windowMs: 3600_000 },
    handler: async ({ deps, session, body }) => {
      const input = p(z.object({ name: z.string().trim().min(2).max(120), timezone: z.string().max(64).optional(), document: z.string().max(20).optional(), referralCode: z.string().trim().max(12).optional() }), await body());
      const r = await A.provisionTenant(deps, session.user.id, input);
      await setTenantCookie(r.tenantId);
      return r;
    },
  },
  {
    method: 'POST', path: 'invites/accept', noTenant: true, rate: { max: 10, windowMs: 600_000 },
    handler: async ({ deps, session, body }) => {
      const { token } = p(z.object({ token: z.string().min(20).max(200) }), await body());
      const r = await A.acceptInvite(deps, { id: session.user.id, email: session.user.email }, token);
      await setTenantCookie(r.tenantId);
      return r;
    },
  },

  // ---------------------------------------------------------------- empresa, equipe, plano
  { method: 'GET', path: 'tenant', handler: ({ deps, actor }) => A.getTenantProfile(deps, actor) },
  {
    method: 'PUT', path: 'tenant',
    handler: async ({ deps, actor, body }) => {
      const input = p(
        z.object({
          name: z.string().trim().min(2).max(120).optional(),
          legalName: z.string().trim().max(160).nullable().optional(),
          document: z.string().trim().max(20).nullable().optional(),
          timezone: z.string().max(64).optional(),
          email: z.string().trim().email().max(160).nullable().optional().or(z.literal('')),
          phone: z.string().trim().max(30).nullable().optional(),
          address: z.record(z.string().max(30), z.string().max(160)).optional(),
          settings: z
            .object({
              revenueGoalCents: z.string().regex(/^\d{1,12}$/).nullable().optional(),
              warrantyTerms: z.string().max(2000).nullable().optional(),
              receiptFooter: z.string().max(500).nullable().optional(),
              listing: z
                .object({
                  condition: z.enum(['new', 'semi_new']),
                  warrantyMonths: z.number().int().min(0).max(36),
                  delivery: z.string().trim().max(160),
                  cardInstallments: z.number().int().min(0).max(24),
                  extra: z.string().trim().max(500),
                  highlight: z.string().trim().max(160).optional(),
                })
                .nullable()
                .optional(),
              brandColors: z
                .object({ primary: z.string().regex(HEX_COLOR), secondary: z.string().regex(HEX_COLOR), accent: z.string().regex(HEX_COLOR) })
                .nullable()
                .optional(),
              flyer: z
                .object({
                  title: z.string().trim().max(40),
                  subtitle: z.string().trim().max(60),
                  footer: z.string().trim().max(160),
                  validity: z.string().trim().max(80),
                  cardSurchargeBps: z.number().int().min(0).max(3000),
                  cardInstallments: z.number().int().min(0).max(24),
                  order: z.array(z.string().uuid()).max(500).optional(),
                  featured: z.array(z.string().uuid()).max(2).optional(),
                  narration: z.string().trim().max(600).optional(),
                  voice: z.enum(['pf_dora', 'pm_alex', 'pm_santa']).optional(),
                  voiceStyle: z.enum(['comercial', 'natural']).optional(),
                  music: z.boolean().optional(),
                  pronunciation: z.string().max(2000).optional(),
                })
                .nullable()
                .optional(),
            })
            .optional(),
        }),
        await body(),
      );
      await A.updateTenantProfile(deps, actor, { ...input, email: input.email === undefined ? undefined : input.email || null });
    },
  },
  {
    method: 'POST', path: 'tenant/logo', rate: { max: 30, windowMs: 3600_000 },
    handler: async ({ deps, actor, req }) => {
      const ct = req.headers.get('content-type') ?? '';
      if (!ct.startsWith('multipart/form-data')) throw new AppError('validation_failed', 'Envie a logo como multipart/form-data.');
      const len = Number(req.headers.get('content-length') ?? 0);
      if (len > 6 * 1024 * 1024) throw new AppError('validation_failed', 'Imagem deve ter até 5 MB.');
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new AppError('validation_failed', 'Arquivo ausente.');
      return A.setBrandLogo(deps, actor, Buffer.from(await file.arrayBuffer()), file.name);
    },
  },
  { method: 'DELETE', path: 'tenant/logo', handler: ({ deps, actor }) => A.removeBrandLogo(deps, actor) },
  { method: 'GET', path: 'flyer/products', handler: ({ deps, actor }) => A.listFlyerProducts(deps, actor) },
  {
    // Narração do vídeo do encarte: encaminha o texto ao serviço interno de voz (container tts) e devolve WAV.
    method: 'POST', path: 'flyer/narration', rate: { max: 60, windowMs: 3600_000 },
    handler: async ({ actor, body }) => {
      A.requirePermission(actor, 'catalog.manage');
      const input = p(z.object({
        text: z.string().trim().min(3, 'Escreva o texto da narração').max(600, 'Texto muito longo (máx. 600 caracteres)'),
        voice: z.enum(['pf_dora', 'pm_alex', 'pm_santa']).default('pf_dora'),
        style: z.enum(['comercial', 'natural']).default('natural'),
        speed: z.number().min(0.7).max(1.3).optional(),
        pronunciation: z.string().max(2000).optional(),
      }), await body());
      const tts = { text: speechScript(input.text, input.style, input.pronunciation), voice: input.voice, style: input.style, speed: input.speed ?? NARRATION_SPEED[input.style] };
      if (!tts.text) throw new AppError('validation_failed', 'Escreva o texto da narração.');
      const base = process.env.TTS_URL;
      if (!base) throw new AppError('unavailable', 'Narração indisponível neste servidor.');
      let res: Response;
      try {
        res = await fetch(`${base.replace(/\/$/, '')}/synthesize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tts), signal: AbortSignal.timeout(90_000) });
      } catch {
        throw new AppError('unavailable', 'O serviço de voz não respondeu. Tente de novo em instantes.');
      }
      if (!res.ok) throw new AppError('unavailable', 'Não foi possível gerar a narração agora.');
      return new Response(await res.arrayBuffer(), { headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    },
  },
  { method: 'POST', path: 'tenant/onboarding/dismiss', handler: ({ deps, actor }) => A.dismissOnboarding(deps, actor) },
  {
    method: 'GET', path: 'members',
    handler: async ({ deps, actor }) => ({ ...(await A.listMembers(deps, actor)), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] })), permissions: PERMISSIONS }),
  },
  {
    method: 'POST', path: 'members/invites', rate: { max: 20, windowMs: 3600_000 },
    handler: async ({ deps, actor, body }) => {
      const input = p(z.object({ email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(), role: z.enum(A.ROLES_FOR_INVITE), label: z.string().trim().max(80).optional().nullable() }), await body());
      return A.createInvite(deps, actor, input, process.env.APP_URL ?? 'http://localhost:3000');
    },
  },
  { method: 'DELETE', path: 'members/invites/:id', handler: ({ deps, actor, params }) => A.revokeInvite(deps, actor, id(params)) },
  {
    method: 'PATCH', path: 'members/:id',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(
        z.object({
          role: z.enum(ROLES).optional(),
          grants: z.array(z.enum(PERMISSIONS)).optional(),
          revokes: z.array(z.enum(PERMISSIONS)).optional(),
          discountLimitBps: z.number().int().min(0).max(10000).optional(),
          remove: z.boolean().optional(),
        }),
        await body(),
      );
      await A.updateMember(deps, actor, id(params), input);
    },
  },
  { method: 'GET', path: 'billing', handler: ({ deps, actor }) => A.getBillingOverview(deps, actor) },
  {
    method: 'POST', path: 'billing/cancel',
    handler: async ({ deps, actor, body }) => A.setCancelAtPeriodEnd(deps, actor, p(z.object({ cancel: z.boolean() }), await body()).cancel),
  },
  { method: 'GET', path: 'audit', handler: ({ deps, actor, query }) => A.listAudit(deps, actor, p(A.zAuditList, queryObject(query))) },
  { method: 'GET', path: 'notifications', handler: ({ deps, actor }) => A.listNotifications(deps, actor) },
  { method: 'POST', path: 'notifications/read-all', handler: ({ deps, actor }) => A.markNotificationRead(deps, actor, 'all') },
  { method: 'POST', path: 'notifications/:id/read', handler: ({ deps, actor, params }) => A.markNotificationRead(deps, actor, id(params)) },

  // ---------------------------------------------------------------- catálogo
  { method: 'GET', path: 'categories', handler: ({ deps, actor }) => A.listCategories(deps, actor) },
  { method: 'POST', path: 'categories', handler: async ({ deps, actor, body }) => A.createCategory(deps, actor, p(A.zCategory, await body())) },
  { method: 'PATCH', path: 'categories/:id', handler: async ({ deps, actor, params, body }) => A.renameCategory(deps, actor, id(params), p(A.zCategory, await body())) },
  {
    method: 'POST', path: 'categories/:id/archive',
    handler: async ({ deps, actor, params, body }) => {
      const { reassignTo } = p(z.object({ reassignTo: z.string().uuid().nullable().optional() }), await body());
      await A.archiveCategory(deps, actor, id(params), reassignTo);
    },
  },
  { method: 'GET', path: 'products', handler: ({ deps, actor, query }) => A.listProducts(deps, actor, p(A.zProductList, queryObject(query))) },
  { method: 'POST', path: 'products', handler: async ({ deps, actor, body }) => A.createProduct(deps, actor, p(A.zProduct, await body())) },
  {
    method: 'GET', path: 'products/search',
    handler: ({ deps, actor, query }) => A.searchSellable(deps, actor, (query.get('q') ?? '').slice(0, 80), { includeInactive: query.get('inactive') === '1' }),
  },
  { method: 'GET', path: 'products/:id', handler: ({ deps, actor, params }) => A.getProduct(deps, actor, id(params)) },
  {
    method: 'PUT', path: 'products/:id',
    handler: async ({ deps, actor, params, body }) => {
      const raw = (await body()) as Record<string, unknown>;
      const input = p(A.zProduct.extend({ version: z.number().int().optional() }), raw);
      await A.updateProduct(deps, actor, id(params), input);
    },
  },
  { method: 'DELETE', path: 'products/:id', handler: ({ deps, actor, params }) => A.deleteProduct(deps, actor, id(params)) },
  {
    method: 'POST', path: 'products/:id/status',
    handler: async ({ deps, actor, params, body }) => A.setProductStatus(deps, actor, id(params), p(z.object({ status: z.enum(['active', 'inactive', 'archived']) }), await body()).status),
  },
  {
    method: 'POST', path: 'products/:id/images', rate: { max: 60, windowMs: 3600_000 },
    handler: async ({ deps, actor, params, req }) => {
      const ct = req.headers.get('content-type') ?? '';
      if (!ct.startsWith('multipart/form-data')) throw new AppError('validation_failed', 'Envie a foto como multipart/form-data.');
      const len = Number(req.headers.get('content-length') ?? 0);
      if (len > 6 * 1024 * 1024) throw new AppError('validation_failed', 'Imagem deve ter até 5 MB.');
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new AppError('validation_failed', 'Arquivo ausente.');
      return A.addProductImage(deps, actor, id(params), Buffer.from(await file.arrayBuffer()), file.name);
    },
  },
  {
    method: 'DELETE', path: 'products/:id/images/:imageId',
    handler: ({ deps, actor, params }) => A.removeProductImage(deps, actor, id(params), p(z.object({ imageId: z.string().uuid() }), params).imageId),
  },
  {
    method: 'GET', path: 'attachments/:id',
    handler: async ({ deps, actor, params }) => {
      const f = await A.readAttachment(deps, actor, id(params));
      return new Response(new Uint8Array(f.data), { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
    },
  },
  { method: 'GET', path: 'products/:id/history', handler: ({ deps, actor, params }) => A.productHistory(deps, actor, id(params)) },
  { method: 'GET', path: 'variants/:id', handler: ({ deps, actor, params }) => A.getSellableVariant(deps, actor, id(params)) },
  { method: 'GET', path: 'variants/:id/units', handler: ({ deps, actor, params }) => A.availableUnits(deps, actor, id(params)) },

  // ---------------------------------------------------------------- pessoas
  { method: 'GET', path: 'parties', handler: ({ deps, actor, query }) => A.listParties(deps, actor, p(A.zPartyList, queryObject(query))) },
  { method: 'POST', path: 'parties', handler: async ({ deps, actor, body }) => A.createParty(deps, actor, p(A.zParty, await body())) },
  { method: 'GET', path: 'parties/:id', handler: ({ deps, actor, params }) => A.getParty(deps, actor, id(params)) },
  { method: 'PUT', path: 'parties/:id', handler: async ({ deps, actor, params, body }) => A.updateParty(deps, actor, id(params), p(A.zParty, await body())) },
  {
    method: 'POST', path: 'parties/:id/status',
    handler: async ({ deps, actor, params, body }) => A.setPartyStatus(deps, actor, id(params), p(z.object({ status: z.enum(['active', 'archived']) }), await body()).status),
  },
  {
    method: 'POST', path: 'parties/:id/store-credit',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(z.object({ amountCents: A.zCents, reason: z.string().trim().min(3).max(300) }), await body());
      await A.adjustStoreCredit(deps, actor, id(params), input.amountCents, input.reason);
    },
  },

  // ---------------------------------------------------------------- estoque
  { method: 'GET', path: 'inventory/movements', handler: ({ deps, actor, query }) => A.listMovements(deps, actor, p(A.zMovementList, queryObject(query))) },
  { method: 'GET', path: 'inventory/inspection', handler: ({ deps, actor }) => A.listInspection(deps, actor) },
  {
    method: 'POST', path: 'inventory/inspection/:id/release',
    handler: async ({ deps, actor, params, body }) => A.releaseInspection(deps, actor, { lotId: id(params), notes: p(z.object({ notes: z.string().max(500).optional() }), await body()).notes }),
  },
  { method: 'POST', path: 'inventory/adjustments', handler: async ({ deps, actor, body }) => A.adjustStock(deps, actor, p(A.zAdjustment, await body())) },
  {
    method: 'POST', path: 'inventory/counts',
    handler: async ({ deps, actor, body }) => A.startInventoryCount(deps, actor, p(z.object({ notes: z.string().max(500).optional() }), await body()).notes),
  },
  { method: 'GET', path: 'inventory/counts/:id', handler: ({ deps, actor, params }) => A.getInventoryCount(deps, actor, id(params)) },
  {
    method: 'PUT', path: 'inventory/counts/:id',
    handler: async ({ deps, actor, params, body }) =>
      A.recordCount(deps, actor, id(params), p(z.object({ items: z.array(z.object({ variantId: z.string().uuid(), countedQty: z.number().int().min(0) })).max(5000) }), await body()).items),
  },
  {
    method: 'POST', path: 'inventory/counts/:id/confirm',
    handler: async ({ deps, actor, params, body }) => A.confirmInventoryCount(deps, actor, id(params), p(zReason, await body()).reason),
  },
  {
    method: 'POST', path: 'inventory/acquisition-costs',
    handler: async ({ deps, actor, body, idempotencyKey }) => A.addAcquisitionCost(deps, actor, p(A.zAcquisitionCost, await body()), idempotencyKey),
  },

  // ---------------------------------------------------------------- compras
  { method: 'GET', path: 'purchases', handler: ({ deps, actor, query }) => A.listPurchases(deps, actor, p(A.zPurchaseList, queryObject(query))) },
  { method: 'POST', path: 'purchases', handler: async ({ deps, actor, body }) => A.createPurchaseDraft(deps, actor, p(A.zPurchase, await body())) },
  {
    method: 'POST', path: 'purchases/quick',
    handler: async ({ deps, actor, body, idempotencyKey }) =>
      A.quickPurchase(deps, actor, p(A.zPurchase.extend({ destination: z.enum(['available', 'inspection']).optional() }), await body()), idempotencyKey),
  },
  { method: 'GET', path: 'purchases/:id', handler: ({ deps, actor, params }) => A.getPurchase(deps, actor, id(params)) },
  {
    method: 'PUT', path: 'purchases/:id',
    handler: async ({ deps, actor, params, body }) => A.updatePurchaseDraft(deps, actor, id(params), p(A.zPurchase.extend({ version: z.number().int().optional() }), await body())),
  },
  { method: 'POST', path: 'purchases/:id/approve', handler: ({ deps, actor, params, idempotencyKey }) => A.approvePurchase(deps, actor, id(params), idempotencyKey) },
  {
    method: 'POST', path: 'purchases/:id/receive',
    handler: async ({ deps, actor, params, body, idempotencyKey }) => A.receivePurchase(deps, actor, id(params), p(A.zReceive, await body()), idempotencyKey),
  },
  { method: 'POST', path: 'purchases/:id/cancel', handler: async ({ deps, actor, params, body }) => A.cancelPurchase(deps, actor, id(params), p(zReason, await body()).reason) },

  // ---------------------------------------------------------------- vendas
  { method: 'GET', path: 'sales', handler: ({ deps, actor, query }) => A.listSales(deps, actor, p(A.zSaleList, queryObject(query))) },
  { method: 'POST', path: 'sales', handler: async ({ deps, actor, body, idempotencyKey }) => A.confirmSale(deps, actor, p(A.zSale, await body()), idempotencyKey) },
  { method: 'POST', path: 'sales/drafts', handler: async ({ deps, actor, body }) => A.saveSaleDraft(deps, actor, p(A.zSaleDraft, await body())) },
  { method: 'PUT', path: 'sales/drafts/:id', handler: async ({ deps, actor, params, body }) => A.saveSaleDraft(deps, actor, p(A.zSaleDraft, await body()), id(params)) },
  {
    method: 'POST', path: 'sales/drafts/:id/confirm',
    handler: async ({ deps, actor, params, body, idempotencyKey }) =>
      A.confirmDraft(deps, actor, id(params), p(z.object({ payments: z.array(A.zSalePayment).max(10) }), await body()).payments, idempotencyKey),
  },
  { method: 'POST', path: 'sales/drafts/:id/cancel', handler: ({ deps, actor, params }) => A.cancelDraft(deps, actor, id(params)) },
  { method: 'GET', path: 'sales/:id', handler: ({ deps, actor, params }) => A.getSale(deps, actor, id(params)) },
  { method: 'POST', path: 'sales/:id/returns', handler: async ({ deps, actor, params, body, idempotencyKey }) => A.returnSale(deps, actor, id(params), p(A.zReturn, await body()), idempotencyKey) },
  {
    method: 'POST', path: 'sales/:id/cancel',
    handler: async ({ deps, actor, params, body, idempotencyKey }) =>
      A.cancelSale(deps, actor, id(params), p(zReason.extend({ refund: A.zRefund.optional(), restock: z.boolean().optional() }), await body()), idempotencyKey),
  },
  { method: 'GET', path: 'channels', handler: ({ deps, actor }) => A.listChannels(deps, actor) },
  { method: 'POST', path: 'channels', handler: async ({ deps, actor, body }) => A.saveChannel(deps, actor, p(A.zChannel, await body())) },
  { method: 'PUT', path: 'channels/:id', handler: async ({ deps, actor, params, body }) => A.saveChannel(deps, actor, p(A.zChannel, await body()), id(params)) },
  { method: 'GET', path: 'payment-methods', handler: ({ deps, actor }) => A.listPaymentMethods(deps, actor) },
  { method: 'POST', path: 'payment-methods', handler: async ({ deps, actor, body }) => A.savePaymentMethod(deps, actor, p(A.zPaymentMethod, await body())) },
  { method: 'PUT', path: 'payment-methods/:id', handler: async ({ deps, actor, params, body }) => A.savePaymentMethod(deps, actor, p(A.zPaymentMethod, await body()), id(params)) },

  // ---------------------------------------------------------------- trocas
  { method: 'POST', path: 'trades/simulate', handler: async ({ deps, actor, body }) => A.simulateTrade(deps, actor, p(A.zTrade, await body())) },
  { method: 'POST', path: 'trades', handler: async ({ deps, actor, body, idempotencyKey }) => A.confirmTrade(deps, actor, p(A.zTrade, await body()), idempotencyKey) },
  { method: 'GET', path: 'trades', handler: ({ deps, actor, query }) => A.listTrades(deps, actor, p(A.zTradeList, queryObject(query))) },
  { method: 'GET', path: 'trades/:id', handler: ({ deps, actor, params }) => A.getTrade(deps, actor, id(params)) },
  { method: 'POST', path: 'trades/:id/reverse', handler: async ({ deps, actor, params, body, idempotencyKey }) => A.reverseTrade(deps, actor, id(params), p(zReason, await body()).reason, idempotencyKey) },

  // ---------------------------------------------------------------- financeiro
  { method: 'GET', path: 'finance/titles', handler: ({ deps, actor, query }) => A.listTitles(deps, actor, p(A.zTitleList, queryObject(query))) },
  { method: 'GET', path: 'finance/titles/:id', handler: ({ deps, actor, params }) => A.getTitle(deps, actor, id(params)) },
  { method: 'POST', path: 'finance/settlements', handler: async ({ deps, actor, body, idempotencyKey }) => A.settleTitles(deps, actor, p(A.zSettle, await body()), idempotencyKey) },
  { method: 'POST', path: 'finance/settlements/:id/reverse', handler: async ({ deps, actor, params, body }) => A.reverseSettlementAction(deps, actor, id(params), p(zReason, await body()).reason) },
  { method: 'GET', path: 'finance/accounts', handler: ({ deps, actor }) => A.listAccounts(deps, actor) },
  { method: 'GET', path: 'finance/balance-breakdown', handler: ({ deps, actor }) => A.balanceBreakdown(deps, actor) },
  { method: 'POST', path: 'finance/accounts', handler: async ({ deps, actor, body }) => A.createAccount(deps, actor, p(A.zAccount, await body())) },
  { method: 'POST', path: 'finance/accounts/:id/adjust-balance', handler: async ({ deps, actor, params, body, idempotencyKey }) => A.adjustAccountBalance(deps, actor, id(params), p(A.zAdjustBalance, await body()), idempotencyKey) },
  { method: 'POST', path: 'finance/accounts/unify', handler: async ({ deps, actor, body }) => A.unifyAccounts(deps, actor, p(A.zUnifyAccounts, await body())) },
  { method: 'GET', path: 'finance/cash-movements', handler: ({ deps, actor, query }) => A.listCashMovements(deps, actor, p(A.zStatement, queryObject(query))) },
  { method: 'POST', path: 'finance/cash-movements/:id/reverse', handler: async ({ deps, actor, params, body }) => A.reverseCashMovement(deps, actor, id(params), p(zReason, await body()).reason) },
  { method: 'POST', path: 'finance/cash-movements', handler: async ({ deps, actor, body, idempotencyKey }) => A.recordCashMovement(deps, actor, p(A.zCashMovement, await body()), idempotencyKey) },
  { method: 'POST', path: 'finance/transfers', handler: async ({ deps, actor, body, idempotencyKey }) => A.transferBetweenAccounts(deps, actor, p(A.zTransfer, await body()), idempotencyKey) },
  { method: 'GET', path: 'finance/expenses', handler: ({ deps, actor, query }) => A.listExpenses(deps, actor, p(A.zExpenseList, queryObject(query))) },
  { method: 'POST', path: 'finance/expenses', handler: async ({ deps, actor, body, idempotencyKey }) => A.createExpense(deps, actor, p(A.zExpense, await body()), idempotencyKey) },
  { method: 'POST', path: 'finance/expenses/:id/cancel', handler: async ({ deps, actor, params, body }) => A.cancelExpense(deps, actor, id(params), p(zReason, await body()).reason) },
  { method: 'GET', path: 'finance/expense-categories', handler: ({ deps, actor }) => A.listExpenseCategories(deps, actor) },
  {
    method: 'POST', path: 'finance/expense-categories',
    handler: async ({ deps, actor, body }) => A.createExpenseCategory(deps, actor, p(z.object({ name: z.string().trim().min(2).max(60) }), await body()).name),
  },
  {
    method: 'POST', path: 'finance/cash-sessions',
    handler: async ({ deps, actor, body }) => {
      const input = p(z.object({ accountId: z.string().uuid(), countedCents: A.zCentsNonNeg }), await body());
      return A.openCashSession(deps, actor, input.accountId, input.countedCents);
    },
  },
  {
    method: 'POST', path: 'finance/cash-sessions/:id/close',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(z.object({ countedCents: A.zCentsNonNeg, justification: z.string().max(500).optional() }), await body());
      return A.closeCashSession(deps, actor, id(params), input.countedCents, input.justification);
    },
  },
  { method: 'GET', path: 'finance/periods', handler: ({ deps, actor }) => A.listPeriods(deps, actor) },
  {
    method: 'POST', path: 'finance/periods',
    handler: async ({ deps, actor, body }) => {
      const input = p(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(['closed', 'reopened']), reason: z.string().min(3).max(300) }), await body());
      await A.setPeriodStatus(deps, actor, input.period, input.status, input.reason);
    },
  },

  // ---------------------------------------------------------------- catálogo público (gestão)
  { method: 'GET', path: 'catalog', handler: ({ deps, actor }) => A.getCatalogAdmin(deps, actor) },
  { method: 'PUT', path: 'catalog', handler: async ({ deps, actor, body }) => A.saveCatalog(deps, actor, p(A.zCatalog, await body())) },
  {
    method: 'PUT', path: 'catalog/items',
    handler: async ({ deps, actor, body }) => A.setCatalogItems(deps, actor, p(z.object({ variantIds: z.array(z.string().uuid()).max(500) }), await body()).variantIds),
  },
  {
    method: 'POST', path: 'catalog/publish',
    handler: async ({ deps, actor, body }) => A.setCatalogPublished(deps, actor, p(z.object({ published: z.boolean() }), await body()).published),
  },
  { method: 'GET', path: 'catalog/analytics', handler: ({ deps, actor }) => A.catalogAnalytics(deps, actor) },
  { method: 'GET', path: 'catalog/orders', handler: ({ deps, actor }) => A.listPublicOrders(deps, actor) },
  {
    method: 'POST', path: 'catalog/orders/:id/reserve',
    handler: async ({ deps, actor, params, body }) => A.reservePublicOrder(deps, actor, id(params), p(z.object({ hours: z.number().int().min(1).max(168).default(24) }), await body()).hours),
  },
  {
    method: 'POST', path: 'catalog/orders/:id/close',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(z.object({ status: z.enum(['converted', 'canceled']), saleId: z.string().uuid().optional() }), await body());
      await A.closePublicOrder(deps, actor, id(params), input.status, input.saleId);
    },
  },

  // ---------------------------------------------------------------- métricas, relatórios, exportação, documentos
  { method: 'GET', path: 'dashboard', handler: ({ deps, actor, query }) => A.getDashboard(deps, actor, p(A.zPeriod, queryObject(query))) },
  { method: 'GET', path: 'metrics', handler: ({ deps, actor, query }) => A.getMetrics(deps, actor, p(A.zPeriod, queryObject(query))) },
  {
    method: 'GET', path: 'reports/:kind',
    handler: ({ deps, actor, params, query }) => A.getReport(deps, actor, p(z.object({ kind: z.enum(A.REPORT_KINDS) }), params).kind, p(A.zPeriod, queryObject(query))),
  },
  { method: 'POST', path: 'exports', handler: async ({ deps, actor, body }) => A.requestExport(deps, actor, p(A.zExportRequest, await body())) },
  { method: 'GET', path: 'exports', handler: ({ deps, actor }) => A.listExports(deps, actor) },
  {
    method: 'GET', path: 'exports/:id/download',
    handler: async ({ deps, actor, params }) => {
      const f = await A.downloadExport(deps, actor, id(params));
      return fileResponse(f.data, f.filename, 'text/csv; charset=utf-8');
    },
  },
  { method: 'GET', path: 'documents', handler: ({ deps, actor, query }) => A.listDocuments(deps, actor, query.get('sourceId') ?? undefined) },
  {
    method: 'POST', path: 'documents',
    handler: async ({ deps, actor, body }) => {
      const input = p(z.object({ docType: z.enum(['quote', 'warranty', 'sale_contract']), sourceType: z.enum(['sale', 'warranty_case']), sourceId: z.string().uuid() }), await body());
      if ((input.docType === 'warranty') !== (input.sourceType === 'warranty_case')) throw new AppError('validation_failed', 'Tipo de documento incompatível com a origem.');
      return A.requestDocumentAction(deps, actor, input.docType, input.sourceType, input.sourceId);
    },
  },
  {
    method: 'POST', path: 'documents/:id/share', rate: { max: 60, windowMs: 3600_000 },
    handler: async ({ deps, actor, params }) => {
      const r = await A.shareDocument(deps, actor, id(params));
      return { url: `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/d/${r.token}`, expiresAt: r.expiresAt };
    },
  },
  {
    method: 'GET', path: 'documents/:id/pdf',
    handler: async ({ deps, actor, params }) => {
      const f = await A.readDocumentPdf(deps, actor, id(params));
      return fileResponse(f.data, f.filename, 'application/pdf');
    },
  },
  { method: 'POST', path: 'documents/:id/retry', handler: ({ deps, actor, params }) => A.retryDocument(deps, actor, id(params)) },

  // ---------------------------------------------------------------- pós-venda, ajuda e indicação
  { method: 'GET', path: 'service-orders', handler: ({ deps, actor, query }) => A.listServiceOrders(deps, actor, p(A.zServiceOrderList, queryObject(query))) },
  { method: 'POST', path: 'service-orders', handler: async ({ deps, actor, body }) => A.createServiceOrder(deps, actor, p(A.zServiceOrder, await body())) },
  { method: 'GET', path: 'service-orders/:id', handler: ({ deps, actor, params }) => A.getServiceOrder(deps, actor, id(params)) },
  { method: 'PUT', path: 'service-orders/:id', handler: async ({ deps, actor, params, body }) => A.updateServiceOrder(deps, actor, id(params), p(A.zServiceOrder, await body())) },
  {
    method: 'POST', path: 'service-orders/:id/status',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(z.object({ status: z.enum(A.SERVICE_STATUS), note: z.string().trim().max(500).optional() }), await body());
      return A.setServiceOrderStatus(deps, actor, id(params), input.status, input.note);
    },
  },
  { method: 'GET', path: 'warranty-cases', handler: ({ deps, actor, query }) => A.listWarrantyCases(deps, actor, p(A.zWarrantyList, queryObject(query))) },
  { method: 'POST', path: 'warranty-cases', handler: async ({ deps, actor, body }) => A.openWarrantyCase(deps, actor, p(A.zWarrantyCase, await body())) },
  {
    method: 'POST', path: 'warranty-cases/:id/status',
    handler: async ({ deps, actor, params, body }) => {
      const input = p(z.object({ status: z.enum(A.WARRANTY_STATUS), resolution: z.string().trim().max(2000).optional() }), await body());
      return A.setWarrantyStatus(deps, actor, id(params), input.status, input.resolution);
    },
  },
  { method: 'POST', path: 'warranty-cases/:id/document', handler: ({ deps, actor, params }) => A.requestWarrantyDocument(deps, actor, id(params)) },
  { method: 'GET', path: 'help', handler: ({ deps, actor, query }) => A.listHelpArticles(deps, actor, p(A.zHelpQuery, queryObject(query))) },
  { method: 'GET', path: 'help/:slug', handler: ({ deps, actor, params }) => A.getHelpArticle(deps, actor, p(z.object({ slug: z.string().regex(/^[a-z0-9-]{2,80}$/) }), params).slug) },
  { method: 'GET', path: 'referrals', handler: ({ deps, actor }) => A.getReferralInfo(deps, actor) },

  // ---------------------------------------------------------------- administração da plataforma (control plane)
  { method: 'GET', path: 'platform/me', noTenant: true, handler: async ({ deps, session }) => A.resolvePlatformAdmin(deps, session.user) },
  { method: 'GET', path: 'platform/overview', noTenant: true, handler: async ({ deps, session }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformOverview(deps); } },
  { method: 'GET', path: 'platform/tenants', noTenant: true, handler: async ({ deps, session, query }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformTenants(deps, query.get('q')?.slice(0, 80) || undefined); } },
  {
    method: 'POST', path: 'platform/tenants/:id/status', noTenant: true,
    handler: async ({ deps, session, params, body }) => {
      const admin = await A.resolvePlatformAdmin(deps, session.user);
      const input = p(zReason.extend({ action: z.enum(['suspend', 'reactivate']) }), await body());
      return A.platformSetTenantStatus(deps, admin, id(params), input.action, input.reason);
    },
  },
  {
    method: 'POST', path: 'platform/tenants/:id/plan', noTenant: true,
    handler: async ({ deps, session, params, body }) => {
      const admin = await A.resolvePlatformAdmin(deps, session.user);
      const input = p(zReason.extend({ planVersionId: z.string().uuid() }), await body());
      return A.platformChangePlan(deps, admin, id(params), input.planVersionId, input.reason);
    },
  },
  { method: 'GET', path: 'platform/plans', noTenant: true, handler: async ({ deps, session }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformPlans(deps); } },
  {
    method: 'POST', path: 'platform/plans', noTenant: true,
    handler: async ({ deps, session, body }) => A.platformSavePlanVersion(deps, await A.resolvePlatformAdmin(deps, session.user), p(A.zPlanVersion, await body())),
  },
  { method: 'GET', path: 'platform/invoices', noTenant: true, handler: async ({ deps, session, query }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformInvoices(deps, query.get('tenantId') ?? undefined); } },
  {
    method: 'POST', path: 'platform/invoices', noTenant: true,
    handler: async ({ deps, session, body }) => A.platformCreateInvoice(deps, await A.resolvePlatformAdmin(deps, session.user), p(A.zInvoice, await body())),
  },
  {
    method: 'POST', path: 'platform/invoices/:id/paid', noTenant: true,
    handler: async ({ deps, session, params, body }) => A.platformMarkInvoicePaid(deps, await A.resolvePlatformAdmin(deps, session.user), id(params), p(zReason, await body()).reason),
  },
  { method: 'GET', path: 'platform/referrals', noTenant: true, handler: async ({ deps, session }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformReferrals(deps); } },
  {
    method: 'POST', path: 'platform/referrals/:id/status', noTenant: true,
    handler: async ({ deps, session, params, body }) => {
      const admin = await A.resolvePlatformAdmin(deps, session.user);
      const input = p(zReason.extend({ status: z.enum(['rewarded', 'rejected']) }), await body());
      return A.platformSetReferralStatus(deps, admin, id(params), input.status, input.reason);
    },
  },
  { method: 'GET', path: 'platform/audit', noTenant: true, handler: async ({ deps, session }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformAuditLog(deps); } },
  { method: 'GET', path: 'platform/webhooks', noTenant: true, handler: async ({ deps, session }) => { await A.resolvePlatformAdmin(deps, session.user); return A.platformWebhooks(deps); } },
];

export { AppError, getSession, clientIp, rateLimit };
