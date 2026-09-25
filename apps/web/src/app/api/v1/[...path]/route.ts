import { makeDispatcher } from '@/lib/server/http';
import { routes } from '@/lib/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const dispatch = makeDispatcher(routes);

type Ctx = { params: Promise<{ path: string[] }> };
const handle = async (req: Request, ctx: Ctx) => dispatch(req, (await ctx.params).path.join('/'));

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
