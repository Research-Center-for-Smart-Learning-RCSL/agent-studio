# Runtime functions

The "自訂函式" group of the tool editor lists the functions agent.rcsl.online runs itself, each with a switch that adds the backend's own definition to the agent. The list is `src/lib/runtime-functions.ts`. It mirrors three places in kebbi-browser-backend: the dispatch in `handle_tool_calls_responses_api` (`openai_handler.py`), `get_llm_function_tools` (same file), and `get_workspace_function_tools` (`workspace_handler.py`).

A function the model calls under any other name gets the text `Unknown tool: <name>` as its result, so a configured function missing from the list is shown with a warning. On 2026-11-24 two such names were in use: `get_database_data` (13 agents) and `get_storage_file` (1 agent).

When the backend gains or drops a function, change `runtime-functions.ts`, add the Chinese description to `src/lib/i18n-dictionary.json` (en and pl), and update the expected names in `tests/runtime-functions.test.ts`. The backend replaces the definitions of `upload_file` and `workspace_*` with its own when an agent declares them, and appends the `workspace_*` functions by itself when workspaces are enabled, so those need no configuration to work.
