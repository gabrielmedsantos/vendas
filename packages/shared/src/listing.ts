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

export function buildListing(i: ListingInput): Listing {
  const clean = (s?: string | null) => (s ?? '').trim();
  const name = clean(i.name);
  const variant = clean(i.variantLabel);
  const brand = clean(i.brand);
  const notes = clean(i.conditionNotes);
  const cond = i.condition === 'new' ? 'Novo' : 'Seminovo';
  const price = formatBRL(i.priceCents).replace(' ', ' ');
  const warranty = Math.max(0, Math.trunc(i.warrantyMonths));
  const cards = Math.max(0, Math.trunc(i.cardInstallments));
  const delivery = clean(i.delivery);

  const base = [name, variant && !name.toLowerCase().includes(variant.toLowerCase()) ? variant : ''].filter(Boolean).join(' ');
  let title = `${base} - ${cond}`;
  if (warranty > 0) title += ` com garantia de ${months(warranty)}`;
  if (title.length > TITLE_MAX) title = `${base} - ${cond}`;
  if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;

  const highlight = clean(i.highlight);
  const header = `✨ ${base} – ${cond} ✨`;
  const condLine = i.condition === 'new' ? '📦 Produto novo' : `♻️ Seminovo${notes ? `: ${notes}` : ' em ótimo estado'}`;
  const checks = [
    condLine,
    warranty > 0 ? `🛡️ Garantia de ${months(warranty)}` : '',
    delivery ? `🛵 ${delivery}` : '',
    cards > 1 ? `💳 Cartão em até ${cards}x` : cards === 1 ? '💳 Aceitamos cartão' : '',
    highlight ? `🔒 ${highlight}` : '',
  ].filter(Boolean);
  const short = [header, '', ...checks, '', `💰 ${price}`, '📲 Chama no chat!'].join('\n');

  const dot = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const full: string[] = [header, ''];
  if (clean(i.description)) full.push(clean(i.description), '');
  const specs = [
    brand ? `▪️ Marca: ${brand}` : '',
    variant ? `▪️ Modelo/variação: ${variant}` : '',
    i.condition === 'new' ? '▪️ Condição: novo' : `▪️ Condição: seminovo${notes ? ` (${notes})` : ', em ótimo estado'}`,
  ].filter(Boolean);
  full.push('📋 Detalhes', ...specs, '');
  if (warranty > 0) {
    full.push(
      '🛡️ Garantia',
      `${months(warranty)} de garantia da loja contra defeitos de funcionamento do aparelho.`,
      '⚠️ Não cobre mau uso (quedas, tela ou traseira quebrada, contato com líquidos, aparelho aberto ou reparado por terceiros).',
      '',
    );
  }
  if (delivery) full.push('🛵 Entrega', dot(delivery), '');
  full.push('💳 Pagamento', `${payment(cards)}.`, '');
  if (highlight) full.push(`🔒 ${dot(highlight)}`, '');
  full.push(`💰 Valor: ${price}`, '');
  if (clean(i.extra)) full.push(clean(i.extra), '');
  full.push('📲 Chama no chat que tiro suas dúvidas!');

  return { title, short, full: full.join('\n').trim() };
}
