"""Baixa o modelo Kokoro e as vozes (versão fixa) e confere o SHA-256. Roda só no build da imagem."""
import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}

dest = Path(sys.argv[1])
dest.mkdir(parents=True, exist_ok=True)
for name, sha in FILES.items():
    target = dest / name
    with urllib.request.urlopen(BASE + name, timeout=300) as r, open(target, "wb") as f:
        h = hashlib.sha256()
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != sha:
        sys.exit(f"SHA-256 diferente para {name}: {h.hexdigest()}")
    print(f"ok {name}")
