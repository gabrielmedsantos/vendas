import { describe, expect, it } from 'vitest';
import { buildListing, listingDefaults } from '../src';

const base = { name: 'iPhone 13', brand: 'Apple', variantLabel: '128 GB Azul', priceCents: '329900', description: null, conditionNotes: null };

describe('anúncio', () => {
  it('padrão: novo, 3 meses de garantia, entrega na cidade da empresa, 12x no cartão', () => {
    const d = listingDefaults(null, 'Fortaleza');
    expect(d).toMatchObject({ condition: 'new', warrantyMonths: 3, cardInstallments: 12, delivery: 'Entregamos em toda Fortaleza e região' });
    const l = buildListing({ ...base, ...d });
    expect(l.title).toBe('iPhone 13 128 GB Azul - Novo com garantia de 3 meses');
    expect(l.short).toContain('📦 Produto novo');
    expect(l.short).toContain('🛡️ Garantia de 3 meses');
    expect(l.short).toContain('🛵 Entregamos em toda Fortaleza e região');
    expect(l.short).toContain('💳 Cartão em até 12x');
    expect(l.short).toContain('R$ 3.299,00');
    expect(l.full).toContain('🛡️ Garantia\n3 meses de garantia da loja.');
    expect(l.full).not.toContain('mau uso');
    expect(l.full).toContain('Pix, dinheiro ou cartão em até 12x.');
    expect(l.full).toContain('▪️ Marca: Apple');
    expect(l.short).toContain('🔒 Compra segura e produtos originais');
    expect(l.full).toContain('🔒 Compra segura e produtos originais.');
  });

  it('seminovo com estado descrito, sem garantia e sem cartão', () => {
    const l = buildListing({ ...base, ...listingDefaults({ delivery: '' }), condition: 'semi_new', conditionNotes: 'bateria 89%, sem marcas', warrantyMonths: 0, cardInstallments: 0 });
    expect(l.title).toBe('iPhone 13 128 GB Azul - Seminovo');
    expect(l.short).toContain('♻️ Seminovo: bateria 89%, sem marcas');
    expect(l.short).not.toContain('Garantia');
    expect(listingDefaults({ highlight: '' }).highlight).toBe('');
    expect(l.short).not.toContain('Entreg');
    expect(l.full).toContain('Condição: seminovo (bateria 89%, sem marcas)');
    expect(l.full).toContain('Pix ou dinheiro.');
    expect(l.full).not.toContain('🛡️');
  });

  it('padrão salvo pela empresa prevalece sobre a cidade; título nunca passa de 99 caracteres', () => {
    expect(listingDefaults({ delivery: 'Retirada no centro' }, 'Fortaleza').delivery).toBe('Retirada no centro');
    const l = buildListing({ ...base, ...listingDefaults(null), name: 'X'.repeat(150) });
    expect(l.title.length).toBeLessThanOrEqual(99);
  });
});
