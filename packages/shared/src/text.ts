/** Normaliza texto para busca: minúsculas, sem acentos, espaços simples. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Documento (CPF/CNPJ) ou identificador serial: somente dígitos/letras maiúsculas. */
export function normalizeIdentifier(s: string): string {
  return s.normalize('NFKC').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function normalizeDocument(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Neutraliza células CSV que começam com caracteres interpretados como
 * fórmula por planilhas (=, +, -, @, tab, CR), sem perder o texto.
 */
export function csvSafeCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvSafeCell).join(';'), ...rows.map((r) => r.map(csvSafeCell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function slugify(s: string): string {
  return normalizeSearch(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
