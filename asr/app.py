"""
Tarteel ASR — microservice de transcription de récitation coranique.

Sert le modèle `tarteel-ai/whisper-base-ar-quran` (Whisper base fine-tuné sur
la récitation du Coran) converti en CTranslate2 int8 au build de l'image
(voir Dockerfile), via faster-whisper — inférence CPU en ~1-3 s par ayah.

Le service ne fait QUE transcrire : le scoring (comparaison au verset attendu)
reste côté backend Node, qui est le seul juge (règle du projet).

Endpoints :
  GET  /health                          -> liveness (utilisé par Dokploy/compose)
  POST /transcribe  (multipart `audio`) -> { "text": "...", "durationSec": 3.2 }

Auth : si ASR_API_KEY est défini, l'en-tête `x-api-key` doit correspondre.
Le service n'est de toute façon PAS exposé publiquement (réseau interne Docker).
"""

import io
import os
import threading

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_DIR = os.environ.get("MODEL_DIR", "/model")
API_KEY = os.environ.get("ASR_API_KEY", "")
# 10 MiB ~= largement assez pour une ayah enregistrée par le front Expo (m4a).
MAX_AUDIO_BYTES = int(os.environ.get("ASR_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))
# 0 = laisser ctranslate2 choisir (nb de coeurs).
CPU_THREADS = int(os.environ.get("ASR_CPU_THREADS", "0"))

model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)
# Une transcription à la fois : le modèle base est rapide et sérialiser évite
# les pics mémoire sur un petit noeud Dokploy. Les requêtes simultanées font
# la queue quelques secondes au lieu de s'entre-étouffer.
_lock = threading.Lock()

app = FastAPI(title="Tarteel ASR", version="1.0.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"status": "ok", "model": "tarteel-ai/whisper-base-ar-quran (ct2 int8)"}


@app.post("/transcribe")
def transcribe(
    audio: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

    data = audio.file.read(MAX_AUDIO_BYTES + 1)
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    try:
        with _lock:
            segments, info = model.transcribe(
                io.BytesIO(data),
                language="ar",
                beam_size=5,
                # Une ayah = un enregistrement court et continu : pas de contexte
                # inter-segments (évite les hallucinations en cas de silence).
                condition_on_previous_text=False,
                vad_filter=True,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
    except HTTPException:
        raise
    except Exception as exc:  # audio illisible/corrompu -> 400, pas 500
        raise HTTPException(status_code=400, detail=f"undecodable audio: {exc}") from exc

    return {"text": text, "durationSec": round(info.duration, 2)}
