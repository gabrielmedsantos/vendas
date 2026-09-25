import { createPublicOrder, parse, zPublicOrder } from '@gct/app';
import { AppError } from '@gct/shared';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return publicHandler(async (deps) => {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!origin || new URL(origin).host !== host) throw new AppError('forbidden', 'Origem não permitida.');
    const text = await req.text();
    if (text.length > 20_000) throw new AppError('validation_failed', 'Pedido muito grande.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AppError('validation_failed', 'JSON inválido.'); }
    return createPublicOrder(deps, slug, parse(zPublicOrder, body));
  }, { max: 5, windowMs: 600_000 }, 'order');
}
