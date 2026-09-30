import { describe, expect, it } from 'vitest';
import { applyPronunciation, commercialPhrases, parsePronunciation, speakable, speechScript } from '../src';

describe('texto da narração', () => {
  it('troca símbolos de anúncio por palavras que a voz lê', () => {
    expect(speakable('Por R$ 1.599,90 em 12x')).toBe('Por 1599 reais e 90 centavos em 12 vezes');
    expect(speakable('R$ 1,00 ou R$ 50 ou R$ 0,5')).toBe('1 real ou 50 reais ou 50 centavos');
    expect(speakable('10% off, iPhone 128GB c/ capa')).toBe('10 por cento off, iPhone 128 gigas com capa');
    expect(speakable('Capa + película')).toBe('Capa mais película');
    expect(speakable('Ligue +55 85')).toBe('Ligue +55 85');
  });

  it('comercial: frases curtas com energia; perguntas continuam perguntas', () => {
    expect(commercialPhrases('Compre na TechFlash Portal os mais baratos com 3 meses de garantia, parcelado em até 12 vezes no cartão.')).toEqual([
      'Compre na TechFlash Portal os mais baratos com 3 meses de garantia!',
      'Parcelado em até 12 vezes no cartão!',
    ]);
    expect(commercialPhrases('Quer economizar? Capas, fones, cabos e muito mais. vem pra cá')).toEqual(['Quer economizar?', 'Capas, fones, cabos e muito mais!', 'Vem pra cá!']);
    expect(commercialPhrases('   ...  ')).toEqual([]);
  });

  it('natural mantém a leitura corrida; comercial separa por linha', () => {
    expect(speechScript('Oi, tudo bem com você. Tchau.', 'natural')).toBe('Oi, tudo bem com você. Tchau.');
    expect(speechScript('Oi, tudo bem com você. Tchau.', 'comercial')).toBe('Oi, tudo bem com você!\nTchau!');
  });
});

describe('pronúncia da loja', () => {
  const rules = 'TechFlash = Téc Flésh\nBluetooth=Blutúf\nlinha sem regra\n = vazio\nTech Flash Fortal = Téc Flésh Fortál';
  it('troca a palavra inteira, sem diferenciar maiúsculas, regras longas primeiro', () => {
    expect(applyPronunciation('Na TECHFLASH tem fone bluetooth.', rules)).toBe('Na Téc Flésh tem fone Blutúf.');
    expect(applyPronunciation('Tech Flash Fortal', rules)).toBe('Téc Flésh Fortál');
    expect(applyPronunciation('TechFlashes e SuperTechFlash ficam', rules)).toBe('TechFlashes e SuperTechFlash ficam');
    expect(applyPronunciation('Sem regras', '')).toBe('Sem regras');
    expect(parsePronunciation(rules)).toHaveLength(3);
  });
  it('não troca em cascata e aceita símbolos no termo', () => {
    expect(applyPronunciation('a b', 'a = b\nb = c')).toBe('b c');
    expect(applyPronunciation('Moto G(8) top', 'G(8) = gê oito')).toBe('Moto gê oito top');
  });
  it('entra antes da preparação do texto', () => {
    expect(speechScript('Na TechFlash, por R$ 10', 'natural', rules)).toBe('Na Téc Flésh, por 10 reais');
  });
});
