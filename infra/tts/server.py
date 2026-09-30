"""Serviço interno de fala (TTS). Só na rede interna do compose; nunca exposto à internet.

POST /synthesize  {"text": "...", "voice": "pf_dora", "speed": 1.0}  → audio/wav (PCM 16 bits, 24 kHz)
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
MAX_CHARS = 600
kokoro = Kokoro(f"{MODELS}/kokoro-v1.0.int8.onnx", f"{MODELS}/voices-v1.0.bin")
lock = threading.Lock()  # uma síntese por vez: previsível em CPU pequena


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
        except (ValueError, TypeError):
            return self._error(400, "corpo inválido")
        if not text or len(text) > MAX_CHARS:
            return self._error(400, f"texto deve ter de 1 a {MAX_CHARS} caracteres")
        if voice not in VOICES or not 0.7 <= speed <= 1.3:
            return self._error(400, "voz ou velocidade inválida")
        with lock:
            samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="pt-br")
        self._send(200, to_wav(samples, rate), "audio/wav")

    def log_message(self, fmt: str, *args) -> None:  # sem registrar o texto (pode conter dados do cliente)
        print(json.dumps({"service": "tts", "status": args[1] if len(args) > 1 else "", "path": self.path}), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
