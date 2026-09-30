import { formatBRL } from './money';

/** Gerador de texto de anúncio (Marketplace, OLX, WhatsApp). Puro: sem rede, sem banco. */

export type ListingCondition = 'new' | 'semi_new';

/** Padrões de anúncio da empresa (ficam em tenants.settings.listing). */
export interface ListingDefaults {
  condition: ListingCondition;
  /** 0 = sem garantia da loja. */
  warrantyMonths: number;
  /** Ex.: "Entregamos em toda Fortaleza e região". Vazio = não menciona entrega. */
  delivery: string;
  /** 0 = não aceita cartão; 1 = só à vista no cartão; N = até Nx. */
  cardInstallments: number;
  /** Observação livre no fim do anúncio completo. */
  extra: string;
  /** Frase de confiança (ex.: "Compra segura e produtos originais"). Vazio = não mostra. */
  highlight: string;
}

export const LISTING_DEFAULTS: ListingDefaults = { condition: 'new', warrantyMonths: 3, delivery: '', cardInstallments: 12, extra: '', highlight: 'Compra segura e produtos originais' };

/** Padrões efetivos: o que a empresa salvou, completado pelo padrão do sistema e pela cidade da empresa. */
export function listingDefaults(saved: Partial<ListingDefaults> | null | undefined, city?: string | null): ListingDefaults {
  const d = { ...LISTING_DEFAULTS, ...(saved ?? {}) };
  if (saved?.delivery === undefined && city?.trim()) d.delivery = `Entregamos em toda ${city.trim()} e região`;
  return d;
}

export interface ListingInput extends ListingDefaults {
  name: string;
  brand?: string | null;
  description?: string | null;
  variantLabel?: string | null;
  priceCents: string;
  /** Estado do seminovo (marcas, bateria, acessórios). */
  conditionNotes?: string | null;
  /**
   * Versão do texto: 0 = modelo clássico; 1, 2, 3… = outras redações (títulos, frases, emojis e ordem).
   * A mesma versão do mesmo produto sempre gera o mesmo texto; mudar a versão evita anúncios repetidos.
   */
  version?: number;
}

export interface Listing { title: string; short: string; full: string }

const TITLE_MAX = 99;

function months(n: number) {
  return `${n} ${n === 1 ? 'mês' : 'meses'}`;
}

function payment(n: number) {
  if (n <= 0) return 'Pix ou dinheiro';
  if (n === 1) return 'Pix, dinheiro ou cartão';
  return `Pix, dinheiro ou cartão em até ${n}x`;
}

/** Sorteio determinístico (mulberry32) a partir de texto + número. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildListing(i: ListingInput): Listing {
  const clean = (s?: string | null) => (s ?? '').trim();
  const name = clean(i.name);
  const variant = clean(i.variantLabel);
  const brand = clean(i.brand);
  const notes = clean(i.conditionNotes);
  const isNew = i.condition === 'new';
  const price = formatBRL(i.priceCents).replace(/\u00a0/g, ' ');
  const warranty = Math.max(0, Math.trunc(i.warrantyMonths));
  const cards = Math.max(0, Math.trunc(i.cardInstallments));
  const delivery = clean(i.delivery);
  const highlight = clean(i.highlight);
  const version = Math.max(0, Math.trunc(i.version ?? 0));
  const base = [name, variant && !name.toLowerCase().includes(variant.toLowerCase()) ? variant : ''].filter(Boolean).join(' ');
  const dot = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

  // Versão 0: modelo clássico. Demais: cada parte sorteia uma redação (a 1ª opção de cada lista é a clássica).
  const r = rng(`${version}|${base}`);
  const pick = <T,>(xs: T[]): T => (version === 0 ? xs[0]! : xs[Math.floor(r() * xs.length)]!);
  const shuffle = <T,>(xs: T[]): T[] => {
    if (version === 0) return xs;
    const out = [...xs];
    for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [out[k], out[j]] = [out[j]!, out[k]!]; }
    return out;
  };

  const cond = isNew ? 'Novo' : pick(['Seminovo', 'Seminovo', 'Semi-novo']);
  const w = months(warranty);
  const titles = [
    warranty > 0 ? `${base} - ${cond} com garantia de ${w}` : `${base} - ${cond}`,
    warranty > 0 ? `${base} ${cond} | Garantia de ${w}` : `${base} ${cond}`,
    warranty > 0 ? `${cond}: ${base} com ${w} de garantia` : `${cond}: ${base}`,
    cards > 1 ? `${base} - ${cond} - Até ${cards}x no cartão` : `${base} (${cond})`,
    delivery && warranty > 0 ? `${base} ${cond} - Garantia e entrega` : `${base} - ${cond}`,
  ];
  let title = pick(titles);
  if (title.length > TITLE_MAX) title = `${base} - ${cond}`;
  if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;

  const header = pick([`✨ ${base} – ${cond} ✨`, `🔥 ${base} – ${cond} 🔥`, `⭐ ${base} | ${cond}`, `🚀 ${base} – ${cond}`, `✅ ${base} (${cond})`]);
  const opener = pick(['', 'Olha essa oportunidade! 👀', 'Qualidade com preço justo.', `Procurando ${name}? Temos!`, 'Confira! 👇']);
  const condLine = isNew
    ? pick(['📦 Produto novo', '🆕 Produto novo', '✅ Novo, sem uso'])
    : pick([`♻️ Seminovo${notes ? `: ${notes}` : ' em ótimo estado'}`, `♻️ Seminovo${notes ? ` (${notes})` : ', muito bem conservado'}`]);
  const checks = [
    warranty > 0 ? pick([`🛡️ Garantia de ${w}`, `🛡️ ${w} de garantia da loja`, `✅ Garantia da loja: ${w}`]) : '',
    delivery ? `${pick(['🛵', '🚚', '📍'])} ${delivery}` : '',
    cards > 1 ? pick([`💳 Cartão em até ${cards}x`, `💳 Parcelamos em até ${cards}x no cartão`, `💳 Até ${cards}x no cartão`]) : cards === 1 ? '💳 Aceitamos cartão' : '',
    highlight ? `${pick(['🔒', '🤝', '✅'])} ${highlight}` : '',
  ].filter(Boolean);
  const priceLine = pick([`💰 ${price}`, `💰 Por ${price}`, `🏷️ ${price}`, `💵 Valor: ${price}`]);
  const cta = pick(['📲 Chama no chat!', '💬 Me chama no chat!', '📩 Manda uma mensagem e garanta o seu!', '👉 Chama no chat que respondo!']);
  const short = [header, ...(opener ? [opener] : []), '', condLine, ...shuffle(checks), '', priceLine, cta].join('\n');

  const full: string[] = [header, ''];
  if (opener) full.push(opener, '');
  if (clean(i.description)) full.push(clean(i.description), '');
  const specs = [
    brand ? `▪️ Marca: ${brand}` : '',
    variant ? `▪️ Modelo/variação: ${variant}` : '',
    isNew ? '▪️ Condição: novo' : `▪️ Condição: seminovo${notes ? ` (${notes})` : ', em ótimo estado'}`,
  ].filter(Boolean);
  full.push(pick(['📋 Detalhes', '📋 Ficha do produto', '🔎 Sobre o produto']), ...specs, '');
  const blocks: string[][] = [];
  if (warranty > 0) blocks.push([pick(['🛡️ Garantia', '🛡️ Garantia da loja']), pick([`${w} de garantia da loja.`, `Você leva com ${w} de garantia.`])]);
  if (delivery) blocks.push([pick(['🛵 Entrega', '🚚 Entrega', '📍 Entrega']), dot(delivery)]);
  blocks.push([pick(['💳 Pagamento', '💳 Formas de pagamento']), `${payment(cards)}.`]);
  for (const b of shuffle(blocks)) full.push(...b, '');
  if (highlight) full.push(`${pick(['🔒', '🤝', '✅'])} ${dot(highlight)}`, '');
  full.push(pick([`💰 Valor: ${price}`, `💰 Por apenas ${price}`, `🏷️ Preço: ${price}`]), '');
  if (clean(i.extra)) full.push(clean(i.extra), '');
  full.push(pick(['📲 Chama no chat que tiro suas dúvidas!', '💬 Ficou com dúvida? Me chama no chat!', '📩 Manda mensagem que te respondo!', '👉 Interessou? Chama no chat!']));

  return { title, short, full: full.join('\n').trim() };
}

/** Termos de garantia usados quando a empresa não definiu os seus: só defeitos do equipamento; não cobre mau uso. */
export const WARRANTY_TERMS_DEFAULT =
  'A garantia da loja cobre somente defeitos de funcionamento do próprio equipamento (defeitos de fabricação ou de componentes) que surgirem dentro do prazo indicado, sem custo de peças e mão de obra. '
  + 'A garantia não cobre mau uso: quedas, impactos, tela ou traseira trincada ou quebrada, contato com líquidos ou umidade, oxidação, danos elétricos por carregadores ou cabos inadequados, '
  + 'aparelho aberto ou reparado por terceiros, alteração de sistema (root, jailbreak e similares), perda de dados e desgaste natural da bateria. '
  + 'Para acionar, apresente o produto com este comprovante. Esta garantia não reduz os direitos previstos no Código de Defesa do Consumidor.';
