# Agora cloud sync

This Worker stores an optional sync account for the GitHub Pages site. It does not call a model, and it does not run routines. Routines still run only while the Agora page is open.

The site's default backend URL is `https://agora-cloud.knoel99-morcik.workers.dev`. A visitor can paste a different URL in Settings.

## Files

| File | Role |
| --- | --- |
| `index.js` | The Worker script. This is the only file to upload. |
| `schema.sql` | D1 tables. Apply it to the database. It is not part of the script. |
| `wrangler.jsonc` | Optional Wrangler config. Replace `database_id` before `wrangler deploy`. |
| `README.md` | These notes. |

## What it stores

- `accounts`: id and SHA-256 of the secret. The secret is returned once by `POST /account`.
- `sync`: one row per account for `chats`, `memory`, and `settings`. A write that does not name the current version returns 409 with the server copy. Each value is capped at 1 MB.
- `usage`: optional daily sync counter. Sync still works if this table is missing.

Auth is `Authorization: Bearer id.secret`. CORS allows `https://xxnoelw.github.io` and localhost. Set `ALLOWED_ORIGIN` if the site origin changes.

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

There is no secret to set.

## Deploy by uploading index.js

Create a D1 database, apply `schema.sql`, then upload the module with the Cloudflare API. The script name below is `agora-cloud`. Bind D1 as `DB` and set the plain-text var `ALLOWED_ORIGIN` to `https://xxnoelw.github.io`.

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/agora-cloud" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2026-11-28","bindings":[{"type":"d1","name":"DB","id":"'"$DATABASE_ID"'"},{"type":"plain_text","name":"ALLOWED_ORIGIN","text":"https://xxnoelw.github.io"}]};type=application/json' \
  -F "index.js=@index.js;type=application/javascript+module"
```

In the dashboard, the same setup is: create a Worker, upload `index.js` as the module, add the D1 binding named `DB`, and add the `ALLOWED_ORIGIN` variable. No cron trigger and no API token belong on this Worker.

`GET /health` returns `{ "ok": true, "name": "agora-cloud" }`.
