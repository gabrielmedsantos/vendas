'use client';

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Mic, Play, Share2 } from 'lucide-react';
import { NARRATION_VOICES, outroForNarration, paginateVideo, videoDuration, VIDEO_H, VIDEO_W, type FlyerSettings, type NarrationVoice } from '@gct/shared';
import { Button, Field, FormError, Select, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/client/api';
import { useToast } from '@/components/toast';
import { productCutout } from './cutout';
import type { FlyerItem, FlyerTheme } from './flyer-page';
import { decodeNarration, encodeFlyerVideo, loadImage } from './video-encode';
import { drawVideoFrame, type VideoData } from './video-render';

const PREVIEW_W = 300;

/** Vídeo animado 9:16 (1080×1920) do encarte: prévia ao vivo e geração do MP4 no navegador. */
/** Busca a fala gerada pelo serviço interno de voz (WAV). Mesma frase e voz: reaproveita. */
const narrationCache = new Map<string, Promise<ArrayBuffer>>();
function fetchNarration(text: string, voice: NarrationVoice): Promise<ArrayBuffer> {
  const key = `${voice}|${text}`;
  const hit = narrationCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const res = await fetch('/api/v1/flyer/narration', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))).error ?? {};
      throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Não foi possível gerar a narração.', e.fields);
    }
    return res.arrayBuffer();
  })();
  narrationCache.set(key, job);
  job.catch(() => narrationCache.delete(key));
  return job;
}

export function VideoStudio({ items, featured, theme, settings, logoUrl, companyName, cutout, fileName, narration, voice, onNarration, onVoice, canSave }: {
  items: FlyerItem[]; featured: Set<string>; theme: FlyerTheme; settings: FlyerSettings; logoUrl: string | null; companyName: string; cutout: boolean; fileName: string;
  narration: string; voice: NarrationVoice; onNarration: (t: string) => void; onVoice: (v: NarrationVoice) => void; canSave: boolean;
}) {
  const [withVoice, setWithVoice] = useState(true);
  const [listening, setListening] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
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
  useEffect(() => { setVideo(null); }, [key, theme, settings, withVoice]);

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

  const listen = async () => {
    setError(null); setListening(true);
    try {
      const wav = await fetchNarration(narration.trim(), voice);
      player.current?.pause();
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      player.current = new Audio(url);
      await player.current.play();
    } catch (e) { setError(e); } finally { setListening(false); }
  };

  const generate = async () => {
    if (!data) return;
    setError(null); setProgress(0);
    try {
      let voiceBuf: AudioBuffer | null = null;
      let render = data;
      if (withVoice && narration.trim()) {
        voiceBuf = await decodeNarration((await fetchNarration(narration.trim(), voice)).slice(0));
        render = { ...data, outro: outroForNarration(data.pages.length, voiceBuf.duration) };
      }
      const blob = await encodeFlyerVideo(render, setProgress, voiceBuf);
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
  const step = (n: number, title: string, hint: string, body: React.ReactNode) => (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary-soft">{n}</span>
        <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
      </header>
      {body}
    </section>
  );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[auto_minmax(0,1fr)]">
      {/* Prévia dentro de um celular. */}
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-[46px] border border-line-strong bg-black p-3 shadow-2xl ring-1 ring-white/5">
          <div className="relative overflow-hidden rounded-[34px] bg-bg" style={{ width: PREVIEW_W, height: (PREVIEW_W * VIDEO_H) / VIDEO_W }}>
            <span className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" aria-hidden />
            {pages.length ? <canvas ref={canvas} width={PREVIEW_W} height={(PREVIEW_W * VIDEO_H) / VIDEO_W} data-testid="video-preview" aria-label="Prévia do vídeo animado" /> : <p className="p-6 pt-12 text-center text-sm text-muted">Selecione produtos no painel ao lado.</p>}
          </div>
        </div>
        <p className="text-xs text-muted">{pages.length} {pages.length === 1 ? 'tela' : 'telas'} · cerca de {secs} s · prévia em tempo real</p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {step(1, 'Narração', 'Voz em português gerada no seu servidor', (
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={withVoice} onChange={(e) => setWithVoice(e.target.checked)} /><Mic className="size-4" />Narração com voz</label>
            {withVoice && (
              <>
                <Field label="Texto falado" htmlFor="vd-narr" help={`${narration.length}/600 caracteres${canSave ? ' · salvo em “Salvar identidade e textos”' : ''}`}>
                  <Textarea id="vd-narr" rows={3} maxLength={600} value={narration} onChange={(e) => onNarration(e.target.value)} />
                </Field>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1">
                    <Field label="Voz" htmlFor="vd-voice">
                      <Select id="vd-voice" value={voice} onChange={(e) => onVoice(e.target.value as NarrationVoice)}>
                        {NARRATION_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Button variant="secondary" loading={listening} disabled={narration.trim().length < 3} onClick={listen}><Play className="size-4" />Ouvir</Button>
                </div>
                <p className="text-xs text-muted">Se a fala for maior que a animação, o final do vídeo se estende para caber.</p>
              </>
            )}
          </div>
        ))}
        {step(2, 'Gerar o vídeo', 'MP4 1080×1920 feito no seu navegador (Chrome ou Edge)', (
          <div className="flex flex-col gap-3 text-sm">
            <Button className="w-full sm:w-auto" loading={progress !== null} disabled={!data || loading || !pages.length || progress !== null} onClick={generate}><Clapperboard className="size-4" />{video ? 'Gerar de novo' : 'Gerar vídeo'}</Button>
            {loading && <p className="text-muted">Preparando fotos…</p>}
            {progress !== null && (
              <div>
                <p className="mb-1 text-muted">Gerando vídeo… {Math.round(progress * 100)}%</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              </div>
            )}
            <FormError error={error} />
          </div>
        ))}
        {step(3, 'Baixar ou enviar', video ? 'Pronto para Status, Reels e Stories' : 'Aparece aqui depois de gerar', video ? (
          <div className="flex flex-wrap items-start gap-4">
            <video src={video.url} controls playsInline className="w-44 rounded-xl border border-line" aria-label="Vídeo gerado" />
            <div className="flex flex-col gap-2">
              <a className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-110" href={video.url} download={`${fileName}.mp4`}><Download className="size-4" />Baixar MP4</a>
              <Button variant="secondary" onClick={share}><Share2 className="size-4" />Compartilhar</Button>
            </div>
          </div>
        ) : <p className="text-sm text-muted">Nenhum vídeo gerado ainda.</p>)}
      </div>
    </div>
  );
}
