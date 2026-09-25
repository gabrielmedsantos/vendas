// Empacota worker e scripts operacionais (migração, admin da plataforma) em JS.
// Pacotes do workspace (@gct/*, TypeScript) entram no bundle; dependências de
// terceiros ficam externas e vêm do node_modules gerado por `pnpm deploy`.
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

// Externas = `dependencies` do worker (instaladas na imagem por `pnpm deploy`) e módulos do Node.
// O resto (pacotes @gct/*, better-auth/crypto do seed) entra no bundle.
const runtimeDeps = Object.keys(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).dependencies);
const pkgName = (p) => (p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]);
const externalThirdParty = {
  name: 'external-runtime-deps',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('node:') || builtinModules.includes(args.path) || runtimeDeps.includes(pkgName(args.path)) ? { path: args.path, external: true } : undefined,
    );
  },
};

await build({
  entryPoints: {
    worker: 'src/index.ts',
    migrate: '../../packages/db/scripts/migrate.ts',
    'platform-admin': '../../packages/db/scripts/platform-admin.ts',
    'seed-demo': '../web/scripts/seed-demo.ts',
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
