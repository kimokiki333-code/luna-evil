# BaDR backend setup

The optional backend now supports three downloader routes plus the Arabic Subtitle Studio.

Downloader route order:
1. configured Cobalt instance
2. configured secondary/BaDR route
3. local yt-dlp fallback when `YTDLP_ENABLED=true`

Subtitle route:
- `POST /api/subtitles` — upload a video and create a job
- `GET /api/subtitles/:id` — poll progress
- `GET /api/subtitles/:id/download` — finished H.264/AAC MP4
- `GET /api/subtitles/:id/srt` — generated Arabic SRT

The subtitle pipeline uses Faster-Whisper for timestamped speech recognition, Argos Translate for local English → Arabic translation, and FFmpeg for final burn-in. No manual English transcript step is required.

Run with Docker from this folder:

```bash
docker compose up -d --build
```

The service listens on port `8787` by default. Configure `CORS_ORIGIN` and the downloader environment variables before exposing it publicly.

For more detail, read `ARABIC_SUBTITLE_SETUP.md`.
