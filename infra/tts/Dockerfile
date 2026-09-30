# syntax=docker/dockerfile:1.7
# Serviço interno de voz (texto → fala) para a narração dos vídeos do encarte.
# Modelo Kokoro-82M (pesos Apache-2.0) via kokoro-onnx (MIT); fonemas pt-BR com espeak-ng/phonemizer (GPL-3,
# usados como programa separado neste container). Sem acesso à internet em execução: o modelo vem na imagem.
ARG PY_IMAGE=python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3
FROM ${PY_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-deps -r requirements.txt
# Modelo e vozes fixados por versão e conferidos por SHA-256.
COPY fetch_models.py .
RUN python fetch_models.py /models && rm fetch_models.py
COPY server.py .
RUN useradd --system --uid 10001 tts && chown -R tts /app
USER tts
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
CMD ["python", "server.py"]
