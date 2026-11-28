# Agona

A team of helpers that runs in your browser. The local helper is [WebLLM](https://github.com/mlc-ai/web-llm) `0.2.87`. There is no build step and no server.

The site stays at `https://xxnoelw.github.io/agora.bot/`.

## What it does

- A dark chat workspace. Built-in agents are already in the sidebar (Agora, Teacher, Homework helper, Coder, Game master, Writer, Translator). You can also create, edit, duplicate, and delete agents. Each agent has its own chats and its own memory.
- Chats stay in this browser. A group lets the agents read each other and answer in turn.
- Connectors let an agent use keys or sign-in for GitHub, GitLab, Bitbucket, OpenAI, Gemini, OpenRouter, Mistral, Groq, Hugging Face, Stability, ElevenLabs, Notion, Trello, Todoist, Airtable, Linear, Asana, ClickUp, Discord, Slack, Telegram, Bluesky, Mastodon, Spotify, Dropbox, Google Drive, Pexels, Unsplash, OpenWeather, and Stripe test reads. Keys stay encrypted in the browser and are not shown to the chat model.
- One chat brand, Agora 1.0. On a computer with WebGPU it tries the trained weights first, then the built-in local model. A key in Settings can connect online when WebGPU is missing. The key stays in this browser. The sidebar says which one is answering.
- Web search from the page itself, with links in the reply. Sources are Wikipedia, DuckDuckGo quick answers, and public pages read through the Jina reader. No search key is required.

The Kaggle notebook and `scripts/kaggle-push.sh` stay in the repo for the owner. They are not part of the page.

## Try it

```
python3 -m http.server 8000
```

Open `http://localhost:8000`. Modules do not load from `file://`.

1. Pick an agent and start a chat.
2. Ask a question, for example: "How do bees make honey?"
3. The reply should include links. If this browser cannot run Agora 1.0 locally, the links still come back. A key in Settings is optional.

## Tests

```
node --test tests/*.mjs
```

The web search test uses the network. `scripts/smoke-openrouter.mjs` is a live check. It reads `OPENROUTER_API_KEY` from the environment, tries up to four free models, and does not print the key.

## Trained model

The trained model is named Agora 1.0. The chat does not ship its weights. It looks for a public Hugging Face repo, default `XxNoelW/Agora-1.0`, and loads it in the browser with WebLLM `0.2.87`. The wasm library is the prebuilt 1.5B q4 library. Only the weights come from that repo. If `mlc-chat-config.json` is missing, or it is not the expected q4 format, the page uses the built-in model instead:

- Desktop: `Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC`
- Phone or a device that reports 4 GB or less: `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`

If the browser has no WebGPU, those local models do not start. A saved OpenRouter key is used when there is one. Otherwise the reply comes from web search. Settings can change the repo id. No token is stored in this repo.

To publish the weights after the training notebook:

1. On Kaggle, with a GPU, open `training/publish_agora_web.ipynb`. It expects the adapter at `agona-output/agona-student-lora` from `training/agona_student_lora.ipynb`.
2. The notebook merges that adapter into `Qwen/Qwen2.5-1.5B-Instruct`, installs the MLC nightly (`mlc-llm-nightly-cu128` when CUDA is present, otherwise the CPU wheel), and writes `agona-output/agora-student-mlc`.
3. Create a public model repo. The site's default id is `XxNoelW/Agora-1.0`. Another id works if you type it in Settings.
4. Upload the files inside `agora-student-mlc` to the root of that repo. `mlc-chat-config.json` must sit next to the weight shards and the tokenizer files.
5. Optional: `python training/publish_agora_web.py --upload` after `HF_TOKEN` is set in the environment. The script refuses to upload without that token, and the token is not written into the repo.
6. Reload the site. The sidebar should say `Answering with Agora 1.0`. Until the file is public, it says Agora 1.0 is not published and names the built-in model.

The same steps are in `training/publish_agora_web.py`.

## Memory, feedback, and routines

Memory, chats, ratings, and routines stay in this browser (IndexedDB, or localStorage when that is missing). Nothing is uploaded until you create a sync account in Settings. That account copies chats, memory, and settings to the optional cloud Worker. Ratings and routines stay on this device.

- Memory stores a name, preferences, and short facts. Relevant notes are added to the prompt in a short block. Turn it off in Memory. Say “remember that …” or “forget …”. The same actions are tools: `remember` and `forget`.
- Chats can be searched from the sidebar or the Memory panel, then renamed or deleted.
- Each answer has thumbs up and down, plus an optional comment. **Export feedback** downloads JSONL (`messages`, `answer`, `rating`, `comment`) for training. Sharing that file is up to you.
- Routines accept “every morning at 8 tell me the weather” and “remind me Friday 5pm”, or the form under Routines. Tools: `create_routine`, `list_routines`, `cancel_routine`. They run while Agora is open and catch up missed ones the next time you open it. A closed browser does not run them yet. The Routines panel says so.
- The page is a PWA. The service worker precaches the app shell and keeps a runtime cache for model files. WebLLM also keeps weights in the browser Cache API, and the page asks the browser to keep that storage. A bar shows percent, size, and time left. Settings has Download for offline, including optional Agora vision. After that, the sidebar can say Available offline.
- The first visit shows a short tour. An empty chat offers the current agent's example questions. Skip the tour any time.
- Settings can choose Agora Lite when `XxNoelW/Agora-1.0-Lite` is public. Until that repo exists, the choice says it is coming soon. Phones and low-memory devices see a suggestion.
- Share on a chat uploads a read-only copy and copies a link like `https://xxnoelw.github.io/agora.bot/?share=ID`. Copy as text stays on this device.
- Anonymous counts are optional. Do Not Track, or the settings switch, stops them. The public page is `stats.html`. No cookie is set.
- Help improve Agora is off until you turn it on. A thumbs up or thumbs down then sends the last question and answer. Emails and phone numbers are removed.
- Mic uses the browser speech API. EN / HU switches English and Hungarian. Speak reads replies aloud.
- File accepts text, Markdown, CSV, JSON, and PDF text when the file contains real text. An image is read by Agora vision when this device can run it. The real helper name is not shown.

## Connectors

Connectors is the store in the sidebar. It is a curated JSON catalog at `data/plugins.json` (assistant services such as GitHub, Notion, Slack, and weather, not a copy of every public API). A new connector is one object in that list. The page searches it by name, category, and whether it needs a key. Tool names for training are in `data/tool-names.txt`.

What works in the browser, with no Cloudflare deploy:

- Local tools such as the calculator, unit conversion, and the clock.
- Public APIs that allow browser calls, including weather, Wikipedia, currency, dictionaries, and the other entries marked Ready.
- Remote MCP servers that allow this site’s origin. DeepWiki, Microsoft Learn, Context7, and GitMCP docs connect with no key. GitHub, Notion, Linear, Google, and the other sign-in entries need you to sign in or paste your own token. The token stays encrypted in this browser.

What waits on a Cloudflare deploy:

- Feeds and MCP servers marked **Needs the proxy**. Their hosts block browser apps. The proxy URL is already filled in with `https://agora-connectors.knoel99-morcik.workers.dev`. Paste another URL to use your own Worker.

To add a connector by hand, open Connectors and paste a Streamable HTTP MCP URL. You can attach a bearer token, a named API-key header, or OAuth. OAuth uses PKCE and dynamic client registration when the server publishes it. Nothing in the repo is a secret.

The connectors Worker lives in `workers/agora-connectors`. Its README has the deploy steps. The site's default proxy URL is the deployed Worker. A token sent through **mcp-proxy** goes to that Worker and then to the official host.

Account sync is separate. Settings can create a sync code, show it as text and a QR code, and paste it on another device. The Worker in `workers/agora-cloud` stores the code as a hash and keeps the chats, memory, and settings copy. Its README lists the file to upload.

Agora 1.0 sees a short list of enabled tools in the decision prompt. A clear request such as “weather in Paris” or “list my GitHub sites” runs the tool even when the model does not emit a tool call. Tool calls are collapsible in the chat. **Max tool steps** caps the loop.

The GitHub account on the Accounts tab lists repositories and GitHub Pages sites from the GitHub API. “List my GitHub sites” uses that API. It does not answer with the connection status.

Rebuild the catalog after editing `scripts/build-plugins.mjs`:

```bash
node scripts/build-plugins.mjs
```

## Pages

The files live at the repo root. GitHub Pages serves the `main` branch root. `.nojekyll` keeps the files as they are.

## Docs

- [Changelog](CHANGELOG.md)
- [Decisions](DECISIONS.md)
- [Known issues](KNOWN_ISSUES.md)
