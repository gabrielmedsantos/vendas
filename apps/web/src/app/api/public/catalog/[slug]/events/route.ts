import { recordCatalogEvent } from '@gct/app';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Métricas minimizadas: tipo de evento e item; sem IP ou identificação do visitante. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return publicHandler(async (deps) => {
    const body = (await req.json().catch(() => ({}))) as { kind?: string; variantId?: string };
    const kind = body.kind === 'product_view' || body.kind === 'contact_click' ? body.kind : 'view';
    const variant = typeof body.variantId === 'string' && /^[0-9a-f-]{36}$/i.test(body.variantId) ? body.variantId : undefined;
    await recordCatalogEvent(deps, slug, kind, variant).catch(() => undefined);
    return { ok: true };
  }, { max: 60, windowMs: 60_000 }, 'evt');
}
