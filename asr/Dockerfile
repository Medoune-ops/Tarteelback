# =============================================================================
# Tarteel ASR — image de production (FastAPI + faster-whisper, CPU)
# -----------------------------------------------------------------------------
# Build multi-étapes :
#   1) convert : télécharge `tarteel-ai/whisper-base-ar-quran` (Whisper base
#                fine-tuné sur la récitation coranique) et le convertit en
#                CTranslate2 int8 -> /model. torch/transformers ne servent
#                QU'AU build, ils ne sont pas dans l'image finale.
#   2) runtime : python slim + faster-whisper + FastAPI, modèle copié en dur
#                dans l'image -> AUCUN téléchargement au démarrage (Dokploy
#                peut redéployer/redémarrer sans dépendre de Hugging Face).
#
# Taille finale ~700 Mo (dont ~80 Mo de modèle int8). Inférence CPU: ~1-3 s
# par ayah. RAM recommandée: 1 Go.
# =============================================================================

# ---- 1) Conversion du modèle ------------------------------------------------
FROM python:3.11-slim AS convert

# torch CPU uniquement (l'index officiel PyTorch évite l'énorme roue CUDA).
# La lib native de ctranslate2 est marquée "executable stack", ce que certains
# noyaux refusent au chargement ("cannot enable executable stack: Invalid
# argument" — typiquement WSL2/Docker Desktop). clear_execstack.py retire le
# flag de l'en-tête ELF : inoffensif ailleurs, indispensable là-bas.
COPY clear_execstack.py /tmp/clear_execstack.py
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      "torch==2.5.*" "transformers==4.48.*" "ctranslate2==4.4.0" \
 && find /usr/local/lib/python3.11/site-packages -name 'libctranslate2*.so*' \
      -exec python /tmp/clear_execstack.py {} +

# Conversion HF -> CTranslate2 quantifié int8, + fichiers nécessaires à
# faster-whisper (préprocesseur et tokenizer rapide).
RUN ct2-transformers-converter \
      --model tarteel-ai/whisper-base-ar-quran \
      --output_dir /model \
      --quantization int8 \
      --copy_files preprocessor_config.json \
 && python -c "from transformers import AutoTokenizer; \
AutoTokenizer.from_pretrained('tarteel-ai/whisper-base-ar-quran', use_fast=True).save_pretrained('/model')"

# ---- 2) Runtime ---------------------------------------------------------------
FROM python:3.11-slim AS runtime
WORKDIR /app

COPY requirements.txt clear_execstack.py ./
# Même correctif execstack qu'à l'étape de conversion (voir plus haut) —
# faster-whisper charge la même lib native ctranslate2 à l'exécution.
RUN pip install --no-cache-dir -r requirements.txt \
 && find /usr/local/lib/python3.11/site-packages -name 'libctranslate2*.so*' \
      -exec python clear_execstack.py {} +

COPY --from=convert /model /model
COPY app.py .

ENV MODEL_DIR=/model
EXPOSE 9000

# Healthcheck sans curl (python slim) — utilisé par docker compose et Dokploy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/health')"

# Un seul worker : le modèle est chargé une fois, les transcriptions sont
# sérialisées dans app.py (verrou) — prévisible sur un petit noeud.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1"]
