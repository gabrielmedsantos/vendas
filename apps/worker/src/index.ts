import { createDatabases, databaseConfigFromEnv } from '@gct/db';
import { createMailerFromEnv, LocalStorage, processOutboxBatch, processWebhookEvents, queueHealth, runPeriodicJobs, snapshotDailyStock, type AppDeps } from '@gct/app';

/**
 * Worker: consome o outbox (PDFs, exportações, avisos) e executa rotinas
 * (expiração de reservas, ciclo de assinaturas, snapshot diário de estoque).
 * Reprocessar um evento não repete efeito financeiro: consumidores são idempotentes.
 */
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, service: 'worker', ts: new Date().toISOString(), ...extra }));

const dbs = createDatabases(databaseConfigFromEnv());
const deps: AppDeps = { dbs, storage: new LocalStorage(process.env.STORAGE_PATH ?? './storage'), mailer: await createMailerFromEnv() };

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function outboxLoop() {
  while (!stopping) {
    try {
      const r = await processOutboxBatch(deps, 20);
      if (r.processed) log('info', 'outbox', r);
      const w = await processWebhookEvents(deps, 20);
      if (w) log('info', 'webhooks de cobrança', { processed: w });
      if (r.processed === 0 && w === 0) await sleep(1000);
    } catch (e) {
      log('error', 'falha no loop do outbox', { error: (e as Error).message });
      await sleep(5000);
    }
  }
}

async function periodicLoop() {
  let lastSnapshot = 0;
  while (!stopping) {
    try {
      const r = await runPeriodicJobs(deps);
      if (r.reservations || r.subscriptionTransitions) log('info', 'rotinas', r);
      if (Date.now() - lastSnapshot > 3600_000) {
        await snapshotDailyStock(deps);
        lastSnapshot = Date.now();
      }
      const h = await queueHealth(deps);
      if (h.dead > 0) log('warn', 'eventos em dead letter', { dead: h.dead });
    } catch (e) {
      log('error', 'falha nas rotinas', { error: (e as Error).message });
    }
    for (let i = 0; i < 60 && !stopping; i++) await sleep(1000);
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'encerrando', { signal });
  await sleep(1500);
  await dbs.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

log('info', 'worker iniciado');
await Promise.all([outboxLoop(), periodicLoop()]);
