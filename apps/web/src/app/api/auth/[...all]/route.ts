import { getContext } from '@/lib/server/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  const { auth } = await getContext();
  return auth.handler(req);
}

export { handle as GET, handle as POST };
