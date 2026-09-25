import { sql } from '@gct/db';
import { getContext } from '@/lib/server/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Prontidão: banco acessível e schema migrado (sem detalhes internos). */
export async function GET() {
  try {
    const { deps } = await getContext();
    await sql`select 1 from plans limit 1`.execute(deps.dbs.platform);
    return Response.json({ status: 'ready' });
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503 });
  }
}
