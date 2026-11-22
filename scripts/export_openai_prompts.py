"""Export every RCSL prompt version from OpenAI into a JSONL file.

Runs inside the kebbi-browser-backend container so that it reuses that
service's RCSL lookups and API-key handling (see docs/design.md, Import):

    docker exec -w /app -e PYTHONPATH=/app kebbi-browser-backend \
        python /tmp/export_openai_prompts.py --out /tmp/prompt-export.jsonl

Each output line is one prompt version, or one failure record. Re-running
with the same --out skips versions already exported successfully.
"""

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

import main
import openai_handler

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
# Used only to read back a prompt whose saved model OpenAI no longer serves;
# the saved model name is recorded instead of this one.
FALLBACK_MODEL = "gpt-4.1-mini"
MISSING_MODEL = re.compile(r"The model `([^`]+)` does not exist")


def probe(client: httpx.Client, api_key: str, prompt_id: str, version, model=None):
    prompt = {"id": prompt_id}
    if version is not None:
        prompt["version"] = str(version)
    body = {
        "prompt": prompt,
        "input": "ping",
        "max_output_tokens": 16,
        "store": False,
        "tool_choice": "none",
        # Prompts with image_generation partial_images reject non-streaming calls.
        "stream": True,
    }
    if model:
        body["model"] = model
    # Raw JSON keeps tool types the installed SDK does not model.
    with client.stream(
        "POST",
        OPENAI_RESPONSES_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json=body,
        timeout=120,
    ) as response:
        if response.status_code != 200:
            response.read()
            return response.status_code, response.json()
        last = None
        error = None
        data_lines = []

        def flush():
            nonlocal last, error
            payload = "\n".join(data_lines).strip()
            data_lines.clear()
            if not payload or payload == "[DONE]":
                return
            event = json.loads(payload)
            if isinstance(event.get("response"), dict):
                last = event["response"]
            if event.get("type") == "error":
                error = event.get("error") or event

        # An SSE event may span several data: lines and ends at a blank line.
        # Split on "\n" only: iter_lines() also splits on U+2028 and similar
        # characters, which may appear unescaped inside a JSON string.
        buffer = ""
        for chunk in response.iter_text():
            buffer += chunk
            *lines, buffer = buffer.split("\n")
            for line in lines:
                line = line.rstrip("\r")
                if line == "":
                    flush()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].lstrip(" "))
        if buffer.startswith("data:"):
            data_lines.append(buffer[5:].lstrip(" "))
        flush()
    if last is None:
        return 500, {"error": error or "stream ended without a response object"}
    return 200, last


CONTAINER_FILE = re.compile(r"^/mnt/data/(file-[A-Za-z0-9]+)-")


def recover_shell_environments(http: httpx.Client, api_key: str, raw: dict) -> dict:
    """
    A stored prompt echoes its hosted shell tool as a reference to the
    container OpenAI just created for the call, which expires within minutes.
    Rebuild the container_auto spec from that live container: memory limit,
    network policy, and the attached files, whose ids are the prefix of their
    /mnt/data paths. Must run right after the probe, while the container lives.
    """
    tools = []
    recovered = False
    for tool in raw.get("tools") or []:
        environment = tool.get("environment") or {}
        if tool.get("type") != "shell" or environment.get("type") != "container_reference":
            tools.append(tool)
            continue
        headers = {"Authorization": f"Bearer {api_key}"}
        container_id = environment["container_id"]
        container = http.get(
            f"https://api.openai.com/v1/containers/{container_id}", headers=headers, timeout=30
        ).json()
        files = http.get(
            f"https://api.openai.com/v1/containers/{container_id}/files?limit=100",
            headers=headers,
            timeout=30,
        ).json()
        spec = {"type": "container_auto"}
        file_ids = []
        for item in files.get("data") or []:
            match = CONTAINER_FILE.match(item.get("path") or "")
            if item.get("source") == "user" and match:
                file_ids.append(match.group(1))
        if file_ids:
            spec["file_ids"] = file_ids
        if container.get("memory_limit"):
            spec["memory_limit"] = container["memory_limit"]
        if container.get("network_policy"):
            spec["network_policy"] = container["network_policy"]
        tools.append({**tool, "environment": spec})
        recovered = True
    if not recovered:
        return raw
    return {**raw, "tools": tools, "_environment_recovered": True}


def snapshot(raw: dict) -> dict:
    instructions = [
        item
        for item in (raw.get("instructions") or [])
        if not (item.get("role") == "user" and not item.get("content"))
    ]
    return {
        "resolved_version": (raw.get("prompt") or {}).get("version"),
        "variables": (raw.get("prompt") or {}).get("variables"),
        "model": raw.get("model"),
        "instructions": instructions,
        "tools": raw.get("tools") or [],
        "reasoning": raw.get("reasoning"),
        "text": raw.get("text"),
        "temperature": raw.get("temperature"),
        "top_p": raw.get("top_p"),
        "truncation": raw.get("truncation"),
        "parallel_tool_calls": raw.get("parallel_tool_calls"),
        "input_tokens": (raw.get("usage") or {}).get("input_tokens"),
        "model_unavailable": bool(raw.get("_model_unavailable")),
        "environment_recovered": bool(raw.get("_environment_recovered")),
    }


def list_prompts():
    rows = []
    summary = openai_handler._fetch_openai_summary(force_refresh=True)
    for org in summary:
        for project in org.get("projects", []):
            prompts = openai_handler._fetch_project_prompts(
                project["project_id"], force_refresh=True
            )
            for prompt in prompts:
                rows.append(
                    {
                        "organization_id": org.get("organization_id"),
                        "organization_title": org.get("organization_title"),
                        "project_id": project.get("project_id"),
                        "project_title": project.get("project_title"),
                        "prompt_id": prompt.get("id"),
                        "name": prompt.get("name"),
                        "rcsl_default_version": prompt.get("default_version"),
                        "rcsl_tools": prompt.get("tools"),
                    }
                )
    return rows


def load_done(path: str) -> set:
    done = set()
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                record = json.loads(line)
                if record.get("ok"):
                    done.add((record["prompt_id"], str(record["version"])))
    except FileNotFoundError:
        pass
    return done


def candidate_keys(row: dict) -> list:
    """The project's own key, then the keys of the organization's other projects."""
    keys = []
    own = main._project_api_key(
        row["organization_title"], row["project_title"], "prompts"
    ) or main._project_api_key(row["organization_title"], row["project_title"])
    if own:
        keys.append(own)
    data = main._fetch_rcsl_json("openai").get("data") or {}
    for org in data.get("organization", []):
        if org.get("name") != row["organization_title"]:
            continue
        for project in org.get("project", []):
            raw_key = project.get("api_key")
            if raw_key:
                # Same storage offset correction as main._project_api_key.
                key = raw_key[0:-6] + raw_key[-5:]
                if key not in keys:
                    keys.append(key)
    return keys


def export_prompt(row: dict, done: set, http: httpx.Client) -> list:
    base = {key: row[key] for key in row}
    keys = candidate_keys(row)
    if not keys:
        return [{**base, "ok": False, "version": None, "error": "no api key"}]

    # A key that cannot see the prompt (401/403/404) moves on to the next key;
    # any other answer means this key reached the prompt. A retired model is
    # also a 404 but proves the prompt was found.
    for index, api_key in enumerate(keys):
        status, raw = probe(http, api_key, row["prompt_id"], None)
        if status not in (401, 403, 404) or MISSING_MODEL.search(json.dumps(raw)):
            break
    if index > 0:
        base["api_key_from_other_project"] = True

    def probe_version(version):
        status, raw = probe(http, api_key, row["prompt_id"], version)
        missing = MISSING_MODEL.search(json.dumps(raw)) if status != 200 else None
        if missing:
            status, raw = probe(http, api_key, row["prompt_id"], version, model=FALLBACK_MODEL)
            if status == 200:
                raw = {**raw, "model": missing.group(1)}
                raw["_model_unavailable"] = True
        if status == 200:
            raw = recover_shell_environments(http, api_key, raw)
        return status, raw

    if status == 200:
        raw = recover_shell_environments(http, api_key, raw)
    elif MISSING_MODEL.search(json.dumps(raw)):
        status, raw = probe_version(None)
    if status != 200:
        return [{**base, "ok": False, "version": None, "error": raw.get("error")}]
    default_version = int(raw["prompt"]["version"])
    records = []
    if (row["prompt_id"], str(default_version)) not in done:
        records.append(
            {**base, "ok": True, "version": default_version, "is_default": True, **snapshot(raw)}
        )

    # Versions newer than the default exist when an author saved without
    # promoting; probe upward until OpenAI rejects the version.
    version = default_version + 1
    while True:
        status, raw = probe_version(version)
        if status != 200:
            break
        if (row["prompt_id"], str(version)) not in done:
            records.append({**base, "ok": True, "version": version, "is_default": False, **snapshot(raw)})
        version += 1

    for version in range(1, default_version):
        if (row["prompt_id"], str(version)) in done:
            continue
        status, raw = probe_version(version)
        if status == 200:
            records.append({**base, "ok": True, "version": version, "is_default": False, **snapshot(raw)})
        else:
            records.append({**base, "ok": False, "version": version, "error": raw.get("error")})
    return records


def export_prompt_safely(row: dict, done: set, http: httpx.Client) -> list:
    try:
        return export_prompt(row, done, http)
    except Exception as exc:  # one bad prompt must not stop the whole export
        return [{**row, "ok": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}]


def main_cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    # nargs="+": an empty --only (an id lookup that returned nothing) must
    # fail rather than silently export every agent.
    parser.add_argument("--only", nargs="+", help="prompt ids to export")
    parser.add_argument("--list", action="store_true", help="print prompts and exit")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true", help="re-export versions already exported")
    args = parser.parse_args()

    rows = list_prompts()
    if args.only:
        rows = [row for row in rows if row["prompt_id"] in set(args.only)]
    if args.list:
        for row in rows:
            print(json.dumps(row, ensure_ascii=False))
        return

    done = set() if args.force else load_done(args.out)
    started = time.time()
    written = failures = 0
    with httpx.Client() as http, open(args.out, "a", encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for index, records in enumerate(
                pool.map(lambda row: export_prompt_safely(row, done, http), rows), start=1
            ):
                for record in records:
                    out.write(json.dumps(record, ensure_ascii=False) + "\n")
                    written += record.get("ok", False)
                    failures += not record.get("ok", False)
                out.flush()
                print(
                    f"[{index}/{len(rows)}] versions written={written} failures={failures} "
                    f"elapsed={time.time() - started:.0f}s",
                    file=sys.stderr,
                )


if __name__ == "__main__":
    main_cli()
