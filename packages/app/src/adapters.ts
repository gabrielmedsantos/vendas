import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Mailer, Storage } from './core';

/**
 * Armazenamento privado em volume local (fora do diretório público).
 * Chaves são geradas pelo servidor; caminho é validado contra travessia.
 * Interface compatível com adaptador S3 futuro.
 */
export class LocalStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Chave de armazenamento inválida');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Chave fora do armazenamento');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** Mailer desligado: nada é enviado; o link/ação aparece para o operador. */
export class DisabledMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error('Envio de e-mail não configurado.');
  }
}

/** Mailer de teste: guarda mensagens em memória (nunca envia de verdade). */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  readonly sent: { to: string; subject: string; text: string }[] = [];
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(msg);
  }
}

/**
 * SMTP via URL (smtp://usuario:senha@host:porta). Só é ativado quando SMTP_URL
 * existe; credenciais nunca são registradas em log.
 */
export async function createMailerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Mailer> {
  if (!env.SMTP_URL) return new DisabledMailer();
  const { SmtpMailer } = await import('./smtp');
  return new SmtpMailer(env.SMTP_URL, env.SMTP_FROM ?? 'nao-responda@localhost');
}
