/** Vídeo animado do encarte (Stories/Reels/Status): linha do tempo e curvas de animação, puras. */

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const VIDEO_FPS = 30;
export const VIDEO_PER_PAGE = 6; // 2 colunas × 3 linhas

/** Durações em segundos. */
export const VIDEO_TIMING = { intro: 0.9, enter: 1.1, hold: 1.9, exit: 0.55, outro: 2.2, stagger: 0.12 };

export type VideoScene =
  | { kind: 'intro'; t: number; p: number }
  | { kind: 'page'; page: number; phase: 'enter' | 'hold' | 'exit'; t: number; p: number; pageT: number }
  | { kind: 'outro'; t: number; p: number };

/** Páginas do vídeo: destaques primeiro, 6 produtos por página. */
export function paginateVideo<T>(items: T[], isFeatured: (t: T) => boolean = () => false): T[][] {
  const ordered = [...items.filter(isFeatured), ...items.filter((t) => !isFeatured(t))];
  const pages: T[][] = [];
  for (let i = 0; i < ordered.length; i += VIDEO_PER_PAGE) pages.push(ordered.slice(i, i + VIDEO_PER_PAGE));
  return pages;
}

export function pageDuration(): number {
  return VIDEO_TIMING.enter + VIDEO_TIMING.hold + VIDEO_TIMING.exit;
}

export function videoDuration(pages: number): number {
  return VIDEO_TIMING.intro + Math.max(pages, 0) * pageDuration() + VIDEO_TIMING.outro;
}

export function frameCount(pages: number, fps = VIDEO_FPS): number {
  return Math.ceil(videoDuration(pages) * fps);
}

/** Em que parte do vídeo está o instante `t` (s). `p` = progresso 0..1 dentro da fase. */
export function sceneAt(t: number, pages: number): VideoScene {
  const { intro, enter, hold, exit, outro } = VIDEO_TIMING;
  if (t < intro) return { kind: 'intro', t, p: clamp01(t / intro) };
  let x = t - intro;
  const pd = pageDuration();
  if (pages > 0 && x < pages * pd) {
    const page = Math.min(pages - 1, Math.floor(x / pd));
    const pageT = x - page * pd;
    if (pageT < enter) return { kind: 'page', page, phase: 'enter', t: pageT, p: clamp01(pageT / enter), pageT };
    if (pageT < enter + hold) return { kind: 'page', page, phase: 'hold', t: pageT - enter, p: clamp01((pageT - enter) / hold), pageT };
    return { kind: 'page', page, phase: 'exit', t: pageT - enter - hold, p: clamp01((pageT - enter - hold) / exit), pageT };
  }
  x -= pages * pd;
  return { kind: 'outro', t: x, p: clamp01(x / outro) };
}

/** Progresso (0..1) da entrada do card `index` dentro da página, com escalonamento. */
export function cardProgress(pageT: number, index: number, duration = 0.5): number {
  return clamp01((pageT - index * VIDEO_TIMING.stagger) / duration);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInCubic = (x: number) => clamp01(x) ** 3;
/** Passa um pouco do ponto e volta (efeito "pulo"). */
export function easeOutBack(x: number, s = 1.70158): number {
  const c = clamp01(x) - 1;
  return 1 + (s + 1) * c ** 3 + s * c ** 2;
}

/** Gerador pseudoaleatório determinístico (mesmo vídeo a cada geração). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
