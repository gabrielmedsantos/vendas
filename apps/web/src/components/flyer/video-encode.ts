import { NARRATION_START, VIDEO_FPS, VIDEO_H, VIDEO_W, frameCount, videoDuration } from '@gct/shared';
import { drawVideoFrame, type VideoData } from './video-render';

/**
 * Gera o MP4 no navegador: desenha cada quadro no canvas e codifica (WebCodecs via Mediabunny).
 * H.264 quando o navegador suporta (Chrome/Edge/Safari); senão VP9/AV1 no mesmo MP4.
 */
export async function encodeFlyerVideo(data: VideoData, onProgress: (p: number) => void, narration?: AudioBuffer | null): Promise<Blob> {
  const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } = await import('mediabunny');
  if (typeof VideoEncoder === 'undefined') throw new Error('Este navegador não gera vídeo. Use o Chrome ou o Edge atualizados.');
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: VIDEO_W, height: VIDEO_H });
  if (!codec) throw new Error('Este navegador não consegue codificar vídeo. Use o Chrome ou o Edge atualizados.');
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  // Narração: faixa de áudio do tamanho do vídeo, com a fala começando logo no início.
  let audio: { source: InstanceType<typeof AudioBufferSource>; buffer: AudioBuffer } | null = null;
  if (narration) {
    const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 1, sampleRate: narration.sampleRate });
    if (!codec) throw new Error('Este navegador não consegue codificar o áudio da narração. Use o Chrome ou o Edge atualizados.');
    const aSource = new AudioBufferSource({ codec, quality: QUALITY_HIGH });
    output.addAudioTrack(aSource);
    audio = { source: aSource, buffer: placeNarration(narration, videoDuration(data.pages.length, data.outro)) };
  }
  await output.start();
  if (audio) await audio.source.add(audio.buffer);
  const total = frameCount(data.pages.length, VIDEO_FPS, data.outro);
  for (let i = 0; i < total; i++) {
    const t = i / VIDEO_FPS;
    drawVideoFrame(ctx, data, t);
    await source.add(t, 1 / VIDEO_FPS);
    if (i % 5 === 0) onProgress(i / total);
  }
  await output.finalize();
  onProgress(1);
  return new Blob([(output.target as InstanceType<typeof BufferTarget>).buffer!], { type: 'video/mp4' });
}

/** Carrega imagens (fotos recortadas e logo) antes de desenhar. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** Coloca a fala em uma faixa do tamanho do vídeo, a partir de NARRATION_START (silêncio antes e depois). */
function placeNarration(voice: AudioBuffer, totalSeconds: number): AudioBuffer {
  const rate = voice.sampleRate;
  const out = new AudioBuffer({ length: Math.ceil(totalSeconds * rate), numberOfChannels: 1, sampleRate: rate });
  const src = voice.getChannelData(0);
  const offset = Math.round(NARRATION_START * rate);
  out.getChannelData(0).set(src.subarray(0, Math.max(0, out.length - offset)), offset);
  return out;
}

/** WAV da narração → AudioBuffer em 48 kHz (taxa aceita pelos codificadores AAC/Opus). */
export async function decodeNarration(wav: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 48000, 48000);
  return ctx.decodeAudioData(wav);
}
