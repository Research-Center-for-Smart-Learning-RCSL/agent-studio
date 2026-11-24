# Logs integration

Studio shows the OpenAI Logs Manager archive under `/logs`. Logs keeps its own backend, database and capture; Studio only reads and writes through the Logs API. The design record on the Logs side is `docs/decisions/0007-agent-studio-callers.md` in that repository.

## How a request flows

The browser calls `/api/logs/v1/...` on Studio. The route handler in `src/app/api/logs/[...path]/route.ts` checks the Studio session, works out which projects the user may read, and forwards the request to the Logs API with a shared service token and three headers: the user's email, an administrator flag, and the readable `[organization, project]` pairs. The token and the headers never reach the browser. Logs refuses a request whose token is wrong and never falls back to a session cookie.

Which projects are readable follows Studio permissions. A Studio administrator reads everything. Any other user reads the projects they hold a viewer or editor role on. The organization and project selectors in the page header narrow this further through the `studio_org` and `studio_project` query parameters, which the proxy removes before forwarding; a selection can never widen what a user may read. The pure rules are in `src/lib/logs-scope.ts` and are covered by `tests/logs-scope.test.ts`.

Logs matches projects by the organization and project names carried by the captured agent lists, which equal the names Studio imported from the same registry. Renaming a project in Studio changes who can read its older turns until the Logs side learns the new name. Turns whose agent no list names belong to no project and are visible to administrators only.

Analytics, capture status and Logs accounts add up every project, so they are administrator-only and ignore the header selection. The proxy forwards state-changing requests only when the `Origin` header matches the site.

## Configuration

Both sides need the same secret, generated with `openssl rand -hex 32`.

On the Logs host, set `STUDIO_SERVICE_TOKEN` in the stack's `.env`. On Studio, set `LOGS_SERVICE_TOKEN` to the same value and `LOGS_API` to the Logs web entry point including its `/api` prefix, for example `http://192.168.100.18:8031/api`. The Logs API itself stays bound to loopback; the web container's nginx forwards `/api/` to it. When either Studio variable is unset the Logs item is hidden from the sidebar and `/logs` explains that Logs is not configured.

## Pages

Conversations and turns have search with highlighting, runtime, robot, status and Taipei date filters, kept in the address so Back returns to the same search. A conversation opens as a window of turns that can grow in both directions, with a shared title, notes, bookmark, and per turn tags, notes and recordings. Speech events, bookmarks, exports, the feedback board, capture status and Logs accounts follow the original application.

Exports are made by the Logs worker and listed on the exports page. An export keeps the requester's scope with the task, so a file never holds turns the requester could not read when asking.
