'use client';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public requestId?: string,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Cliente da API: JSON, erros tipados, nunca simula sucesso em falha. */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1/${path.replace(/^\//, '')}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique a internet e tente novamente.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    // Só as áreas logadas redirecionam para o login; páginas públicas (convite, cadastro, catálogo) tratam o 401 sozinhas.
    if (res.status === 401 && typeof window !== 'undefined' && /^\/(app|plataforma)(\/|$)/.test(window.location.pathname)) {
      window.location.href = `/entrar?volta=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Falha na requisição.', e.fields, e.request_id);
  }
  return data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
