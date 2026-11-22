import type { AgentSettings, InstructionMessage } from "../db/schema";
import { toolAttachmentNamesKey } from "./tool-attachments";

const ROLES = new Set(["developer", "system", "user", "assistant"]);

/**
 * Convert the `instructions` item list a Responses API response echoes for a
 * stored prompt into Studio messages. Text-only content becomes a string so
 * the editor can show it as plain text; anything else is kept verbatim.
 */
export function normalizeInstructions(
  items: { role?: string; content?: unknown }[],
): InstructionMessage[] {
  const messages: InstructionMessage[] = [];
  for (const item of items) {
    const role = ROLES.has(item.role ?? "") ? (item.role as InstructionMessage["role"]) : "developer";
    const content = item.content;
    if (typeof content === "string") {
      messages.push({ role, content });
      continue;
    }
    if (!Array.isArray(content) || content.length === 0) continue;
    const textOnly = content.every(
      (part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "input_text" &&
        typeof (part as { text?: unknown }).text === "string",
    );
    messages.push({
      role,
      content: textOnly
        ? content.map((part) => (part as { text: string }).text).join("\n\n")
        : (content as Record<string, unknown>[]),
    });
  }
  return messages;
}

export function settingsFromResponse(r: {
  reasoning?: Record<string, unknown> | null;
  text?: Record<string, unknown> | null;
  temperature?: number | null;
  top_p?: number | null;
  truncation?: string | null;
  parallel_tool_calls?: boolean | null;
}): AgentSettings {
  const reasoning = r.reasoning && Object.keys(r.reasoning).length ? r.reasoning : null;
  return {
    reasoning,
    text: r.text ?? null,
    temperature: r.temperature ?? null,
    top_p: r.top_p ?? null,
    // The export probe sets its own max_output_tokens, so the prompt's value is unknown.
    max_output_tokens: null,
    truncation: r.truncation ?? null,
    parallel_tool_calls: r.parallel_tool_calls ?? null,
  };
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}

/**
 * Fields a stored prompt echoes in its tool list that the Responses API
 * rejects as request parameters ("Unknown parameter"). Found empirically,
 * see docs/design.md, Import.
 */
const RESPONSE_ONLY_TOOL_FIELDS: Record<string, string[]> = {
  image_generation: ["n"],
};

export function sanitizeTools(tools: Record<string, unknown>[]): Record<string, unknown>[] {
  return tools.map((tool) => {
    const clean = stripNulls(tool) as Record<string, unknown>;
    delete clean[toolAttachmentNamesKey];
    for (const field of RESPONSE_ONLY_TOOL_FIELDS[String(clean.type)] ?? []) delete clean[field];
    return clean;
  });
}

/**
 * The Responses API takes `instructions` only as a string, although it echoes
 * stored prompts as a message list. Text messages are joined in order; a
 * message with non-text parts cannot be expressed and makes this throw.
 */
export function instructionsToString(messages: InstructionMessage[]): string {
  return messages
    .map((m) => {
      if (typeof m.content !== "string") {
        throw new Error("instructions contain non-text content that cannot be sent inline");
      }
      return m.content;
    })
    .join("\n\n");
}

/**
 * Build the inline Responses API fields for one agent version: what the
 * runtime sends instead of `prompt: {id}`.
 */
export function toResponsesRequest(v: {
  model: string;
  instructions: InstructionMessage[];
  tools: Record<string, unknown>[];
  settings: AgentSettings;
}) {
  const instructions = instructionsToString(v.instructions);
  const request: Record<string, unknown> = {
    model: v.model,
    tools: sanitizeTools(v.tools),
  };
  if (instructions) request.instructions = instructions;
  for (const [key, value] of Object.entries(v.settings)) {
    if (value !== null && value !== undefined) request[key] = value;
  }
  return request;
}
