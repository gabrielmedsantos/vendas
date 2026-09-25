'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [twoFactorClient({ onTwoFactorRedirect: () => { window.location.href = '/entrar/2fa'; } })],
});

/** Mensagens de autenticação em pt-BR, sem revelar se o e-mail existe. */
export function authErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'E-mail ou senha incorretos.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'Não foi possível criar a conta com este e-mail. Tente entrar ou recuperar a senha.';
    case 'PASSWORD_TOO_SHORT':
      return 'A senha precisa ter ao menos 10 caracteres.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Confirme seu e-mail antes de entrar. Enviamos um link para sua caixa de entrada.';
    case 'INVALID_TOKEN':
      return 'Link inválido ou expirado. Solicite um novo.';
    case 'TOO_MANY_REQUESTS':
      return 'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.';
    default:
      // O limite de tentativas do servidor de autenticação responde em inglês e sem código.
      if (fallback && /too many requests/i.test(fallback)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.';
      return fallback ?? 'Não foi possível concluir. Tente novamente.';
  }
}
