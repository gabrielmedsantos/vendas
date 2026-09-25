export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'insufficient_stock'
  | 'idempotency_conflict'
  | 'validation_failed'
  | 'plan_limit'
  | 'rate_limited'
  | 'tenant_suspended'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  insufficient_stock: 409,
  idempotency_conflict: 409,
  plan_limit: 403,
  validation_failed: 422,
  rate_limited: 429,
  tenant_suspended: 403,
  internal: 500,
};

/** Erro de aplicação com mensagem segura para o usuário (pt-BR). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }
}

export const notFound = (what = 'Registro') => new AppError('not_found', `${what} não encontrado.`);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError('forbidden', msg);
export const conflict = (msg: string) => new AppError('conflict', msg);
export const invalid = (msg: string, fields?: Record<string, string>) =>
  new AppError('validation_failed', msg, fields);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
