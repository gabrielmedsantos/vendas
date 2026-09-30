/** Narração do vídeo: prepara o texto para a voz sintética (estilo comercial ou natural). */

export type NarrationStyle = 'comercial' | 'natural';
export const NARRATION_STYLES: { id: NarrationStyle; label: string; hint: string }[] = [
  { id: 'comercial', label: 'Comercial (animado)', hint: 'Frases curtas com energia, ritmo mais rápido e volume nivelado.' },
  { id: 'natural', label: 'Natural (calmo)', hint: 'Leitura corrida, no ritmo normal.' },
];

/** Velocidade padrão de cada estilo (1 = ritmo normal da voz). */
export const NARRATION_SPEED: Record<NarrationStyle, number> = { comercial: 1.12, natural: 1 };

/** "R$ 1.599,90" → "1599 reais e 90 centavos" (o sintetizador lê o número; o símbolo e a vírgula, não). */
function money(_m: string, int: string, dec: string | undefined): string {
  const reais = int.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  const cents = dec ? Number(dec.padEnd(2, '0')) : 0;
  const r = reais === '1' ? '1 real' : reais === '0' ? '' : `${reais} reais`;
  if (!cents) return r || 'zero reais';
  const c = `${cents} ${cents === 1 ? 'centavo' : 'centavos'}`;
  return r ? `${r} e ${c}` : c;
}

/** Troca símbolos e abreviações comuns em anúncio por palavras que a voz lê bem. */
export function speakable(text: string): string {
  return text
    .replace(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g, money)
    .replace(/(\d+)\s*[xX]\b/g, (_m, n: string) => `${n} vezes`)
    .replace(/(\d+(?:,\d+)?)\s*%/g, '$1 por cento')
    .replace(/\s\+\s/g, ' mais ')
    .replace(/\bc\/\s*/gi, 'com ')
    .replace(/\bs\/\s*/gi, 'sem ')
    .replace(/\bp\/\s*/gi, 'para ')
    .replace(/(\d)\s*GB\b/gi, '$1 gigas')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

/**
 * Estilo comercial: quebra em frases curtas e fala cada uma com energia ("!").
 * Vírgulas viram quebra quando os dois lados têm pelo menos 3 palavras (não quebra listas curtas).
 * Perguntas continuam perguntas.
 */
export function commercialPhrases(text: string): string[] {
  const out: string[] = [];
  for (const raw of speakable(text).split(/(?<=[.!?;:])\s+/)) {
    const question = /\?\s*$/.test(raw);
    const body = raw.replace(/[.!?;:…]+\s*$/, '').trim();
    if (!body) continue;
    const parts: string[] = [];
    for (const piece of body.split(/,\s*/)) {
      const last = parts[parts.length - 1];
      if (last !== undefined && (words(piece) < 3 || words(last) < 3)) parts[parts.length - 1] = `${last}, ${piece}`;
      else parts.push(piece);
    }
    parts.forEach((p, i) => out.push(`${cap(p.trim())}${question && i === parts.length - 1 ? '?' : '!'}`));
  }
  return out;
}

/** Texto final enviado à voz: frases separadas por linha (o serviço de voz fala uma a uma). */
export function speechScript(text: string, style: NarrationStyle): string {
  return style === 'comercial' ? commercialPhrases(text).join('\n') : speakable(text);
}

