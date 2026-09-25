import { z } from 'zod';
import { notFound } from '@gct/shared';
import { requirePermission, tx, type Actor, type AppDeps } from './core';
import { decodeCursor, pageOf, zPageQuery } from './validation';

export async function listNotifications(deps: AppDeps, actor: Actor) {
  return tx(deps, actor, async (trx) => {
    const rows = await trx
      .selectFrom('notifications')
      .select(['id', 'kind', 'severity', 'title', 'body', 'link', 'read_at', 'created_at'])
      .where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', actor.userId)]))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { data: rows, unread: rows.filter((r) => !r.read_at).length };
  });
}

export async function markNotificationRead(deps: AppDeps, actor: Actor, id: string | 'all') {
  return tx(deps, actor, async (trx) => {
    let q = trx.updateTable('notifications').set({ read_at: new Date() }).where('read_at', 'is', null);
    if (id !== 'all') q = q.where('id', '=', id);
    const r = await q.executeTakeFirst();
    if (id !== 'all' && !r.numUpdatedRows) throw notFound('Notificação');
  });
}

export const zAuditList = zPageQuery.extend({ entity: z.string().max(40).optional(), entityId: z.string().max(64).optional() });

/** Trilha de auditoria (somente leitura; a aplicação não apaga eventos). */
export async function listAudit(deps: AppDeps, actor: Actor, q: z.infer<typeof zAuditList>) {
  requirePermission(actor, 'members.manage');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('audit_events as a')
      .leftJoin('member_directory as m', 'm.user_id', 'a.user_id')
      .select(['a.id', 'a.action', 'a.entity', 'a.entity_id', 'a.data', 'a.created_at', 'a.request_id', 'm.name as user_name']);
    if (q.entity) query = query.where('a.entity', '=', q.entity);
    if (q.entityId) query = query.where('a.entity_id', '=', q.entityId);
    const rows = await query.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

export async function dismissOnboarding(deps: AppDeps, actor: Actor) {
  return tx(deps, actor, async (trx) => {
    const t = await trx.selectFrom('tenants').select('onboarding').where('id', '=', actor.tenantId).executeTakeFirstOrThrow();
    await trx.updateTable('tenants').set({ onboarding: JSON.stringify({ ...(t.onboarding as object), dismissed: true }) }).where('id', '=', actor.tenantId).execute();
  });
}
