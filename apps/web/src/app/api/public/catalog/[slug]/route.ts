import { getPublicCatalog } from '@gct/app';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return publicHandler((deps) => getPublicCatalog(deps, slug));
}
