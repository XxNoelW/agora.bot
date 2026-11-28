# Agora cloud sync

This Worker stores an optional sync account, read-only shared chats, anonymous daily counts, and opt-in training notes for the GitHub Pages site. It does not call a model, and it does not run routines. Routines still run only while the Agora page is open.

The site's default backend URL is `https://agora-cloud.knoel99-morcik.workers.dev`. A visitor can paste a different URL in Settings.

## Files

| File | Role |
| --- | --- |
| `index.js` | The Worker script. This is the only file to upload. |
| `schema.sql` | Full D1 schema for a new database. |
| `migrations/002_shares_stats_feedback.sql` | New tables for an existing database. Safe to run more than once. |
| `wrangler.jsonc` | Optional Wrangler config. Replace `database_id` before `wrangler deploy`. |
| `README.md` | These notes. |

## What it stores

- `accounts`: id and SHA-256 of the secret. The secret is returned once by `POST /account`.
- `sync`: one row per account for `chats`, `memory`, and `settings`. A write that does not name the current version returns 409 with the server copy. Each value is capped at 1 MB.
- `usage`: optional daily sync counter. Sync still works if this table is missing. Share, feedback, and count routes also use it as a daily limit. The row key is a hash of the day and the network address, not the address itself.
- `shares`: one read-only chat snapshot. `POST /share` returns an id. `GET /share/:id` returns it. The stored JSON is capped at 256 KB. No account is required.
- `stats`: anonymous daily counts. `POST /event` accepts `visit`, `chat`, `tool`, `share`, or `feedback`. `GET /stats` returns the last 30 days. The table has no visitor id and no IP.
- `feedback`: one opt-in training turn. `POST /feedback` stores a rating, a language, and the last turn, with emails and phone numbers removed. `GET /feedback/export?since=TS` needs the header `x-export-key`.

Auth for sync is `Authorization: Bearer id.secret`. Share, stats, and feedback posts do not use that header. CORS allows `https://xxnoelw.github.io` and localhost. Set `ALLOWED_ORIGIN` if the site origin changes.

Daily limits, counted in `usage`, are 30 shares, 40 training notes, and 200 events. A missing `usage` table does not block the write.

## Deploy with Wrangler

```bash
cd workers/agora-cloud
npx wrangler d1 create agora-cloud
```

Put the printed database id in `wrangler.jsonc`, then:

```bash
npx wrangler d1 execute agora-cloud --remote --file=schema.sql
npx wrangler deploy
```

On a database that already has `accounts` and `sync`, apply only the new tables:

```bash
npx wrangler d1 execute agora-cloud --remote --file=migrations/002_shares_stats_feedback.sql
```

`EXPORT_KEY` is the only secret. Set it if you want to download training notes. Leave it unset and `GET /feedback/export` stays 403. Do not put the value in `wrangler.jsonc` or in the script.

```bash
npx wrangler secret put EXPORT_KEY
```

There is no `STATS_KEY`. The 30-day counts are public. No other secret belongs on this Worker.

## Deploy by uploading index.js

Create a D1 database, apply `schema.sql`, then upload the module with the Cloudflare API. The script name below is `agora-cloud`. Bind D1 as `DB` and set the plain-text var `ALLOWED_ORIGIN` to `https://xxnoelw.github.io`.

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/agora-cloud" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2026-11-28","bindings":[{"type":"d1","name":"DB","id":"'"$DATABASE_ID"'"},{"type":"plain_text","name":"ALLOWED_ORIGIN","text":"https://xxnoelw.github.io"}]};type=application/json' \
  -F "index.js=@index.js;type=application/javascript+module"
```

In the dashboard, the same setup is: create a Worker, upload `index.js` as the module, add the D1 binding named `DB`, and add the `ALLOWED_ORIGIN` variable. Add the secret `EXPORT_KEY` only when you want the training export. No cron trigger and no API token belong on this Worker.

`GET /health` returns `{ "ok": true, "name": "agora-cloud" }`.

## Routes to check after deploy

- `POST /share` with a small JSON chat, then `GET /share/:id`.
- `POST /event` with `{ "type": "visit" }`, then `GET /stats`.
- `POST /feedback` with a rating and one turn. `GET /feedback/export` without `x-export-key` returns 403.
