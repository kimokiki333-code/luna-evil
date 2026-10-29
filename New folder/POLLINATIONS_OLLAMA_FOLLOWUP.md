# BaDR local Ollama + Pollinations notes

## Your installed Ollama models
- `gemma-abliterated:latest`: use this for local chat. It is the listed local completion model and does not require internet once Ollama and the website files are available locally.
- `embeddinggemma:latest`: embeddings only; do not select it for chat.
- `gemma4:cloud`: remote/cloud model; requires internet and is not an offline fallback.

## Starting Ollama
The `Start-Ollama-BADR.bat` file restarts the existing Ollama process with `OLLAMA_ORIGINS=*` and `OLLAMA_HOST=127.0.0.1:11434`. It does not reinstall Ollama, download models, or delete models. It can interrupt a request in progress. Confirm the prompt only when ready. Keep the console window open while using the site. If port 11434 is already occupied after restarting, another Ollama server is still running.

After it starts, check `http://127.0.0.1:11434/api/tags` in Brave. In BaDR chat, select Ollama, open Settings → Ollama, click **Test / list models**, and choose `gemma-abliterated:latest`.

## Offline expectations
For the local model to work without internet, the computer must be powered on and Ollama must be running. A Vercel-hosted page cannot load when internet is unavailable, so extract the ZIP and run `Start-BaDR-Local-Offline.bat`; it serves the included website files on `http://127.0.0.1:8787/` without exposing them to your Wi-Fi/public internet. Run `Start-Ollama-BADR.bat` as well if Ollama needs its browser CORS setting restarted. Keep both server windows open. Then select Ollama and `gemma-abliterated:latest`. The local model can chat offline, but online providers, Pollinations, web search, and cloud models need internet. Some optional features use external CDN resources and may be unavailable offline. The PC itself cannot run during a power outage; offline use means after power returns if internet remains unavailable.

## Pollinations behavior
The chat tries the legacy no-key Pollinations text route first when the dedicated key field is blank. If that route fails, the current `gen.pollinations.ai` API request can use either the key entered in Settings or a saved key whose provider is Pollinations. This does not guarantee the key is valid or has free quota; Pollinations' current documentation says generation calls require an API key, even when a model has zero price. A public model being free-priced is not the same as the API being anonymous.

## Text-to-video expectations
Pollinations now documents video models, but the available models, duration limits, prices/quotas, and output availability depend on the live catalog. Do not assume a single prompt can generate a continuous 2–5 minute video in one call. The documented synchronous generation path has a 300-second response limit and a 20 MB response/download limit. For a children's story of several minutes, the practical design is to generate short clips scene-by-scene, then stitch them with a video editor/FFmpeg and add narration/music. This is a later feature; this repair ZIP does not add a video-generation UI or claim a multi-minute output was tested.

## Verification boundary
Static JavaScript syntax and ZIP integrity can be checked here. The user's Windows Ollama process, browser security policy, live Pollinations endpoints, model access, and quotas cannot be verified from this build environment.


## Follow-up based on the user's live test (2026-10-13)

- The `/api/tags` endpoint returns three models. `gemma-abliterated:latest` is the local chat model; `embeddinggemma:latest` is embeddings-only; `gemma4:cloud` needs internet. Do not reinstall Ollama or pull models.
- The Ollama test failure is a browser `Failed to fetch`, not an empty model inventory. The server log confirms it is listening on `127.0.0.1:11434` and shows `OLLAMA_ORIGINS` includes `*` and localhost origins. The app now reports its page origin and recommends testing from the local launcher at `http://127.0.0.1:8787/` before the hosted HTTPS page. Actual Windows/browser connectivity still needs a user-side test.
- Pollinations now uses the live text-model catalog to prefer an available, non-paid-only model rather than forcing `openai/gpt-oss-20b`, which the user's key explicitly rejected. A model listing is not a guarantee that the key is authorized to generate with it. If authorization is required, choose a model available to that key or authorize the exact model only after checking the consent page and redirect destination.


## Pollinations no-key compatibility restore (2026-10-13)

The Veyron chat Pollinations adapter has been restored to the legacy `https://text.pollinations.ai` model-catalog and `/openai` request flow used by the earlier BaDR Arsenal. It filters the live catalog to models marked anonymous and does not silently fall through to `gen.pollinations.ai` using a stored provider-vault key. This avoids repeating the observed `openai/gpt-oss-20b` key-permission error when using the no-key route. The old endpoint is controlled by Pollinations and can change or reject requests; this package has not been live-tested against the service from this environment.
