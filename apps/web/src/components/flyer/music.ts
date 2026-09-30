/**
 * Trilha de fundo do vídeo do encarte: batida pop animada (120 BPM) sintetizada no navegador.
 * Original, gerada por código: sem arquivo de música de terceiros nem direito autoral envolvido.
 * A mixagem abaixa a trilha enquanto a voz fala (ducking) e nivela o resultado.
 */

const RATE = 48000;
const BPM = 120;
const BEAT = 60 / BPM;
// C – G – Am – F (um acorde por compasso de 4 tempos).
const CHORDS: number[][] = [
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
];

function noise(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
  return b;
}

function env(g: GainNode, t: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

/** Renderiza `seconds` de trilha (mono, 48 kHz). Fade-in curto e fade-out no final. */
export async function renderMusic(seconds: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1, 0.15);
  master.gain.setValueAtTime(1, Math.max(0.15, seconds - 1.5));
  master.gain.linearRampToValueAtTime(0, seconds);
  master.connect(ctx.destination);
  const hiss = noise(ctx);

  const kick = (t: number) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.9, 0.32); o.connect(g).connect(master); o.start(t); o.stop(t + 0.35);
  };
  const hat = (t: number, peak: number) => {
    const s = ctx.createBufferSource(); s.buffer = hiss;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); env(g, t, peak, 0.05);
    s.connect(f).connect(g).connect(master); s.start(t, 0.1, 0.08);
  };
  const clap = (t: number) => {
    const s = ctx.createBufferSource(); s.buffer = hiss;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
    const g = ctx.createGain(); env(g, t, 0.45, 0.16);
    s.connect(f).connect(g).connect(master); s.start(t, 0.2, 0.2);
  };
  const bass = (t: number, freq: number) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain(); env(g, t, 0.28, BEAT * 0.45);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + BEAT * 0.5);
  };
  const stab = (t: number, notes: number[]) => {
    for (const n of notes) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = n * 2;
      const g = ctx.createGain(); env(g, t, 0.07, 0.2);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.22);
    }
  };

  const beats = Math.ceil(seconds / BEAT);
  for (let b = 0; b < beats; b++) {
    const t = b * BEAT;
    const chord = CHORDS[Math.floor(b / 4) % CHORDS.length]!;
    kick(t);
    if (b % 2 === 1) clap(t);
    hat(t, 0.08); hat(t + BEAT / 2, 0.16);
    bass(t, chord[0]! / 4); bass(t + BEAT / 2, chord[0]! / 2);
    stab(t + BEAT / 2, chord);
  }
  return ctx.startRendering();
}

/**
 * Junta voz e trilha numa faixa do tamanho do vídeo. A voz começa em `voiceAt` (s);
 * enquanto ela fala, a trilha cai para ~28% (sobe de volta devagar nas pausas).
 */
export function mixTrack(totalSeconds: number, voice: AudioBuffer | null, music: AudioBuffer | null, voiceAt: number): AudioBuffer {
  const out = new AudioBuffer({ length: Math.ceil(totalSeconds * RATE), numberOfChannels: 1, sampleRate: RATE });
  const o = out.getChannelData(0);
  const v = new Float32Array(o.length);
  if (voice) {
    const src = voice.getChannelData(0);
    const off = Math.round(voiceAt * RATE);
    v.set(src.subarray(0, Math.max(0, o.length - off)), off);
  }
  const m = music?.getChannelData(0);
  const bed = voice ? 0.42 : 0.6;
  // Envelope da voz → ganho da trilha: ataque rápido (30 ms), soltura lenta (400 ms).
  const att = 1 - Math.exp(-1 / (0.03 * RATE));
  const rel = 1 - Math.exp(-1 / (0.4 * RATE));
  let e = 0;
  let peak = 0;
  for (let i = 0; i < o.length; i++) {
    const a = Math.abs(v[i]!);
    e += (a > e ? att : rel) * (a - e);
    const duck = 1 - 0.72 * Math.min(1, e / 0.05);
    const x = v[i]! + (m && i < m.length ? m[i]! * bed * duck : 0);
    o[i] = x;
    if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  if (peak > 0.97) { const k = 0.97 / peak; for (let i = 0; i < o.length; i++) o[i] = o[i]! * k; }
  return out;
}
