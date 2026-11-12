# Agona

A team of helpers that runs in your browser. The local helper is [WebLLM](https://github.com/mlc-ai/web-llm) `0.2.87`. There is no build step and no server.

The site stays at `https://xxnoelw.github.io/agora.bot/`.

## What it does

- Home page with a big input, dark or light theme.
- Nine roles with their own characters: Panna, Kata, Bence, Tünde, Lilla, Dóri, Sári, Enci, and Dani. You can rename them.
- A shared workspace with jobs, speech bubbles, and notes.
- Phones and low-memory computers start on the small local helper.
- Teachers on OpenRouter, if you paste your own key. The key stays in this browser and is sent only to openrouter.ai.

## Try it

```
python3 -m http.server 8000
```

Open `http://localhost:8000`. Modules do not load from `file://`.

1. Write a job on the home page, for example: "Start three agents on the page, the server, and the tests."
2. The first time, this computer downloads a helper. A bar shows the progress. Without WebGPU the page explains that, and you can use an OpenRouter teacher instead.
3. On Teachers, paste your key, refresh the model list, and add at least two teachers. Ask them a question, then approve or reject each answer.
4. Download the approved examples as JSONL. Upload that file to Kaggle and run `training/agona_student_lora.ipynb`, or push it with `scripts/kaggle-push.sh` after setting `KAGGLE_API_TOKEN` and `KAGGLE_USERNAME` in the environment. Import `agona-metrics.json` on the Scores page.

## Tests

```
node --test tests/*.mjs
```

The web search test uses the network. `scripts/smoke-openrouter.mjs` is a live check. It reads `OPENROUTER_API_KEY` from the environment, tries up to four free models, and does not print the key.

## Pages

The files live at the repo root. GitHub Pages serves the `main` branch root. `.nojekyll` keeps the files as they are.

## Docs

- [Changelog](CHANGELOG.md)
- [Decisions](DECISIONS.md)
- [Known issues](KNOWN_ISSUES.md)
