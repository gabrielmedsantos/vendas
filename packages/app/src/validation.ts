import { z } from 'zod';
import { AppError, isLocalDate, toCents } from '@gct/shared';

/** Centavos: string de inteiro ou inteiro seguro. Nunca decimal. */
export const zCents = z
  .union([z.string().regex(/^-?\d{1,15}$/), z.number().int().safe()])
  .transform((v) => toCents(v));
export const zCentsNonNeg = zCents.refine((v) => v >= 0n, 'Valor não pode ser negativo');
export const zCentsPos = zCents.refine((v) => v > 0n, 'Valor deve ser positivo');
export const zUuid = z.string().uuid();
export const zLocalDate = z.string().refine(isLocalDate, 'Data inválida (AAAA-MM-DD)');
export const zQty = z.number().int().positive().max(1_000_000);
export const zText = (max = 500) => z.string().trim().max(max);

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
  throw new AppError('validation_failed', 'Verifique os campos informados.', fields);
}

export interface Page<T> {
  data: T[];
  meta: { cursor: string | null; has_more: boolean; total?: number };
}

export const zPageQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 0) throw new AppError('validation_failed', 'Cursor inválido.');
  return n;
}

export function pageOf<T>(rows: T[], offset: number, limit: number, total?: number): Page<T> {
  const hasMore = rows.length > limit;
  return {
    data: rows.slice(0, limit),
    meta: { cursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : null, has_more: hasMore, total },
  };
}
