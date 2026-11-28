# Request logging

Studio writes one JSON object per line to the container's output, so `docker logs agent-studio-app-1` can be filtered with grep or jq. The code is `src/lib/request-log.ts`, `src/instrumentation.ts` and the wrapper on the runtime routes. No line holds a token, a key, a cookie, a query string or the values of a failed database query.

## Events

`request` is written for each call of the runtime API (`/api/runtime/v1/...`), the machine-facing routes the backend reads agents through. Fields: `ts`, `route` (`runtime.project_agents` or `runtime.agent`), `method`, `status`, `ms`, `project_id` or `agent_id` when the path has one (an id that does not match `[A-Za-z0-9_-]{1,100}` is logged as `invalid`), and `reason` when the handler threw. Calls rejected with 401 are the only ones anyone can send in volume without credentials, so at most one such line is written per 10 seconds, with `skipped_rejections` counting those left out since the previous one. A throwing handler is logged with status 500 and the error is rethrown for Next to handle.

`request_error` is written by the `onRequestError` hook for every error Next catches, whether in a page render, a route handler or a server action. Fields: `route` (the route file path), `kind` (`render`, `route`, `action` or `proxy`), `method`, `path` without its query string, `message` (one line, 200 characters at most) and `digest`.

`action_failed` is written when a server action returns an error to the browser. `action` names the action, `kind` is `forbidden`, `validation` or `error`, with a one-line `message` for the last two. These are mostly expected refusals such as a duplicate credential name, so read them as a trail of what users ran into, not as faults.

`logs_usage_failed` is written when the recent-use line of an agent page could not be read from Logs. `reason` is `http` (with the `status` Logs answered, for example 401 after a wrong service token), `unexpected_body`, a JavaScript error name such as `TimeoutError` (Logs did not answer within 3 seconds), or `scope_too_large`. The page itself is unaffected; only the line is left out.

Pages and static assets are not logged as requests; only their errors are, through `request_error`.

## Database errors

Drizzle puts the SQL text and the parameter values into the message of a failed query, and PostgreSQL messages quote the offending value, so a database error is logged as `database query failed (<SQLSTATE>)` and nothing else. The five-character SQLSTATE, for example `23505` for a unique violation, is read from the error or its cause. Look up the failing statement in the application code or the database's own log. The message that a failed server action returns to the browser is a separate path and is not covered by this.

## Recent-use line

The agent page shows the last seven days of the agent's turns, read from Logs (`fetchAgentUsage`). The line streams in after the page, so a slow Logs never delays the editor; the answer is kept for 30 seconds per user and agent, and a failure for 10 seconds. A non-administrator is narrowed to the agent's own project. Logs attributes a turn to a project only through the agent lists it captured, so a non-administrator may not be shown turns of a new agent or of a renamed project; for them a count of zero is left out instead of being reported as no use. When Logs returns a full page of 200 turns the count reads "at least" and the failure, latency and last-use figures cover only those newest 200.

## Retention

`docker-compose.yml` caps each container's output at 5 files of 10 MB. The cap applies when a container is created, and a deployment recreates the containers, which also discards the previous output. For history that outlives a deployment, the output has to be collected elsewhere.

## Examples

```sh
docker logs --since 1h agent-studio-app-1 2>&1 | grep '"event":"request"' | jq -c 'select(.status >= 400)'
docker logs agent-studio-app-1 2>&1 | grep '"event":"request_error"'
```
