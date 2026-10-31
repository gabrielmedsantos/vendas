import { createDatabases, databaseConfigFromEnv } from '@gct/db';
import { grantCourtesy } from '@gct/app';

/**
 * Libera uma empresa para sempre (cortesia), ex.: a do dono da plataforma.
 * Uso na VPS:
 *   docker compose run --rm migrate node dist/cortesia.js "Nome da empresa"            → só mostra quem encontrou
 *   docker compose run --rm migrate node dist/cortesia.js "Nome da empresa" --aplicar  → libera
 */
const args = process.argv.slice(2);
const apply = args.includes('--aplicar');
const term = args.filter((a) => a !== '--aplicar').join(' ').trim();
if (term.length < 2) {
  console.error('Uso: node dist/cortesia.js "Nome da empresa" [--aplicar]');
  process.exit(1);
}
const dbs = createDatabases(databaseConfigFromEnv());
try {
  const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  const found = await dbs.platform
    .selectFrom('tenants as t')
    .leftJoin('subscriptions as s', 's.tenant_id', 't.id')
    .select(['t.id', 't.name', 't.slug', 't.status', 's.status as subscription', 's.trial_ends_at'])
    .where((eb) => eb.or([eb('t.name', 'ilike', like), eb('t.slug', 'ilike', like)]))
    .orderBy('t.created_at')
    .execute();
  if (found.length === 0) {
    console.error(`Nenhuma empresa encontrada com "${term}".`);
    process.exitCode = 1;
  } else if (!apply || found.length > 1) {
    for (const t of found) console.log(`- ${t.name} (${t.slug}) · empresa: ${t.status} · assinatura: ${t.subscription ?? 'sem assinatura'}`);
    console.log(found.length > 1 ? '\nMais de uma empresa: use um nome mais completo (ou o identificador entre parênteses).' : '\nPara liberar, rode de novo com --aplicar no final.');
  } else {
    await grantCourtesy(dbs.platform, found[0]!.id, 'empresa do dono da plataforma', 'cli:cortesia');
    console.log(`Liberada: ${found[0]!.name}. Assinatura ativa, sem vencimento. Recarregue o sistema (Ctrl+F5).`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await dbs.close();
}
