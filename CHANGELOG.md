# Changelog

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
