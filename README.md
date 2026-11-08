# Agora

A chat with AI friends that runs entirely in your browser. It is plain HTML, CSS, and JavaScript: no build step, no server, and no API key.

- **Chat**: talk with one friend, or with a group. In a group, friends answer together, then they can reply to each other.
- **Friends**: each friend has a name, a picture, and a short description of how they behave.
- **Helper brain**: [WebLLM](https://github.com/mlc-ai/web-llm) `0.2.87` runs on WebGPU. The default is **Qwen2.5 Coder 7B** (best at coding and using tools, about 5 GB). Medium (Qwen2.5 3B) and Small (Qwen2.5 1.5B) are there for slower computers. Those ids are in that version's prebuilt model list.
- **Web**: friends can search the web and read a page. Results include links. Search uses Wikipedia, DuckDuckGo quick answers, and DuckDuckGo's light results read through the keyless Jina reader (`r.jina.ai`), which allows browser requests.
- **Shared notes**: files in this browser that every friend can use, plus a small JavaScript sandbox.
- **Advanced**: the helper brain, notes, script-only keys, counters, and export/import. You can ignore this and just chat.

## Run locally

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. ES modules do not load from `file://`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (it must be the repo root).
2. Go to **Settings → Pages → Build and deployment → Deploy from a branch**, then choose **main** / **/(root)** and save.
3. Open `https://<user>.github.io/<repo>/`. The `.nojekyll` file makes Pages serve the files as they are.

## If a reply gets stuck

Loading and writing have timeouts. If the download or the reply goes quiet, the "writing…" bubble is cleared and a short message explains what happened. Refreshing the page also clears a leftover "writing…" bubble. If the big helper will not load, pick **Small helper** under Advanced.

## Tools

Before answering, a friend replies with one line: `NONE` or `TOOL: name {json}`. The page runs the tool (at most twice) and then asks for a normal answer. Tool lines are also accepted in a few looser shapes, because small models are messy. `run_js` runs in a Web Worker for 3 seconds with no access to the page. It is not a security sandbox against a hostile program.

## Limits

- You need a browser with WebGPU (Chrome or Edge on a computer). Without it, you can still look around, and chat shows a plain explanation instead of hanging.
- The first helper download is large (about 1.6 GB, 2.5 GB, or 5 GB). The browser keeps it after that.
- Friends are only as careful as the model. Check the links they cite.
- Friends, chats, notes, and keys stay in `localStorage` in this browser only.
- Script keys (`window.Agora.connect`) work only on this page. There is no backend.
