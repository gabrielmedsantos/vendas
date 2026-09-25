import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '@gct/db';
import { notFound } from '@gct/shared';
import { requirePermission, tx, type Actor, type AppDeps } from './core';
import { zText } from './validation';

// ---------------------------------------------------------------- central de ajuda (conteúdo próprio, global)

export const HELP_CATEGORIES = { 'primeiros-passos': 'Primeiros passos', vendas: 'Vendas', trocas: 'Trocas', estoque: 'Estoque', financeiro: 'Financeiro', seguranca: 'Segurança' } as const;
export const zHelpQuery = z.object({ q: zText(80).optional(), category: z.enum(Object.keys(HELP_CATEGORIES) as [keyof typeof HELP_CATEGORIES]).optional() });

export async function listHelpArticles(deps: AppDeps, actor: Actor, q: z.infer<typeof zHelpQuery>) {
  return tx(deps, actor, async (trx) => {
    let query = trx.selectFrom('help_articles').select(['slug', 'category', 'title', 'summary', 'reading_minutes']).where('published', '=', true);
    if (q.category) query = query.where('category', '=', q.category);
    if (q.q) {
      const term = `%${q.q.replace(/[%_]/g, '')}%`;
      query = query.where((eb) => eb.or([eb('title', 'ilike', term), eb('summary', 'ilike', term), eb('body', 'ilike', term)]));
    }
    return query.orderBy(sql`array_position(array['primeiros-passos','vendas','trocas','estoque','financeiro','seguranca']::text[], category)`).orderBy('title').execute();
  });
}

export async function getHelpArticle(deps: AppDeps, actor: Actor, slug: string) {
  return tx(deps, actor, async (trx) => {
    const a = await trx.selectFrom('help_articles').select(['slug', 'category', 'title', 'summary', 'body', 'reading_minutes', 'updated_at']).where('slug', '=', slug).where('published', '=', true).executeTakeFirst();
    if (!a) throw notFound('Artigo');
    return a;
  });
}

// ---------------------------------------------------------------- indicação

/** Código de indicação da empresa (criado sob demanda) e situação das indicações. Recompensa é manual pela plataforma. */
export async function getReferralInfo(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'billing.manage');
  let row = await deps.dbs.platform.selectFrom('referral_codes').select('code').where('tenant_id', '=', actor.tenantId).executeTakeFirst();
  for (let i = 0; !row && i < 5; i++) {
    const code = randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, 'X');
    row = await deps.dbs.platform.insertInto('referral_codes').values({ tenant_id: actor.tenantId, code }).onConflict((oc) => oc.doNothing()).returning('code').executeTakeFirst();
  }
  if (!row) row = await deps.dbs.platform.selectFrom('referral_codes').select('code').where('tenant_id', '=', actor.tenantId).executeTakeFirstOrThrow();
  const counts = await tx(deps, actor, (trx) =>
    trx.selectFrom('referrals').select(['status', sql<number>`count(*)::int`.as('n')]).groupBy('status').execute(),
  );
  const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return {
    code: row.code,
    link: `${process.env.APP_URL ?? ''}/cadastro?indicacao=${row.code}`,
    pending: by.pending ?? 0, qualified: by.qualified ?? 0, rewarded: by.rewarded ?? 0,
    rules: 'A indicação é qualificada quando a empresa indicada paga a primeira mensalidade. A recompensa é aplicada manualmente pela administração da plataforma.',
  };
}
