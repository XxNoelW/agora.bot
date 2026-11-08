# Agora

A dashboard for a multi-agent AI workspace that runs entirely in your browser. It is plain HTML/CSS/ES modules: no build step and no server.

- **Agents**: create, edit and delete agents (name, emoji avatar, system prompt).
- **Chats**: group chats where agents take turns and answer each other (1–3 rounds, with a Stop button), plus 1:1 chats.
- **AI**: [WebLLM](https://github.com/mlc-ai/web-llm) runs on WebGPU, so no API key is needed. Models: Qwen2.5‑1.5B (default), Qwen2.5‑3B, Llama‑3.2‑3B, Phi‑3.5‑mini.
- **Shared computer**: a virtual filesystem and JS terminal that all agents share. Tools: `web_search`, `fetch_wikipedia_page`, `write_file`, `read_file`, `list_files`, `run_js`.
- **API keys**: local `ak_…` keys for the in-page JS API `window.Agora.connect(key)`.
- **Usage**: an "Unlimited" plan with message, tool and API counters.
- **Settings**: model, temperature, max tokens, rounds, export/import as JSON, clear all data.

## Run locally
```
python3 -m http.server 8000   # then open http://localhost:8000
```
ES modules don't load from `file://`, so you need a local server.

## Deploy to GitHub Pages
1. Push this folder to a GitHub repo (it must be the repo root).
2. Go to **Settings → Pages → Build and deployment → Deploy from a branch**, then choose **main** / **/(root)** and save.
3. Open `https://<user>.github.io/<repo>/`. The `.nojekyll` file makes Pages serve the files as they are.

## Tool protocol
Agents call a tool by writing a line `TOOL: name {json}`. The app runs the tool, gives the result back to that agent, and repeats this at most 3 times per turn. Tool activity is shown in the chat.

## Limitations
- You need a browser with WebGPU (Chrome/Edge 113+ on desktop, and some others). Without it, everything except AI replies still works and a warning is shown.
- The first model load downloads about 1–4 GB. After that it is cached by the browser.
- Small models sometimes ignore the tool protocol or misuse it, and multi-agent replies are only as good as the model.
- All data (agents, chats, files, keys) lives in `localStorage` (about 5 MB) in this browser only. Nothing is synced.
- API keys are local only. There is no backend, so they don't work from other sites or servers.
- `web_search` uses the Wikipedia API (CORS `origin=*`). DuckDuckGo Instant Answers is tried first but is often blocked by CORS, in which case it is skipped without an error.
- `run_js` runs in a Web Worker with a 3‑second timeout and no DOM. It is isolated from the page, but not a hardened security sandbox.
