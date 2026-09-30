'use client';

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Mic, Music, Play, Share2, Square, Trash2, Upload } from 'lucide-react';
import { NARRATION_START, NARRATION_STYLES, NARRATION_VOICES, outroForNarration, paginateVideo, videoDuration, VIDEO_H, VIDEO_W, type FlyerSettings, type NarrationStyle, type NarrationVoice } from '@gct/shared';
import { Button, Field, FormError, Select, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/client/api';
import { useToast } from '@/components/toast';
import { productCutout } from './cutout';
import type { FlyerItem, FlyerTheme } from './flyer-page';
import { decodeNarration, encodeFlyerVideo, loadImage } from './video-encode';
import { mixTrack, prepareRecording, renderMusic } from './music';
import { drawVideoFrame, type VideoData } from './video-render';

const PREVIEW_W = 300;

/** Busca a fala gerada pelo serviço interno de voz (WAV). Mesma frase e voz: reaproveita. */
const narrationCache = new Map<string, Promise<ArrayBuffer>>();
function fetchNarration(text: string, voice: NarrationVoice, style: NarrationStyle, pronunciation: string): Promise<ArrayBuffer> {
  const key = `${voice}|${style}|${pronunciation}|${text}`;
  const hit = narrationCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const res = await fetch('/api/v1/flyer/narration', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice, style, pronunciation }) });
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

/** Vídeo animado 9:16 (1080×1920) do encarte: prévia ao vivo e geração do MP4 no navegador. */
export function VideoStudio({ items, featured, theme, settings, logoUrl, companyName, cutout, fileName, narration, voice, voiceStyle, music, pronunciation, onNarration, onVoice, onVoiceStyle, onMusic, onPronunciation, canSave }: {
  items: FlyerItem[]; featured: Set<string>; theme: FlyerTheme; settings: FlyerSettings; logoUrl: string | null; companyName: string; cutout: boolean; fileName: string;
  narration: string; voice: NarrationVoice; voiceStyle: NarrationStyle; music: boolean; pronunciation: string;
  onNarration: (t: string) => void; onVoice: (v: NarrationVoice) => void; onVoiceStyle: (s: NarrationStyle) => void; onMusic: (on: boolean) => void;
  onPronunciation: (t: string) => void; canSave: boolean;
}) {
  const [withVoice, setWithVoice] = useState(true);
  // Fonte da voz: automática (servidor) ou a gravação do próprio usuário (fica só nesta tela).
  const [source, setSource] = useState<'auto' | 'own'>('auto');
  const [own, setOwn] = useState<{ buffer: AudioBuffer; name: string } | null>(null);
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
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
  useEffect(() => { setVideo(null); }, [key, theme, settings, withVoice, voiceStyle, music, source, own]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - recording.started) / 1000);
      setRecSecs(secs);
      if (secs >= 60) recording.rec.stop(); // limite: 1 minuto
    }, 250);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { void player.current?.ctx.close(); }, []);

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

  const stop = () => {
    const p = player.current;
    player.current = null;
    setPlaying(false);
    if (p) { try { p.src.stop(); } catch { /* já parou */ } void p.ctx.close(); }
  };

  /** Voz (se ligada): a gravação do usuário ou a automática no estilo escolhido, já em 48 kHz. */
  const loadVoice = async (): Promise<AudioBuffer | null> => {
    if (!withVoice) return null;
    if (source === 'own') return own?.buffer ?? null;
    if (!narration.trim()) return null;
    return decodeNarration((await fetchNarration(narration.trim(), voice, voiceStyle, pronunciation)).slice(0));
  };

  const takeRecording = async (data: ArrayBuffer, name: string) => {
    try { setOwn({ buffer: await prepareRecording(data), name }); } catch (e) { setError(e instanceof Error ? e : new Error('Não consegui ler esse áudio. Envie MP3, M4A, WAV ou OGG.')); }
  };
  const startRecording = async () => {
    stop(); setError(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch {
      setError(new Error('Sem acesso ao microfone. Libere o microfone para este site no navegador ou envie um arquivo de áudio.'));
      return;
    }
    const rec = new MediaRecorder(stream);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(null);
      await takeRecording(await new Blob(parts, { type: rec.mimeType }).arrayBuffer(), 'Gravação do microfone');
    };
    rec.start();
    setRecSecs(0);
    setRecording({ rec, started: Date.now() });
  };

  // Ouvir: toca a mesma mixagem do vídeo (voz + trilha), só a duração da fala.
  const listen = async () => {
    stop();
    setError(null); setListening(true);
    try {
      const v = await loadVoice();
      const seconds = (v ? v.duration + 0.4 : 6) + 1.2;
      const track = mixTrack(seconds, v, music ? await renderMusic(seconds) : null, 0.4);
      const ctx = new AudioContext();
      const src = ctx.createBufferSource();
      src.buffer = track;
      src.connect(ctx.destination);
      src.onended = () => { if (player.current?.src === src) stop(); };
      await ctx.resume();
      src.start();
      player.current = { ctx, src };
      setPlaying(true);
    } catch (e) { setError(e); } finally { setListening(false); }
  };

  const generate = async () => {
    if (!data) return;
    stop();
    setError(null); setProgress(0);
    try {
      const v = await loadVoice();
      const render = v ? { ...data, outro: outroForNarration(data.pages.length, v.duration) } : data;
      const total = videoDuration(render.pages.length, render.outro);
      const track = v || music ? mixTrack(total, v, music ? await renderMusic(total) : null, NARRATION_START) : null;
      const blob = await encodeFlyerVideo(render, setProgress, track);
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
        {step(1, 'Voz e trilha', 'Locução em português gerada no seu servidor', (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={withVoice} onChange={(e) => setWithVoice(e.target.checked)} /><Mic className="size-4" />Narração com voz</label>
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={music} onChange={(e) => onMusic(e.target.checked)} /><Music className="size-4" />Trilha de fundo animada</label>
            </div>
            {withVoice && (
              <div className="flex gap-1 self-start rounded-xl border border-line bg-surface-2/50 p-1" role="radiogroup" aria-label="Fonte da voz">
                {([['auto', 'Voz automática'], ['own', 'Minha voz']] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={source === id} onClick={() => setSource(id)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${source === id ? 'bg-primary text-white' : 'text-muted hover:text-fg'}`}>{label}</button>
                ))}
              </div>
            )}
            {withVoice && source === 'auto' && (
              <>
                <Field label="Texto falado" htmlFor="vd-narr" help={`${narration.length}/600 caracteres${canSave ? ' · salvo em “Salvar identidade e textos”' : ''}`}>
                  <Textarea id="vd-narr" rows={3} maxLength={600} value={narration} onChange={(e) => onNarration(e.target.value)} />
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Voz" htmlFor="vd-voice">
                    <Select id="vd-voice" value={voice} onChange={(e) => onVoice(e.target.value as NarrationVoice)}>
                      {NARRATION_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Estilo" htmlFor="vd-style" help={NARRATION_STYLES.find((x) => x.id === voiceStyle)?.hint}>
                    <Select id="vd-style" value={voiceStyle} onChange={(e) => onVoiceStyle(e.target.value as NarrationStyle)}>
                      {NARRATION_STYLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label="Pronúncia" htmlFor="vd-pron" help="Se a voz errar uma palavra, escreva como se fala, uma por linha. Ex.: TechFlash = Téc Flésh">
                  <Textarea id="vd-pron" rows={2} maxLength={2000} placeholder={'TechFlash = Téc Flésh\nBluetooth = Blutúf'} value={pronunciation} onChange={(e) => onPronunciation(e.target.value)} />
                </Field>
                <p className="text-xs text-muted">Voz sintética gratuita, gerada no seu servidor. Para um som mais natural, use “Minha voz”.</p>
              </>
            )}
            {withVoice && source === 'own' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">Grave pelo microfone (até 1 minuto) ou envie um áudio gravado no celular. Silêncio do começo e do fim é cortado e o volume é nivelado.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {recording
                    ? <Button variant="danger" onClick={() => recording.rec.stop()}><Square className="size-4" />Parar gravação · {recSecs}s</Button>
                    : <Button variant="secondary" onClick={startRecording}><Mic className="size-4" />Gravar</Button>}
                  <Button variant="secondary" disabled={!!recording} onClick={() => fileInput.current?.click()}><Upload className="size-4" />Enviar áudio</Button>
                  <input ref={fileInput} type="file" accept="audio/*" className="hidden" aria-label="Arquivo de áudio da narração"
                    onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setError(null); await takeRecording(await f.arrayBuffer(), f.name); } }} />
                </div>
                {own ? (
                  <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <Mic className="size-4 text-primary-soft" />
                    <span className="min-w-0 flex-1 truncate">{own.name} · {own.buffer.duration.toFixed(1).replace('.', ',')} s</span>
                    <Button variant="quiet" aria-label="Remover gravação" onClick={() => setOwn(null)}><Trash2 className="size-4" /></Button>
                  </div>
                ) : <p className="text-xs text-muted">Nenhuma gravação ainda. A gravação fica só nesta tela; ela não é salva no sistema.</p>}
              </div>
            )}
            {withVoice && <p className="text-xs text-muted">Se a fala for maior que a animação, o final do vídeo se estende para caber.</p>}
            <div>
              {playing
                ? <Button variant="secondary" onClick={stop}><Square className="size-4" />Parar</Button>
                : <Button variant="secondary" loading={listening} disabled={!(withVoice && (source === 'own' ? own : narration.trim().length >= 3)) && !music} onClick={listen}><Play className="size-4" />Ouvir</Button>}
            </div>
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
