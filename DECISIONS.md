# Decisions

## 2026-11-12, student training

- The student checkpoint is `Qwen/Qwen2.5-1.5B-Instruct`. The Hugging Face model card (`cardData.license` and the `license:apache-2.0` tag) says Apache 2.0. Checked 2026-11-12 at `https://huggingface.co/api/models/Qwen/Qwen2.5-1.5B-Instruct`. The license file is on that model repo. No other student id was invented.
- Training runs on Kaggle, not in the browser. The site only explains the steps and displays a metrics file the notebook wrote.
- The holdout is a fixed-seed slice and is not used for training. Before and after use that same slice.

## 2026-11-12, teachers

- The spec wants API keys on a server. This site is static GitHub Pages and has no server. The visitor pastes their own OpenRouter key. It is stored only in this browser (`agona:openrouter-key`), apart from the rest of the saved data, so a downloaded copy does not include it. A "Forget key" button deletes it. The key is sent only to `https://openrouter.ai`. The log and the screen mask it.
- On the public model list checked on 2026-11-12 there was no free Qwen, DeepSeek, Llama, or Mistral id. A later live call showed `google/gemma-4-26b-a4b-it:free` returning a provider error and `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` returning an empty answer field. Defaults are free models from the live list, preferring non-reasoning instruct models, and those two families when they are listed. No model id is invented. A provider error is retried once, then the next free model is tried. The error message and code are shown. The key is not.
- Teacher text is untrusted data. A person must approve an example before it can be downloaded for training.
- The Kaggle training notebook is the next step. This change does not start a training run.

## 2026-11-12, first shell

- The product name is Agona. The repo stays `agora.bot`.
- The local helper is WebLLM `0.2.87`. Desktop default is Qwen2.5 Coder 7B. Phones and devices that report 4 GB or less start on Qwen2.5 0.5B.
- No Google Fonts request. The font stack is Inter, Geist, then the usual sans-serif fonts.
- Jobs are split with rules, because a tiny model is unreliable at JSON.
- Shared notes are not a git history. If two agents would write the same file, the second gets a new name, and one older copy is kept.
