# Decisions

## 2026-11-12, teachers

- The spec wants API keys on a server. This site is static GitHub Pages and has no server. The visitor pastes their own OpenRouter key. It is stored only in this browser (`agona:openrouter-key`), apart from the rest of the saved data, so a downloaded copy does not include it. A "Forget key" button deletes it. The key is sent only to `https://openrouter.ai`. The log and the screen mask it.
- On the public model list checked on 2026-11-12 there was no Qwen or DeepSeek id ending in `:free`. The default pair is two free models that were really on that list (`google/gemma-4-26b-a4b-it:free` and `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`). If a free Qwen and a free DeepSeek show up later, the picker uses those first. No model id is invented.
- Teacher text is untrusted data. A person must approve an example before it can be downloaded for training.
- The Kaggle training notebook is the next step. This change does not start a training run.

## 2026-11-12, first shell

- The product name is Agona. The repo stays `agora.bot`.
- The local helper is WebLLM `0.2.87`. Desktop default is Qwen2.5 Coder 7B. Phones and devices that report 4 GB or less start on Qwen2.5 0.5B.
- No Google Fonts request. The font stack is Inter, Geist, then the usual sans-serif fonts.
- Jobs are split with rules, because a tiny model is unreliable at JSON.
- Shared notes are not a git history. If two agents would write the same file, the second gets a new name, and one older copy is kept.
