import { readPublicImage } from '@gct/app';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; imageId: string }> }) {
  const { slug, imageId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return new Response('Não encontrado', { status: 404 });
  return publicHandler(async (deps) => {
    const data = await readPublicImage(deps, slug, imageId);
    return new Response(new Uint8Array(data), { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  }, { max: 600, windowMs: 60_000 }, 'img');
}
