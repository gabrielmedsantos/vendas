import { describe, expect, it } from 'vitest';
import { outroForNarration, NARRATION_START, cardProgress, easeOutBack, frameCount, pageDuration, paginateVideo, sceneAt, seeded, videoDuration, VIDEO_TIMING } from '../src';

describe('vídeo do encarte', () => {
  it('pagina 6 por página com destaques primeiro', () => {
    const pages = paginateVideo([1, 2, 3, 4, 5, 6, 7, 8], (n) => n === 8);
    expect(pages).toEqual([[8, 1, 2, 3, 4, 5], [6, 7]]);
    expect(paginateVideo([])).toEqual([]);
  });

  it('linha do tempo: abertura, páginas (entrada, pausa, saída) e final', () => {
    const d = videoDuration(2);
    expect(d).toBeCloseTo(VIDEO_TIMING.intro + 2 * pageDuration() + VIDEO_TIMING.outro);
    expect(frameCount(2, 30)).toBe(Math.ceil(d * 30));
    expect(sceneAt(0, 2).kind).toBe('intro');
    const s1 = sceneAt(VIDEO_TIMING.intro + 0.1, 2);
    expect(s1).toMatchObject({ kind: 'page', page: 0, phase: 'enter' });
    const s2 = sceneAt(VIDEO_TIMING.intro + pageDuration() + VIDEO_TIMING.enter + 0.5, 2);
    expect(s2).toMatchObject({ kind: 'page', page: 1, phase: 'hold' });
    expect(sceneAt(d - 0.01, 2).kind).toBe('outro');
    expect(sceneAt(0.5, 0).kind).toBe('intro');
    expect(sceneAt(2, 0).kind).toBe('outro');
  });

  it('cards entram em sequência; curva de pulo termina em 1', () => {
    expect(cardProgress(0, 0)).toBe(0);
    expect(cardProgress(0.12, 1)).toBe(0);
    expect(cardProgress(2, 5)).toBe(1);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(easeOutBack(0.6)).toBeGreaterThan(1); // passa do ponto antes de assentar
  });

  it('aleatório determinístico', () => {
    const a = seeded(7), b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('narração longa estende o final; curta não muda a duração', () => {
    const base = videoDuration(1);
    expect(outroForNarration(1, 2)).toBe(VIDEO_TIMING.outro);
    const o = outroForNarration(1, base + 3);
    expect(videoDuration(1, o)).toBeCloseTo(NARRATION_START + base + 3 + 0.6);
    expect(sceneAt(videoDuration(1, o) - 0.01, 1, o).kind).toBe('outro');
  });
});
