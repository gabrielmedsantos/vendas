'use client';

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Share2 } from 'lucide-react';
import { paginateVideo, videoDuration, VIDEO_H, VIDEO_W, type FlyerSettings } from '@gct/shared';
import { Button, Card, FormError } from '@/components/ui';
import { useToast } from '@/components/toast';
import { productCutout } from './cutout';
import type { FlyerItem, FlyerTheme } from './flyer-page';
import { encodeFlyerVideo, loadImage } from './video-encode';
import { drawVideoFrame, type VideoData } from './video-render';

const PREVIEW_W = 270;

/** Vídeo animado 9:16 (1080×1920) do encarte: prévia ao vivo e geração do MP4 no navegador. */
export function VideoStudio({ items, featured, theme, settings, logoUrl, companyName, cutout, fileName }: {
  items: FlyerItem[]; featured: Set<string>; theme: FlyerTheme; settings: FlyerSettings; logoUrl: string | null; companyName: string; cutout: boolean; fileName: string;
}) {
  const toast = useToast();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<VideoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const pages = paginateVideo(items, (i) => featured.has(i.id));
  const key = JSON.stringify([items.map((i) => i.id), [...featured], cutout, logoUrl]);

  // Carrega fotos (recortadas) e logo sempre que os produtos mudam.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const images = new Map<string, HTMLImageElement>();
      await Promise.all(items.filter((i) => i.imageId).map(async (i) => {
        const src = `/api/v1/attachments/${i.imageId}`;
        try { images.set(i.id, await loadImage(cutout ? await productCutout(src) : src)); } catch { /* sem foto: desenha o espaço reservado */ }
      }));
      const logo = logoUrl ? await loadImage(logoUrl).catch(() => null) : null;
      await document.fonts.load(`italic 900 60px 'Inter Variable'`).catch(() => undefined);
      if (alive) { setData({ pages: paginateVideo(items, (i) => featured.has(i.id)), images, logo, theme, settings, companyName }); setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Textos e cores mudam sem recarregar imagens.
  useEffect(() => { setData((d) => (d ? { ...d, theme, settings, companyName } : d)); }, [theme, settings, companyName]);
  useEffect(() => { setVideo(null); }, [key, theme, settings]);

  // Prévia tocando em loop.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    const ctx = c.getContext('2d')!;
    const total = videoDuration(data.pages.length);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 1000) % total;
      ctx.setTransform(PREVIEW_W / VIDEO_W, 0, 0, PREVIEW_W / VIDEO_W, 0, 0);
      drawVideoFrame(ctx, data, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const generate = async () => {
    if (!data) return;
    setError(null); setProgress(0);
    try {
      const blob = await encodeFlyerVideo(data, setProgress);
      if (video) URL.revokeObjectURL(video.url);
      setVideo({ url: URL.createObjectURL(blob), blob });
      toast('Vídeo pronto.');
    } catch (e) { setError(e instanceof Error ? e : new Error('Falha ao gerar o vídeo.')); } finally { setProgress(null); }
  };
  const share = async () => {
    if (!video) return;
    const file = new File([video.blob], `${fileName}.mp4`, { type: 'video/mp4' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: settings.title });
      else { const a = document.createElement('a'); a.href = video.url; a.download = file.name; a.click(); toast('Compartilhamento indisponível aqui; vídeo baixado.'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(e); }
  };

  const secs = Math.round(videoDuration(pages.length));
  return (
    <Card title="Vídeo animado (9:16)" description={`Formato de Status, Reels e Stories · 1080×1920 · ${pages.length} ${pages.length === 1 ? 'tela' : 'telas'} · cerca de ${secs} s`} action={
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={progress !== null} disabled={!data || loading || !pages.length || progress !== null} onClick={generate}><Clapperboard className="size-4" />{video ? 'Gerar de novo' : 'Gerar vídeo'}</Button>
        {video && <a className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-2" href={video.url} download={`${fileName}.mp4`}><Download className="size-4" />Baixar MP4</a>}
        {video && <Button size="sm" variant="secondary" onClick={share}><Share2 className="size-4" />Compartilhar</Button>}
      </div>
    }>
      <div className="flex flex-wrap items-start gap-6">
        <div className="shrink-0 overflow-hidden rounded-2xl shadow-lg" style={{ width: PREVIEW_W, height: (PREVIEW_W * VIDEO_H) / VIDEO_W }}>
          {pages.length ? <canvas ref={canvas} width={PREVIEW_W} height={(PREVIEW_W * VIDEO_H) / VIDEO_W} data-testid="video-preview" aria-label="Prévia do vídeo animado" /> : <p className="p-4 text-sm text-muted">Selecione produtos.</p>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
          {loading && <p className="text-muted">Preparando fotos…</p>}
          {progress !== null && (
            <div>
              <p className="mb-1 text-muted">Gerando vídeo… {Math.round(progress * 100)}%</p>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            </div>
          )}
          {video && <video src={video.url} controls playsInline className="w-56 rounded-xl border border-line" aria-label="Vídeo gerado" />}
          <p className="text-xs text-muted">A animação usa os mesmos produtos, fotos, logo, cores e textos do encarte. Até 6 produtos por tela; os destaques (estrela) aparecem primeiro. O vídeo é gerado no seu navegador, sem enviar nada para fora. Use Chrome ou Edge atualizados.</p>
          <FormError error={error} />
        </div>
      </div>
    </Card>
  );
}
