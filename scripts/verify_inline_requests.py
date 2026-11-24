"""Check that inline requests reproduce the stored OpenAI prompts.

For each line of dump-runtime-requests.ts output, sends the inline request
once (unstored, 16 output tokens, tools disabled) and compares its input
token count with the count the stored prompt produced during the export.
Equal counts mean the model received the same instructions and tools.
Streaming responses sometimes report zero input tokens, so measurements use
non-streaming calls and fall back to streaming only for prompts that require
it. With --fresh-prompt the stored prompt is measured again instead of using
the count recorded during the export.
Runs in the kebbi-browser-backend container next to export_openai_prompts.py:

    docker exec -w /app -e PYTHONPATH=/app kebbi-browser-backend python \
        /tmp/verify_inline_requests.py --requests /tmp/requests.jsonl \
        --export /tmp/prompt-export.jsonl --out /tmp/verify.jsonl
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor

import httpx

from export_openai_prompts import OPENAI_RESPONSES_URL, candidate_keys


def load_export(path):
    records = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("ok"):
                records[(record["prompt_id"], int(record["version"]))] = record
    return records


def verify(item, export, http, fresh_prompt=False):
    record = export.get((item["id"], item["version"]))
    result = {"id": item["id"], "name": item["name"], "version": item["version"]}
    if record is None:
        return {**result, "status": "no export record"}
    if record.get("model_unavailable"):
        return {**result, "status": "skipped: model retired"}
    if item.get("error"):
        return {**result, "status": "invalid Studio configuration", "error": item["error"]}
    probe_fields = {"input": "ping", "max_output_tokens": 16, "store": False, "tool_choice": "none"}
    body = {**item["request"], **probe_fields}
    messages = item.get("messages") or []
    if messages:
        body.pop("instructions", None)
        if len(messages) == 1 and messages[0]["role"] == "developer" and isinstance(messages[0]["content"], str):
            body["instructions"] = messages[0]["content"]
        else:
            body["input"] = [
                *[{"type": "message", **message} for message in messages],
                {"type": "message", "role": "user", "content": "ping"},
            ]
    last_error = None
    for api_key in candidate_keys(record):
        tokens, error = measure(http, api_key, body)
        if error and error.get("_status") in (401, 403):
            last_error = error
            continue
        if error:
            return {**result, "status": "rejected", "error": error}
        expected = record.get("input_tokens")
        if fresh_prompt:
            prompt_body = {"prompt": {"id": item["id"], "version": str(item["version"])}, **probe_fields}
            expected, prompt_error = measure(http, api_key, prompt_body)
            if prompt_error:
                return {**result, "status": "prompt rejected", "error": prompt_error}
        return {
            **result,
            "status": "match" if tokens == expected else "mismatch",
            "inline_tokens": tokens,
            "prompt_tokens": expected,
        }
    return {**result, "status": "no usable key", "error": last_error}


def measure(http, api_key, body):
    response = http.post(
        OPENAI_RESPONSES_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json=body,
        timeout=120,
    )
    payload = response.json()
    if response.status_code == 200:
        return (payload.get("usage") or {}).get("input_tokens"), None
    error = payload.get("error") or {}
    if "only supported with streaming" in (error.get("message") or ""):
        return call(http, api_key, {**body, "stream": True})
    return None, {**error, "_status": response.status_code}


def call(http, api_key, body):
    with http.stream(
        "POST",
        OPENAI_RESPONSES_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json=body,
        timeout=120,
    ) as response:
        if response.status_code != 200:
            response.read()
            error = response.json().get("error") or {}
            return None, {**error, "_status": response.status_code}
        usage = None
        buffer = ""
        for chunk in response.iter_text():
            buffer += chunk
            *lines, buffer = buffer.split("\n")
            for line in lines:
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                event = json.loads(payload)
                if event.get("type") == "error":
                    return None, event.get("error") or event
                usage = (event.get("response") or {}).get("usage") or usage
    return (usage or {}).get("input_tokens"), None


def main_cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", required=True)
    parser.add_argument("--export", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", nargs="*", help="agent ids to verify")
    parser.add_argument("--fresh-prompt", action="store_true")
    args = parser.parse_args()

    export = load_export(args.export)
    with open(args.requests, encoding="utf-8") as handle:
        items = [json.loads(line) for line in handle if line.strip()]
    if args.only:
        items = [item for item in items if item["id"] in set(args.only)]
    counts = {}
    with httpx.Client() as http, open(args.out, "w", encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(lambda item: verify(item, export, http, args.fresh_prompt), items):
                out.write(json.dumps(result, ensure_ascii=False) + "\n")
                counts[result["status"]] = counts.get(result["status"], 0) + 1
    print(json.dumps(counts, ensure_ascii=False), file=sys.stderr)


if __name__ == "__main__":
    main_cli()
