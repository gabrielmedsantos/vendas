import { describe, expect, it } from 'vitest';
import { parse, zCashMovement } from '../src';

describe('mensagens de validação em português', () => {
  it('campos faltando e inválidos saem em português; mensagens próprias ficam', () => {
    try {
      parse(zCashMovement, { accountId: 'x', kind: 'capital_in' });
      throw new Error('deveria falhar');
    } catch (e) {
      const f = (e as { fields: Record<string, string> }).fields;
      expect(f.amountCents).toBe('Campo obrigatório');
      expect(f.accountId).toMatch(/inválid/i);
      expect(Object.values(f).join(' ')).not.toMatch(/Invalid|expected|received/);
    }
  });
  it('lançamento sem descrição é aceito', () => {
    expect(parse(zCashMovement, { accountId: '00000000-0000-4000-8000-000000000000', kind: 'capital_in', amountCents: '50000' }).description).toBeUndefined();
  });
});
