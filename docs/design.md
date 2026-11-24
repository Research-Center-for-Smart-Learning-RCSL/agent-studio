# RCSL Agent Studio design

## Purpose

OpenAI retires `/v1/prompts` and reusable prompt objects on 2026-11-30. agent.rcsl.online (the student runtime, container `kebbi-browser-backend`) currently sends `prompt={"id": "pmpt_..."}` to the Responses API, and the instructions, model, and tool configuration of all 228 agents exist only as those OpenAI prompt objects. After the retirement the Responses API itself remains, but each request must carry the model, instructions, and tools inline.

RCSL Agent Studio replaces the OpenAI prompt dashboard. Authors edit agents in it, every save produces an immutable version, and the runtime reads the published version of an agent from it and sends the content inline. The runtime keeps parsing RCSL control tags (`[ACTION]`, `[FINISH]`, and so on), so student-facing behavior does not change. RCSL Agent Studio is served at `studio.rcsl.online`.

## Scope

The first release covers the full author workflow, not a stopgap:

1. Import of every RCSL prompt, keeping the original `pmpt_` identifier so that existing links, QR codes, and stored settings that reference it keep working.
2. An editor for instructions, model, model settings, and tools, with version history, diffs between versions, restoring an old version, and choosing the published version.
3. Google sign-in and per-organization and per-project permissions.
4. A runtime API that agent.rcsl.online reads, plus the change to agent.rcsl.online that consumes it.

Organizations, projects, and the organization OpenAI API keys stay in the RCSL data API (`192.168.100.18:8887`). RCSL Agent Studio mirrors organization and project names and identifiers from it and never stores the API keys, because the runtime already resolves them.

## Terms

An **agent** is what OpenAI called a prompt: a named configuration belonging to one RCSL project. An **agent version** is one immutable snapshot of that configuration. The **published version** is the version the runtime runs when it does not ask for a specific one; it corresponds to OpenAI's default version. A **draft** is unsaved editor state and never reaches the runtime.

## Architecture

RCSL Agent Studio is a single Next.js application (App Router, TypeScript) with its own PostgreSQL database, deployed as two containers on lab-100-18 and exposed through the existing Nginx Proxy Manager as `studio.rcsl.online`. Server components and route handlers access the database through Drizzle ORM. Authentication uses Auth.js with the Google provider.

The runtime does not depend on the Studio user interface. It calls a small read-only HTTP API with a service token, caches each agent configuration, and keeps serving the last configuration it fetched if Studio is unreachable. A Studio outage therefore blocks editing but not classes in progress.

```
author browser --> studio.rcsl.online (Next.js) --> Postgres (agent_studio)
                                ^
                                | GET /api/runtime/v1/... (service token)
kebbi-browser-backend ----------+----> OpenAI Responses API (inline config)
         |
         +--> RCSL data API (organizations, projects, API keys)
```

## Data model

`organizations` and `projects` mirror RCSL rows by their RCSL identifiers and names. A periodic sync and an admin-triggered sync refresh them; rows that disappear from RCSL are marked inactive rather than deleted, so their agents stay readable.

`agents` holds the identifier, owning project, display name, description, published version number, and archive timestamp. Imported agents keep their `pmpt_` identifier. Agents created in Studio receive an identifier with the prefix `agt_`, which makes the origin visible and avoids colliding with OpenAI identifiers.

`agent_versions` holds one row per version: agent, version number (starting at 1 and contiguous per agent), model, instructions as an ordered JSON list of messages with a role (see Import), tools as JSON, model settings as JSON (reasoning effort, text format and verbosity, temperature, top_p, max output tokens), an optional change note, author, and creation time. Rows are never updated. Saving always inserts a new version; restoring an old version inserts a copy of it as the newest version, so history stays linear.

`secrets` holds MCP server credentials, encrypted with a key from the environment. A tool definition refers to a secret by name instead of embedding it, so credentials never appear in version history, diffs, or the editor. The runtime API resolves the reference when it serves the configuration.

`users` holds the Google email, display name, and an admin flag. `memberships` grants a user a role on one organization or one project; an organization role applies to all of its projects. Roles are `viewer` (read agents and history) and `editor` (also save, publish, archive). Admins manage memberships, secrets, and syncs, and can see everything. The initial admins come from an environment variable.

`audit_events` records saves, publishes, archives, membership changes, and secret changes with actor and time.

## Runtime API

All runtime endpoints require `Authorization: Bearer <service token>` and are read-only.

| Method and path | Result |
|---|---|
| `GET /api/runtime/v1/projects/{rcsl_project_id}/agents` | Non-archived agents of the project: id, name, published version |
| `GET /api/runtime/v1/agents/{id}` | Published version: id, version, model, instructions, tools (secrets resolved), settings |
| `GET /api/runtime/v1/agents/{id}?version=N` | The given version, same shape |

The list endpoint replaces `GET /openai/prompts/<project_id>` on the RCSL data API. Its rows keep the fields agent.rcsl.online already reads (`id`, `name`, `default_version`) so the selector code changes minimally.

## Changes to agent.rcsl.online

`get_prompts` reads the project list from Studio instead of RCSL. The chat path fetches the agent configuration from Studio (cached for a short time per agent and version, with the last good copy kept on failure) and sends `model`, `instructions`, `tools`, and the settings inline instead of `prompt`. The local function tools that the runtime executes (`upload_image`, `database_operation`, `set_timeout`, `workspace_*`, and the send_email MCP server) continue to be merged as they are today. Tool discovery through the throwaway `responses.create` call, the prompt refresh endpoint, and the refresh records become unnecessary and are removed once the new path is in production.

## Import

OpenAI documents no export for prompt objects. The import uses the same mechanism as the existing tool discovery: one unstored `responses.create` call with `prompt={"id", "version"}`, `max_output_tokens=16`, and `tool_choice="none"`, using the owning organization's API key. The Response object echoes the effective model, instructions, tools, and settings of that prompt version. Each version from 1 to the default version is imported, so authors keep their history.

This was verified on 2026-11-22 against two prompts (`Agent designed for Quick Test`, versions 10 and 1, and `Test Files and Function`, version 6):

- `instructions` comes back as a list of message items, not a string. Recent versions hold one `developer` message, older ones a `system` message, followed by an empty `user` message that the importer drops. The full text is present (12,642 characters for version 10). Studio therefore stores instructions as an ordered list of messages with a role, and the editor presents the common single-message case as one text area.
- The Responses API accepts `instructions` in a request only as a string ("expected a string, but got an array"). The runtime API therefore joins the messages in order with blank lines. About 9% of imported versions have two or three messages, mostly a short `system` message followed by the main prompt written as a `user` message; joining them moves that text from the user role into the instructions, which matches what the authors evidently intended. A message with non-text parts cannot be joined, so Studio refuses to save it and the runtime API answers 422 for it; no imported version has one.
- Sending the exported configuration inline reproduced the stored prompt exactly: 14,571 input tokens in both cases for version 10, once the tool fields the API rejects as request parameters were removed (image_generation `n`, and fields whose value is null).
- `prompt.version` confirms which version answered, and explicitly requested old versions resolve, so history can be imported.
- `model`, `reasoning` (effort, summary, and further fields), `text` (format, verbosity), `temperature`, and `top_p` reflect the prompt version.
- `max_output_tokens` reflects the import request itself, so the prompt's own value, if any, cannot be recovered.
- `tools` includes types the installed Python SDK does not model (`programmatic_tool_calling`), so the importer reads the raw JSON body instead of the SDK objects to avoid losing fields.

Hosted shell tools are the one place where the echo is not the stored configuration. The prompt's `container_auto` environment comes back as a `container_reference` to the container OpenAI created for the probe, which expires about 20 minutes later and is then rejected ("Container is expired"). The exporter therefore reads that container right after each probe and rebuilds the spec: `memory_limit` and `network_policy` from the container object, and `file_ids` from the attached files, whose paths have the form `/mnt/data/<file id>-<file name>`. Skills attached to the environment appear neither in the echo nor in the container, so they cannot be recovered automatically. Among published versions only `AI家教老師 - 幫助你完成作業` uses them; adding its two project skills (`show-opening-image`, `file-understanding`) as `skill_reference` entries reproduced the stored prompt's 2,636 input tokens exactly, so that agent needs one manual version in Studio after import.

All 224 published versions were then checked with `scripts/verify_inline_requests.py`, which sends the inline request and the stored prompt once each and compares input tokens. 214 match exactly. The 7 multi-message agents are 3 or 4 tokens short, the per-message overhead removed by joining the messages. The tutor agent above lacks its skills, and the 2 agents on retired models cannot be called at all. Streaming responses sometimes report zero input tokens, so the check uses non-streaming calls where the prompt allows them and repeats streaming measurements until both sides report a count.

MCP authorization is not echoed, so MCP tools are imported without credentials and an admin attaches the matching secret afterwards; only one of the 228 RCSL rows declares an MCP tool.

Each call is billed for the whole prompt as input (about 14,600 input tokens for the largest sample), so importing every version of every agent costs roughly the number of versions times the average prompt length. The import is idempotent per agent and version, and must finish before 2026-11-30 while the prompt objects still resolve.

## Deployment

Authors can upload files from the tool settings for Code Interpreter, Hosted Shell, and File Search. File Search creates and indexes a separate vector store for each batch. Existing store references stay in the draft, and previously saved versions keep their original stores. The author applies the tool changes and saves or publishes the agent version to attach the files. Studio shows filenames and sends only the provider IDs at runtime.

Run `node scripts/discover-tool-file-projects.mjs` in a server environment with the RCSL registry credentials. It reports how many projects OpenAI verified and emits a JSON object of project IDs and credential fingerprints for the `STUDIO_FILE_KEY_FINGERPRINTS` server variable. Rerun discovery when the registry keys rotate. For a project outside the RCSL registry, `STUDIO_FILE_UPLOAD_KEYS` accepts a JSON object keyed by project ID. Use credentials scoped to that project with Files and Vector Stores access.

The image is built with Next.js standalone output. A compose file on lab-100-18 runs the application and a PostgreSQL 16 container on a private network; only the application port (8040) is published to the host for Nginx Proxy Manager. A proxy host for `studio.rcsl.online` with a Let's Encrypt certificate is added in Nginx Proxy Manager, since the wildcard DNS record already resolves the name to the server.

## Schedule risk

The full release has eight days before the retirement. The import and the runtime change are the only parts that cannot slip past 2026-11-30, so they are built and verified first; the editor, diffs, and permissions follow in the same release but could ship a few days later without affecting students, because the runtime only needs the imported data and the runtime API.
