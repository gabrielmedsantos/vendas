/** Banco de teste isolado: recriado a cada execução (nunca aponta para produção). */
const host = process.env.TEST_DB_HOST ?? 'localhost';
const port = process.env.TEST_DB_PORT ?? '5432';
export const TEST_DB = process.env.TEST_DB_NAME ?? 'gct_test';
if (!/^gct_test/.test(TEST_DB)) throw new Error('Nome do banco de teste deve começar com gct_test');
export const ADMIN_URL = process.env.TEST_ADMIN_URL ?? `postgres://postgres:postgres@${host}:${port}/postgres`;
const url = (role: string, pw: string) => `postgres://${role}:${pw}@${host}:${port}/${TEST_DB}`;
export const URLS = {
  owner: url('gct_owner', process.env.GCT_OWNER_PASSWORD ?? 'dev_owner'),
  app: url('gct_app', process.env.GCT_APP_PASSWORD ?? 'dev_app'),
  auth: url('gct_auth', process.env.GCT_AUTH_PASSWORD ?? 'dev_auth'),
  platform: url('gct_platform', process.env.GCT_PLATFORM_PASSWORD ?? 'dev_platform'),
  public: url('gct_public', process.env.GCT_PUBLIC_PASSWORD ?? 'dev_public'),
};
