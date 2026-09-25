// Empacota worker e scripts operacionais (migração, admin da plataforma) em JS.
// Pacotes do workspace (@gct/*, TypeScript) entram no bundle; dependências de
// terceiros ficam externas e vêm do node_modules gerado por `pnpm deploy`.
import { build } from 'esbuild';

const externalThirdParty = {
  name: 'external-third-party',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@gct/') ? undefined : { path: args.path, external: true }));
  },
};

await build({
  entryPoints: {
    worker: 'src/index.ts',
    migrate: '../../packages/db/scripts/migrate.ts',
    'platform-admin': '../../packages/db/scripts/platform-admin.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [externalThirdParty],
  logLevel: 'info',
});
