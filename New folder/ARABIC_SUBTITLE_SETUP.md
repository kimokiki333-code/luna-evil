# BaDR Arabic Subtitle Studio

This package adds an automated English → Arabic subtitle workflow to BaDR.

## What it does

1. Upload a short English video.
2. The backend runs Faster-Whisper to detect English speech and timestamps.
3. Each caption is translated to Arabic with Argos Translate locally.
4. FFmpeg burns the Arabic captions into an H.264/AAC MP4.
5. The UI provides the finished MP4 and the generated Arabic SRT.

There is **no manual English transcript step**. The browser sends one upload and receives one completed job. Internally, transcription, translation and rendering still have to happen; processing time depends on the machine, Whisper model and video length.

## Run with Docker

From the `backend/` directory:

```bash
docker compose up -d --build
```

The API will be available on port `8787`.

Set `CORS_ORIGIN` to the URL where the frontend is hosted. Keep `CORS_ORIGIN=*` only for private testing.

## Connect the hosted frontend

The subtitle page uses the same-origin `/api` path by default. If the backend is hosted separately, add this before the page's main script:

```html
<script>window.BADR_SUBTITLE_API='https://YOUR-BACKEND-DOMAIN';</script>
```

Do not expose secret API keys in the frontend.

## Models and first run

The first subtitle job may take longer because Faster-Whisper downloads its selected model and Argos Translate may download the English → Arabic model package. Later jobs reuse the cached models.

The default backend model is `base` to keep memory use lower. The web UI also offers `small` and `medium` when you want more recognition accuracy.

For a machine with an NVIDIA GPU, the worker can use Faster-Whisper with a CUDA-capable environment. The supplied Docker image is CPU-oriented for broad compatibility; GPU deployment can be added to a GPU host separately.

## Windows without Docker

Install Python 3.11+, FFmpeg, Node.js 20+, then from `backend/`:

```powershell
python -m pip install -r requirements.txt
npm install
$env:YTDLP_ENABLED='true'
npm start
```

The first subtitle job downloads the selected speech model and the English → Arabic Argos package. Make sure `ffmpeg`, `ffprobe`, `python3`/Python and Node are on PATH.

## Important expectations

This is an automated pipeline, not instantaneous magic. The user does not have to wait for or download an intermediate English transcript, but the computer still needs to perform speech recognition, translation and H.264 rendering before the finished MP4 can be downloaded.

For 2–3 minute reels, use the `base` model for a lighter/faster setup or `small` for a stronger recognition/quality balance. Processing can be faster than real time on suitable hardware, but it can also be slower on a low-power CPU.
