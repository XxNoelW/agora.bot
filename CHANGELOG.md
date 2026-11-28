# Changelog

## Unreleased

- The connector proxy URL defaults to the deployed connectors Worker. Settings can create a sync account, show the code as text and a QR code, and copy chats, memory, and settings to another device. Routines still run only while Agora is open.
- The connector catalog is a curated set of assistant services. Per-language Wikipedia copies, novelty APIs, and unused MCP servers are gone. Official remote MCP entries were added where a live server answered, including Discord, Dropbox, X, Shopify, Trello, Zoom, Calendly, Make, AgentMail, Kaggle, Twilio, Salesforce, and Zendesk.

## 2026-11-28, memory and routines

- Memory, searchable chats, local thumbs feedback with a JSONL download, voice in English and Hungarian, file and image attach, and routines that run while Agora is open.
- The app shell can install as a PWA. The service worker does not cache model weights.

## 2026-11-28, connectors

- Connectors is a searchable catalog in `data/plugins.json`. Ready connectors run in the browser. Entries that need a key, sign-in, or the optional Cloudflare proxy say so.
- GitHub “list my sites” calls the GitHub API for repositories and Pages URLs instead of repeating the connection status.
- A remote MCP URL can be added from the store. Sign-in uses OAuth 2.1 with PKCE when the server supports dynamic registration.

## 2026-11-23, trained model

- The page tries a public Hugging Face repo of Agora 1.0 before the built-in WebLLM model. The default repo is `XxNoelW/Agora-1.0`. The wasm library stays the prebuilt 1.5B q4 library. The sidebar calls the trained model Agora 1.0.
- If those weights are not published, or the browser has no WebGPU, the previous model still answers. The sidebar names which one is answering.
- `training/publish_agora_web.py` merges the QLoRA adapter and writes q4f16_1 weights. It does not upload them unless `HF_TOKEN` is set.

## 2026-11-23, new look

- Calmer, simpler interface: round agent avatars, cleaner sidebar, plain assistant replies, rounded user bubbles and composer, softer modals, and better light theme.
- Visible name is now Agora. Storage keys stay `agona:*`, so saved agents and chats are kept.

## 2026-11-21, more connectors

- Added browser connectors for Gemini, OpenRouter, Mistral, Groq, Hugging Face, Stability, ElevenLabs, GitLab, Bitbucket, Discord, Slack, Telegram, Bluesky, Trello, Todoist, Airtable, Linear, Asana, ClickUp, Pexels, Unsplash, OpenWeather, and Stripe test reads.
- Spotify, Dropbox, and Google Drive sign in with PKCE. The client ID is typed in the page and is not stored in the repo.
- Anthropic, Replicate, NewsAPI, Reddit, Supabase, and Firebase stay listed as unavailable because a browser cannot use them from this static site.

## 2026-11-15, connectors

- Agents can use GitHub, OpenAI, and Notion keys that stay encrypted in the browser. The chat model only sees whether the account is connected.
- A connect card can appear in the chat. Test checks the key with a real call. Disconnect deletes it.
- Mastodon sign-in runs in the browser. GitHub's device-code sign-in does not, because that host blocks browser requests, so GitHub uses a personal access token.

## 2026-11-14, agents and groups

- A new visitor starts with no agents and a Create agent button.
- An agent has a custom name and either a built-in icon or a small photo stored in this browser.
- A group chat lets two or more agents answer in turn. Each one can read the others. Continue asks them to keep going.

## 2026-11-12, date and search

- Date and time questions use the visitor's clock. They are not sent to web search.
- Search runs only for lookup questions, uses a shorter query, and drops pages that do not match. A reply lists a source only when that reply used it.

## 2026-11-12, workspace

- The page is a dark chat workspace: agents on the left, separate chats for each agent, and one composer.
- Visitors see one model, Agora AI. Training, teacher lists, model picking, and export screens are not in the interface.
- Replies can search the web and show the links. A reply that cannot be finished shows an error instead of staying on "writing".

## 2026-11-12, teacher replies

- Default free teachers prefer non-reasoning instruct models, and Qwen, DeepSeek, Llama, or Mistral when the public list has them.
- Reasoning models get a higher token limit. If the answer field is empty, the reasoning field is used. Models that allow it are asked not to spend the reply on reasoning.
- A provider error is retried once, then the next free model is tried. The error message and code show in the page and in the smoke script. The key does not.
- The smoke script tries up to four free models and prints which ones answered.

## 2026-11-12, training notebook

- Added a Kaggle GPU notebook that fine-tunes `Qwen/Qwen2.5-1.5B-Instruct` (Apache 2.0) with QLoRA on an approved JSONL file.
- The notebook scores a fixed holdout before and after, and writes `agona-metrics.json` plus the adapter.
- `scripts/kaggle-push.sh` pushes that notebook with the official Kaggle CLI. The token comes from `KAGGLE_API_TOKEN` and is not stored in the repo.
- The Training page explains the upload and run steps. The Scores page imports the metrics file and shows only numbers that are in it.

## 2026-11-12

- Rebuilt the static site as Agona, in the same repo.
- English, simple, dark interface with a light theme, a collapsible sidebar, and a big input on the home page.
- Nine role characters with seven states. Names can be changed. Motion follows `prefers-reduced-motion`.
- Shared workspace, notes that are not silently overwritten, stop and pause, and a local log.
- The in-browser helper stays WebLLM `0.2.87`, with timeouts, a no-WebGPU message, and web search. Phones default to the small model.
- OpenRouter teachers: the visitor pastes their own key, stored only in this browser. Calls go only to openrouter.ai. The key is masked in the log and is not in the saved copy.
- Two or more teachers can be asked at once. A judge compares them, a cleaner drops weak or personal examples, and a person approves each one. Approved examples download as JSONL. Nothing enters that file without a yes.
- Chat can use an OpenRouter teacher when a key is saved, and falls back to the local helper.

## Earlier

- The first Agona shell, still on the local helper only.
