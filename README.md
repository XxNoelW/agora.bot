# Agona

A team of helpers that runs in your browser. The local helper is [WebLLM](https://github.com/mlc-ai/web-llm) `0.2.87`. There is no build step and no server.

The site stays at `https://xxnoelw.github.io/agora.bot/`.

## What it does

- A dark chat workspace. You create the agents, give each a name and an icon, and open chats or groups.
- Chats stay in this browser. A group lets the agents read each other and answer in turn.
- One model in the interface, Agora AI. On a computer with WebGPU it runs locally. A key in Settings can connect online. The key stays in this browser.
- Web search from the page itself, with links in the reply. Sources are Wikipedia, DuckDuckGo quick answers, and public pages read through the Jina reader. No search key is required.

The Kaggle notebook and `scripts/kaggle-push.sh` stay in the repo for the owner. They are not part of the page.

## Try it

```
python3 -m http.server 8000
```

Open `http://localhost:8000`. Modules do not load from `file://`.

1. Pick an agent and start a chat.
2. Ask a question, for example: "How do bees make honey?"
3. The reply should include links. If this browser cannot run Agora AI locally, the links still come back. A key in Settings is optional.

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
