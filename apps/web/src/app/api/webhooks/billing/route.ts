import { receiveBillingWebhook } from '@gct/app';
import { AppError } from '@gct/shared';
import { publicHandler } from '@/lib/server/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de cobrança. Verifica HMAC sobre o corpo bruto antes de qualquer
 * efeito, grava o evento (único por provedor+id) e responde rápido; o worker
 * aplica o efeito na assinatura. Desligado enquanto BILLING_WEBHOOK_SECRET não existir.
 */
export async function POST(req: Request) {
  return publicHandler(async (deps) => {
    const raw = await req.text();
    if (raw.length > 100_000) throw new AppError('validation_failed', 'Corpo muito grande.');
    const r = await receiveBillingWebhook(
      deps,
      process.env.BILLING_PROVIDER ?? 'generic',
      raw,
      { timestamp: req.headers.get('x-gct-timestamp'), signature: req.headers.get('x-gct-signature') },
      process.env.BILLING_WEBHOOK_SECRET || undefined,
      process.env.BILLING_ENVIRONMENT ?? 'sandbox',
    );
    return { received: true, duplicate: r.duplicate };
  }, { max: 300, windowMs: 60_000 }, 'webhook');
}
