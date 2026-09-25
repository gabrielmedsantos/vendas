import 'server-only';
import { randomUUID } from 'node:crypto';
import { clientIp, errorResponse, json, rateLimit } from './http';
import { getContext } from './context';

/** Rotas públicas: sem sessão, com limite por IP e projeção explícita. */
export async function publicHandler(fn: (deps: Awaited<ReturnType<typeof getContext>>['deps']) => Promise<unknown>, limit = { max: 120, windowMs: 60_000 }, key = 'public') {
  const requestId = randomUUID();
  try {
    rateLimit(`${key}:${await clientIp()}`, limit.max, limit.windowMs);
    const { deps } = await getContext();
    const r = await fn(deps);
    if (r instanceof Response) return r;
    return json(r ?? { ok: true }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
