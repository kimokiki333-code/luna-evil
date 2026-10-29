# BaDR AI Media Arsenal — AHM7 / Ollama / provider repair notes

## Changes made

- Added an **AHM7 Free Tools Hub** card immediately after IP Intelligence, using the existing dark/cyan visual language.
- Added in-app controls for Universal Downloader (`GET /api/alldl`), SpeechSter TTS (`POST /api/tts`), TranScribe (`POST /api/transcribe`), WebSnap (`GET /api/websnap?action=screenshot`), WebZip (`POST /api/zip`), TempSter (`GET /api/mail`), PixelSter (`POST /api/tti`), VisionChat (`POST /api/imgchat`), and DriveUp (`GET /api/driveup`). The tools stay inside the BaDR UI instead of navigating away. TranScribe sends only `youtube`/`translate` for YouTube URLs and sends `audio`, `filename`, `mime`, `language`, `model`, and `timestamps` for uploaded audio, matching the documented request shapes.
- DriveUp accepts a Google OAuth access token and supports listing files and renaming a file. The public AHM7 APIs do not need API keys; DriveUp does require OAuth.
- Fixed WebZip and PixelSter request methods to use the documented POST JSON bodies; added WebSnap's required `action=screenshot` parameter.
- Reworked Ollama model discovery to query the native `GET /api/tags` endpoint first and fall back to `GET /v1/models`. It normalizes base URLs with or without `/v1`.
- Reworked Ollama chat to use the native streaming `POST /api/chat` endpoint first, then fall back to OpenAI-compatible `/v1/chat/completions` if the native endpoint is unavailable.
- Added Settings controls to test/list local Ollama models, choose an installed model, pull a named model, edit the base URL, and copy the Windows CMD launch command. The default pull example is `qwen2.5:0.5b`; pulling a model downloads files and consumes disk space.
- Removed the blanket HTTPS-based disablement for Ollama. HTTPS pages can still be blocked by browser CORS / Private Network Access policy; the app now reports discovery errors instead of silently treating Ollama as unavailable.
- Kept the nine key entries already present in the uploaded HTML (seven OpenRouter and two Groq entries). OpenRouter defaults now use the official `openrouter/free` router, which automatically selects an available zero-cost model. Groq defaults now use `openai/gpt-oss-20b`; Groq officially deprecated `llama-3.3-70b-versatile` on August 16, 2026. Then restored the exact literal credentials recoverable from the private BaDR vault: Google/Gemini, Ollama/Autogen, two Claude keys, NVIDIA, Kimi, two Mistral keys, Fooocus, three Replicate tokens (the `r8_` prefix is Replicate, not RapidAPI), three Hugging Face entries, Vercel AI Gateway, Experiential Labs, an additional OpenRouter key, and the Pollinations app key. The Vercel `vck_` credential is routed to the Vercel AI Gateway endpoint rather than being mislabeled as a deployment token. Added editable provider slots only for OpenAI, GitHub Models, RapidAPI, Apify, VoyageAI, Manus and King Hour where exact credential strings were not recoverable; providers with restored credentials do not also get redundant blank rows. Key cards now allow editing key, model and base URL.
- Fixed the direct Anthropic/Claude Messages request shape and streaming parser. Provider APIs that are not OpenAI-compatible chat APIs (for example embeddings, actor APIs or model-prediction APIs) need a compatible gateway/base URL before they can be used in this chat UI; their keys can still be stored in their provider slots.
- Made chat logs persist in local storage (last 1,000 events) and added JSON workspace backup export/import for chats, memory, logs, provider keys and core settings. Added an in-memory storage fallback so the chat still initializes when a browser blocks localStorage (that fallback does not survive reloads).
- Fixed the embedded chat document loader: the full chat HTML is preserved as Base64 and assigned through `iframe.srcdoc`, rather than relying on HTML parsed inside a `<template>` and `document.write`. Made the embedded Google Fonts stylesheet non-blocking so a slow/blocked font request cannot stop chat initialization.
- Pollinations now uses the current OpenAI-compatible `https://gen.pollinations.ai/v1/chat/completions` endpoint and current `{data:[...]}` model-catalog shape. The exact `openai/gpt-oss-20b` ID is the default; the legacy `openai` alias is migrated away because it maps to a different model. The Pollinations app key recovered from the private vault is seeded into the dedicated Pollinations setting. The live catalog is checked for the model and its access/pricing status; if absent, the requested model remains selectable but is explicitly marked unconfirmed rather than silently replaced.

## Credential fidelity note

The uploaded ZIP contained nine literal key entries. Exact additional credential strings were recovered from the saved private vault and added as records in the same key manager, after the original nine entries. Some provider values (notably OpenAI and GitHub Models, plus RapidAPI, Apify, VoyageAI, Manus and King Hour) were not present in the uploaded ZIP or the saved vault, so those slots remain blank rather than being filled with invented values. The `r8_` credentials were mapped to Replicate based on their token format, despite being mislabeled as RapidAPI in the old vault.

## Verification performed

- ZIP structure/integrity checked after packaging.
- Extracted the executable inline JavaScript from the main HTML and embedded chat document and ran `node --check` on each executable block; syntax checks passed.
- HTML parsed successfully; no duplicate IDs were found in the outer page or embedded chat document. The default key list has 35 entries, 28 with literal credentials, and no duplicate credential values.
- Headless Chromium smoke test passed with mocked API responses: all nine AHM7 tool panels opened and closed; the embedded chat body and input loaded; Settings opened and closed; 42 provider-key cards rendered; the Ollama settings controls rendered; and no JavaScript/page errors were reported.
- Mocked backend integration test passed: Pollinations sent a request to `https://gen.pollinations.ai/v1/chat/completions` with model `openai/gpt-oss-20b` and an Authorization header, then displayed the mocked reply. Ollama discovered a mocked local model via `/api/tags`, sent chat to `/api/chat` with the discovered model and no API key, and displayed the mocked reply.
- Mocked action tests passed for all nine AHM7 tools: downloader, TTS, STT, WebSnap, WebZip, Temp Email creation/inbox, PixelSter, VisionChat and DriveUp. The captured request methods matched the integration (GET for downloader/WebSnap/mail/DriveUp; POST for TTS/transcribe/zip/TTI/image chat), and DriveUp included an Authorization header.
- Static checks confirmed the AHM7 card, nine tool panels, provider slots, Ollama controls, and log/backup controls.

## Not verified in this build environment

- Real AHM7 API calls from the user's Brave browser (CORS, network policy and endpoint availability matter).
- Connection to the user's actual Windows Ollama process, installed models, or a real generated answer. The backend test used a mocked `127.0.0.1:11434` response; it did not access the user's PC.
- Live validity, quotas, pricing, or availability for any embedded provider credential. The key-test button makes one minimal chat request per configured chat-compatible provider and may use provider quota. Non-chat API credentials are not falsely tested as generic chat APIs.

## Windows Ollama note

Ollama normally runs as a background server/tray app; the tray icon is not a chat UI. To expose the local server to the app, close the existing Ollama tray/server process first, then open CMD and run:

```bat
set OLLAMA_ORIGINS=* && ollama serve
```

If CMD reports that port `11434` is already in use, an Ollama server is already running. Do not launch a second copy; stop/restart the existing one with the environment variable set. Verify local model discovery by opening `http://127.0.0.1:11434/api/tags` in Brave. This should return JSON listing the installed models.


## References checked

- AHM7 API reference: https://ahm7xmakki.com/docs
- AHM7 WebZip API method and response: https://ahm7xmakki.com/webzip
- AHM7 PixelSter API method and response: https://www.ahm7xmakki.com/pixelster
- Pollinations current API/model catalog: https://gen.pollinations.ai/docs and https://gen.pollinations.ai/v1/models
- OpenRouter Free Models Router: https://openrouter.ai/docs/guides/routing/routers/free-router
- Groq model deprecations: https://console.groq.com/docs/deprecations
- Vercel AI Gateway OpenAI-compatible endpoint: https://vercel.com/docs/ai-gateway/sdks-and-apis
