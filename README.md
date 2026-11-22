# Agent Studio

Authoring and versioning for RCSL agents, replacing the OpenAI prompt dashboard that is retired on 2026-11-30. Authors edit agents at `studio.rcsl.online`; agent.rcsl.online reads the published version through the runtime API and sends it inline to the Responses API. The design, data model, and the verified import method are in [docs/design.md](docs/design.md).

## Development

```sh
docker compose -f docker-compose.dev.yml up -d     # Postgres on 127.0.0.1:54329
cp .env.example .env.local                          # fill in; DEV_LOGIN=1 enables email-only login
npx drizzle-kit migrate
npm run dev
npm test
```

## Importing from OpenAI

The export runs inside the agent.rcsl.online backend container, which already knows every project's API key:

```sh
docker cp scripts/export_openai_prompts.py kebbi-browser-backend:/tmp/
docker exec -w /app -e PYTHONPATH=/app kebbi-browser-backend \
  python /tmp/export_openai_prompts.py --out /tmp/prompt-export.jsonl
docker cp kebbi-browser-backend:/tmp/prompt-export.jsonl .
DATABASE_URL=... npx tsx scripts/load-export.ts prompt-export.jsonl
```

`scripts/dump-runtime-requests.ts` and `scripts/verify_inline_requests.py` then check that the inline requests reproduce the stored prompts (see docs/design.md, Import). Both import steps are idempotent. Re-running the export appends only versions not yet exported; re-running the load replaces imported versions and never touches versions saved in Studio.

## Deployment

On lab-100-18, with `.env` filled from `.env.example`:

```sh
docker compose up -d --build
```

The app listens on host port 8040. Nginx Proxy Manager forwards `studio.rcsl.online` to it, with a Let's Encrypt certificate. The Google OAuth client needs `https://studio.rcsl.online/api/auth/callback/google` as an authorized redirect URI. agent.rcsl.online then needs `STUDIO_API` and `STUDIO_RUNTIME_TOKEN` (see `docs/agent-studio.md` in that repository).

## Runtime API

| Method and path | Result |
|---|---|
| `GET /api/runtime/v1/projects/{project_id}/agents` | `{data: [{id, name, default_version}]}` for non-archived agents |
| `GET /api/runtime/v1/agents/{id}[?version=N]` | `{id, name, version, published_version, archived, request}`, where `request` holds the inline Responses API fields |

Both require `Authorization: Bearer $RUNTIME_TOKEN`.
