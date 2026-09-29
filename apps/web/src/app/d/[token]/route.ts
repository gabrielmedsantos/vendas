import { readSharedDocument } from '@gct/app';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Documento enviado ao cliente por link (sem login). Link inválido ou vencido → 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return publicHandler(async (deps) => {
    const f = await readSharedDocument(deps, token);
    return new Response(new Uint8Array(f.data), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${f.filename.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex, nofollow',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }, { max: 30, windowMs: 60_000 }, 'doc');
}
