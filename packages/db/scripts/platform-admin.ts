import pg from 'pg';

/**
 * Concede (ou revoga) acesso à administração da plataforma para um usuário já
 * cadastrado. Usa o papel dono (migrações): o papel da plataforma só lê essa tabela.
 * Uso: pnpm platform:admin email@exemplo.com [admin|support|revoke]
 */
const [email, mode = 'admin'] = process.argv.slice(2);
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !email || !['admin', 'support', 'revoke'].includes(mode)) {
  console.error('Uso: MIGRATION_DATABASE_URL=... pnpm platform:admin <email> [admin|support|revoke]');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const u = await client.query<{ id: string }>('select id from "user" where lower(email) = lower($1)', [email]);
  if (!u.rows[0]) throw new Error('Usuário não encontrado. Cadastre-se primeiro pela tela de cadastro.');
  if (mode === 'revoke') {
    await client.query('delete from platform_admins where user_id = $1', [u.rows[0].id]);
    console.log('Acesso de administração revogado.');
  } else {
    await client.query('insert into platform_admins (user_id, role) values ($1, $2) on conflict (user_id) do update set role = excluded.role', [u.rows[0].id, mode]);
    console.log(`Acesso concedido (${mode}). O usuário precisa ter 2FA ativo para entrar em /plataforma.`);
  }
} finally {
  await client.end();
}
