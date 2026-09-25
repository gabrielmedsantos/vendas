import 'server-only';
import { createDatabases, databaseConfigFromEnv } from '@gct/db';
import { createMailerFromEnv, LocalStorage, type AppDeps } from '@gct/app';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';

type Ctx = { deps: AppDeps; auth: ReturnType<typeof makeAuth> };
const g = globalThis as unknown as { __gct?: Promise<Ctx> };

function makeAuth(deps: AppDeps) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const mailEnabled = deps.mailer.enabled;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET ausente ou curto (mínimo 32 caracteres).');
  return betterAuth({
    appName: 'Gestão Compra e Troca',
    baseURL: appUrl,
    secret,
    database: deps.dbs.authPool,
    trustedOrigins: [appUrl],
    advanced: { useSecureCookies: appUrl.startsWith('https://'), cookiePrefix: 'gct' },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 15 },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 8 }, '/request-password-reset': { window: 300, max: 3 } } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: mailEnabled && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false',
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 30,
      sendResetPassword: async ({ user, url }) => {
        if (!mailEnabled) {
          if (process.env.NODE_ENV !== 'production') console.info(`[dev] link de redefinição para ${user.email}: ${url}`);
          return;
        }
        await deps.mailer.send({ to: user.email, subject: 'Redefinição de senha', text: `Para criar uma nova senha acesse: ${url}\nO link expira em 30 minutos. Se não foi você, ignore esta mensagem.` });
      },
    },
    emailVerification: {
      sendOnSignUp: mailEnabled,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!mailEnabled) return;
        await deps.mailer.send({ to: user.email, subject: 'Confirme seu e-mail', text: `Confirme seu e-mail acessando: ${url}` });
      },
    },
    plugins: [twoFactor({ issuer: 'Gestão Compra e Troca' }), nextCookies()],
  });
}

async function build(): Promise<Ctx> {
  const dbs = createDatabases(databaseConfigFromEnv());
  const deps: AppDeps = {
    dbs,
    storage: new LocalStorage(process.env.STORAGE_PATH ?? './storage'),
    mailer: await createMailerFromEnv(),
  };
  return { deps, auth: makeAuth(deps) };
}

export function getContext(): Promise<Ctx> {
  if (!g.__gct) g.__gct = build();
  return g.__gct;
}
