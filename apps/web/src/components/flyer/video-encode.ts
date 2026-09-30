import { VIDEO_FPS, VIDEO_H, VIDEO_W, frameCount } from '@gct/shared';
import { drawVideoFrame, type VideoData } from './video-render';

/**
 * Gera o MP4 no navegador: desenha cada quadro no canvas e codifica (WebCodecs via Mediabunny).
 * H.264 quando o navegador suporta (Chrome/Edge/Safari); senão VP9/AV1 no mesmo MP4.
 */
/** `track`: faixa de áudio já mixada (voz + trilha) do tamanho do vídeo, ou null para vídeo mudo. */
export async function encodeFlyerVideo(data: VideoData, onProgress: (p: number) => void, track?: AudioBuffer | null): Promise<Blob> {
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
  let audio: InstanceType<typeof AudioBufferSource> | null = null;
  if (track) {
    const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 1, sampleRate: track.sampleRate });
    if (!codec) throw new Error('Este navegador não consegue codificar o áudio do vídeo. Use o Chrome ou o Edge atualizados.');
    audio = new AudioBufferSource({ codec, quality: QUALITY_HIGH });
    output.addAudioTrack(audio);
  }
  await output.start();
  if (audio && track) await audio.add(track);
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

/** WAV da narração → AudioBuffer em 48 kHz (taxa aceita pelos codificadores AAC/Opus). */
export async function decodeNarration(wav: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 48000, 48000);
  return ctx.decodeAudioData(wav);
}
