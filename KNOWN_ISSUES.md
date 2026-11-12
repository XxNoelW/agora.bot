# Known issues

- Without WebGPU the local helper cannot answer. A saved OpenRouter key and a picked teacher can answer instead. Many phones have no WebGPU.
- The local helper writes one answer at a time, even when several agents are working.
- The desktop helper download is large (about 5 GB in the earlier note). Pick a smaller one in Settings if it does not fit.
- `deviceMemory` is mainly a Chromium hint.
- Web search, when an agent uses it, calls Wikipedia, DuckDuckGo quick answers, and `r.jina.ai`. The page says so.
- `run_js` is a short web worker. It is not a security sandbox.
- Notes, the log, and the OpenRouter key stay in this browser only.
- Teacher prices are the strings from OpenRouter. This page does not turn them into a bill.
- Free Qwen, DeepSeek, Llama, and Mistral models were not on the public list on 2026-11-12. Defaults are other free models from that list, with reasoning models after instruct models. A provider can still fail after the retry and the fallback.
- The notebook is a real training script, but this environment does not run a GPU fine-tune. You run it on Kaggle.
- Scores stay empty until you import `agona-metrics.json`. The page does not fill in missing numbers.
- The handoff animation plays when both characters are on screen. The sentence stays either way.
- OpenRouter must allow the browser call. If it blocks it, the page shows the error and does not hide it.
