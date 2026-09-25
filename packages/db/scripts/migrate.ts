import { migrate } from '../src/migrator';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL não definido.');
  process.exit(1);
}
const r = await migrate(url);
console.log(`migrações aplicadas: ${r.applied.length}; já existentes: ${r.skipped.length}`);
