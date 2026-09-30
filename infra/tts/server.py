"""Serviço interno de fala (TTS). Só na rede interna do compose; nunca exposto à internet.

POST /synthesize  {"text": "...", "voice": "pf_dora", "speed": 1.0, "style": "comercial"}  → audio/wav (PCM 16 bits, 24 kHz)
  style "comercial": cada linha do texto é uma frase falada com energia; pausas curtas e volume nivelado.
  style "natural":   leitura corrida do texto inteiro.
GET  /health      → 200 quando o modelo está carregado
"""
import io
import json
import os
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro_onnx import Kokoro

MODELS = os.environ.get("TTS_MODELS", "/models")
VOICES = {"pf_dora", "pm_alex", "pm_santa"}
MAX_CHARS = 900  # o app limita a 600; a preparação do texto ("R$ 10" → "10 reais") pode alongar
kokoro = Kokoro(f"{MODELS}/kokoro-v1.0.int8.onnx", f"{MODELS}/voices-v1.0.bin")
lock = threading.Lock()  # uma síntese por vez: previsível em CPU pequena


def trim(x: np.ndarray, rate: int, thr: float = 0.012) -> np.ndarray:
    """Tira o silêncio do começo e do fim (com 30 ms de folga)."""
    idx = np.flatnonzero(np.abs(x) > thr)
    if idx.size == 0:
        return x[:0]
    pad = int(0.03 * rate)
    return x[max(0, idx[0] - pad): idx[-1] + pad]


def tighten(x: np.ndarray, rate: int, max_pause: float = 0.16) -> np.ndarray:
    """Encurta pausas internas longas: ritmo de anúncio, sem "respiros" demorados."""
    hop = int(0.01 * rate)
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1))
    quiet = rms < 0.01
    keep = np.ones(n, dtype=bool)
    limit = int(max_pause / 0.01)
    run = 0
    for i in range(n):
        run = run + 1 if quiet[i] else 0
        if run > limit:
            keep[i] = False
    parts = [x[i * hop:(i + 1) * hop] for i in range(n) if keep[i]]
    return np.concatenate(parts + [x[n * hop:]])


def level(x: np.ndarray, rate: int, target_db: float = -16.0) -> np.ndarray:
    """Volume de locução: compressão suave (partes fracas sobem), RMS alvo e limitador sem estourar."""
    hop = int(0.02 * rate)
    n = -(-len(x) // hop)
    if n == 0:
        return x
    frames = np.pad(x, (0, n * hop - len(x))).reshape(n, hop)
    rms = np.sqrt(np.mean(frames ** 2, axis=1)) + 1e-6
    # Compressão 3:1 acima de -30 dBFS; ganho suavizado (100 ms) para não "bombear".
    db = 20 * np.log10(rms)
    gain_db = np.convolve(np.where(db > -30, -(db + 30) * (2 / 3), 0.0), np.ones(5) / 5, mode="same")
    y = (frames * (10 ** (gain_db / 20))[:, None]).reshape(-1)[: len(x)]
    voiced = rms > 0.01
    ref = y[: len(x)]
    if voiced.any():
        ref = np.pad(y, (0, n * hop - len(y))).reshape(n, hop)[voiced]
    y = y * (10 ** (target_db / 20) / max(float(np.sqrt(np.mean(ref ** 2))), 1e-4))
    return (0.95 * np.tanh(y / 0.95)).astype(np.float32)  # limitador suave: picos nunca passam de -0,4 dBFS


def commercial(text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    chunks, rate = [], 24000
    for i, line in enumerate(lines):
        samples, rate = kokoro.create(line, voice=voice, speed=speed, lang="pt-br")
        chunks.append(tighten(trim(np.asarray(samples, dtype=np.float32), rate), rate))
        if i < len(lines) - 1:
            chunks.append(np.zeros(int(0.12 * rate), dtype=np.float32))
    return level(np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32), rate), rate


def to_wav(samples: np.ndarray, rate: int) -> bytes:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, msg: str) -> None:
        self._send(code, json.dumps({"error": msg}).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._error(404, "não encontrado")

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/synthesize":
            return self._error(404, "não encontrado")
        try:
            size = int(self.headers.get("content-length") or 0)
            if size <= 0 or size > 8192:
                return self._error(400, "corpo inválido")
            data = json.loads(self.rfile.read(size))
            text = str(data.get("text", "")).strip()
            voice = str(data.get("voice", "pf_dora"))
            speed = float(data.get("speed", 1.0))
            style = str(data.get("style", "natural"))
        except (ValueError, TypeError):
            return self._error(400, "corpo inválido")
        if not text or len(text) > MAX_CHARS:
            return self._error(400, f"texto deve ter de 1 a {MAX_CHARS} caracteres")
        if voice not in VOICES or not 0.7 <= speed <= 1.3 or style not in ("comercial", "natural"):
            return self._error(400, "voz, velocidade ou estilo inválido")
        with lock:
            if style == "comercial":
                samples, rate = commercial(text, voice, speed)
            else:
                samples, rate = kokoro.create(" ".join(text.split()), voice=voice, speed=speed, lang="pt-br")
                samples = level(trim(np.asarray(samples, dtype=np.float32), rate), rate, target_db=-18.0)
        self._send(200, to_wav(samples, rate), "audio/wav")

    def log_message(self, fmt: str, *args) -> None:  # sem registrar o texto (pode conter dados do cliente)
        print(json.dumps({"service": "tts", "status": args[1] if len(args) > 1 else "", "path": self.path}), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
