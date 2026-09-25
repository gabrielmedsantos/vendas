import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { AppError, isAppError } from '@gct/shared';
import { resolveActor, listTenantsForUser, type Actor, type AppDeps } from '@gct/app';
import { getContext } from './context';

export const TENANT_COOKIE = 'gct_tenant';

/** Converte chaves snake_case → camelCase e bigint → string (contrato único da API). */
export function toApi(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(toApi);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = toApi(v);
    }
    return out;
  }
  return value;
}

export function json(data: unknown, status = 200, extra?: HeadersInit): NextResponse {
  return new NextResponse(JSON.stringify(toApi(data)), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}

export function errorResponse(e: unknown, requestId: string): NextResponse {
  if (isAppError(e)) {
    return json({ error: { code: e.code, message: e.message, fields: e.fields, request_id: requestId } }, e.status);
  }
  const pg = e as { code?: string; constraint?: string; message?: string };
  if (pg?.code === '23505') return json({ error: { code: 'conflict', message: 'Registro duplicado.', request_id: requestId } }, 409);
  if (pg?.code === '23514' || pg?.code === '23503') {
    console.error(JSON.stringify({ level: 'warn', request_id: requestId, msg: 'violação de restrição', code: pg.code, constraint: pg.constraint }));
    return json({ error: { code: 'conflict', message: 'Operação viola uma regra de integridade.', request_id: requestId } }, 409);
  }
  console.error(JSON.stringify({ level: 'error', request_id: requestId, msg: (e as Error)?.message, stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') }));
  return json({ error: { code: 'internal', message: 'Erro inesperado. Tente novamente; se persistir, informe o código.', request_id: requestId } }, 500);
}

// Limite de taxa simples em memória (instância única no piloto).
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  b.n++;
  if (b.n > max) throw new AppError('rate_limited', 'Muitas tentativas. Aguarde um instante e tente novamente.');
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim();
}

/** Mutações exigem mesma origem (defesa CSRF além de SameSite). */
async function assertSameOrigin(req: Request): Promise<void> {
  const origin = req.headers.get('origin');
  const appUrl = new URL(process.env.APP_URL ?? 'http://localhost:3000');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin) throw new AppError('forbidden', 'Origem da requisição ausente.');
  const o = new URL(origin);
  if (o.host !== appUrl.host && o.host !== host) throw new AppError('forbidden', 'Origem da requisição não permitida.');
}

export interface SessionInfo {
  user: { id: string; email: string; name: string; emailVerified: boolean; twoFactorEnabled?: boolean | null };
  sessionId: string;
}

export async function getSession(): Promise<SessionInfo | null> {
  const { auth } = await getContext();
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  return { user: s.user as SessionInfo['user'], sessionId: s.session.id };
}

/** Empresa selecionada (cookie) validada contra membership ativa. */
export async function currentActor(deps: AppDeps, session: SessionInfo, requestId: string): Promise<Actor> {
  const jar = await cookies();
  let tenantId = jar.get(TENANT_COOKIE)?.value;
  if (!tenantId) {
    const list = await listTenantsForUser(deps, session.user.id);
    if (list.length === 1) tenantId = list[0]!.id;
  }
  if (!tenantId) throw new AppError('not_found', 'Selecione ou crie uma empresa.');
  return resolveActor(deps, session.user.id, tenantId, requestId);
}

export interface RouteCtx {
  req: Request;
  deps: AppDeps;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  session: SessionInfo;
  actor: Actor;
  body: () => Promise<unknown>;
  idempotencyKey: string | undefined;
}

export type Handler = (ctx: RouteCtx) => Promise<unknown>;

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: Handler;
  /** rota sem empresa (perfil, lista de empresas, criar empresa) */
  noTenant?: boolean;
  raw?: boolean;
  rate?: { max: number; windowMs: number };
}

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) {
      const v = decodeURIComponent(a[i]!);
      if (v.length > 200) return null;
      params[p[i]!.slice(1)] = v;
    } else if (p[i] !== a[i]) return null;
  }
  return params;
}

/** Despacha /api/v1/* com sessão, empresa, validação, erros e log estruturado. */
export function makeDispatcher(routes: RouteDef[]) {
  return async function dispatch(req: Request, path: string): Promise<Response> {
    const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
    const started = Date.now();
    let status = 200;
    let tenant: string | undefined;
    try {
      const candidates = routes.filter((r) => match(r.path, path));
      if (candidates.length === 0) throw new AppError('not_found', 'Rota não encontrada.');
      const route = candidates.find((r) => r.method === req.method);
      if (!route) {
        status = 405;
        return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.', request_id: requestId } }, 405);
      }
      if (req.method !== 'GET') await assertSameOrigin(req);
      const { deps } = await getContext();
      const session = await getSession();
      if (!session) throw new AppError('unauthenticated', 'Sessão expirada. Entre novamente.');
      if (route.rate) rateLimit(`${route.path}:${session.user.id}`, route.rate.max, route.rate.windowMs);
      const actor = route.noTenant ? ({ userId: session.user.id } as Actor) : await currentActor(deps, session, requestId);
      tenant = actor.tenantId;
      const url = new URL(req.url);
      let parsed: unknown;
      const result = await route.handler({
        req,
        deps,
        params: match(route.path, path)!,
        query: url.searchParams,
        requestId,
        session,
        actor,
        idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
        body: async () => {
          if (parsed !== undefined) return parsed;
          const ct = req.headers.get('content-type') ?? '';
          if (!ct.includes('application/json')) throw new AppError('validation_failed', 'Envie JSON (Content-Type: application/json).');
          const text = await req.text();
          if (text.length > 1_000_000) throw new AppError('validation_failed', 'Corpo da requisição muito grande.');
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            throw new AppError('validation_failed', 'JSON inválido.');
          }
          return parsed;
        },
      });
      if (result instanceof Response) {
        status = result.status;
        return result;
      }
      return json(result === undefined ? { ok: true } : result, 200, { 'x-request-id': requestId });
    } catch (e) {
      const r = errorResponse(e, requestId);
      status = r.status;
      return r;
    } finally {
      console.info(JSON.stringify({ level: 'info', request_id: requestId, tenant_id: tenant, method: req.method, path: `/api/v1/${path}`, status, ms: Date.now() - started }));
    }
  };
}

export function queryObject(q: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  q.forEach((v, k) => (o[k] = v));
  return o;
}

export function fileResponse(data: Buffer, filename: string, type: string): Response {
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  });
}
