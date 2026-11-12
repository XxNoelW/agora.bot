# Changelog

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
