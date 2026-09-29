import { VIDEO_FPS, VIDEO_H, VIDEO_W, frameCount } from '@gct/shared';
import { drawVideoFrame, type VideoData } from './video-render';

/**
 * Gera o MP4 no navegador: desenha cada quadro no canvas e codifica (WebCodecs via Mediabunny).
 * H.264 quando o navegador suporta (Chrome/Edge/Safari); senão VP9/AV1 no mesmo MP4.
 */
export async function encodeFlyerVideo(data: VideoData, onProgress: (p: number) => void): Promise<Blob> {
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableVideoCodec } = await import('mediabunny');
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
  await output.start();
  const total = frameCount(data.pages.length);
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
