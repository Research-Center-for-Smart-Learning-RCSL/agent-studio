import type { AgentSettings, InstructionMessage } from "../db/schema";
import { toolAttachmentNamesKey } from "./tool-attachments";
import { agentSettingsSchema } from "./agent-settings";

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
  max_tool_calls?: number | null;
}): AgentSettings {
  const reasoning = r.reasoning && Object.keys(r.reasoning).length ? r.reasoning : null;
  return {
    reasoning,
    text: r.text ?? null,
    temperature: r.temperature ?? null,
    top_p: r.top_p ?? null,
    // The export probe sets its own max_output_tokens, so the prompt's value is unknown.
    max_output_tokens: null,
    truncation: r.truncation === "auto" || r.truncation === "disabled" ? r.truncation : null,
    parallel_tool_calls: r.parallel_tool_calls ?? null,
    ...(typeof r.max_tool_calls === "number" ? { max_tool_calls: r.max_tool_calls } : {}),
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

/** Messages accepted by Responses API's EasyInputMessage input format. */
export function toRuntimeMessages(messages: InstructionMessage[]): InstructionMessage[] {
  const hasText = (value: unknown) => typeof value === "string" && value.length > 0;
  return messages.flatMap<InstructionMessage>(({ role, content }) => {
    if (!ROLES.has(role)) throw new Error("Invalid instruction role");
    if (typeof content === "string") return content ? [{ role, content }] : [];
    if (!Array.isArray(content)) throw new Error("Invalid instruction content");
    if (!content.length) return [];
    if (role === "assistant" && content.every((part) => part?.type === "output_text" && typeof part.text === "string")) {
      return [{ role, content: content.map((part) => part.text).join("\n\n") }];
    }
    const valid = content.every((part) => {
      if (part?.type === "input_text") return typeof part.text === "string";
      if (part?.type === "input_image") return hasText(part.image_url) || hasText(part.file_id);
      if (part?.type === "input_file") return hasText(part.file_id) || hasText(part.file_url) || hasText(part.file_data);
      return false;
    });
    if (!valid) throw new Error("Unsupported Responses API instruction content");
    return [{ role, content }];
  });
}

/**
 * Build the inline Responses API fields for one agent version: what the
 * runtime sends instead of `prompt: {id}`.
 */
export function toResponsesConfig(v: {
  model: string;
  instructions: InstructionMessage[];
  tools: Record<string, unknown>[];
  settings: AgentSettings;
}) {
  const messages = toRuntimeMessages(v.instructions);
  const request: { tools: Record<string, unknown>[] } & Record<string, unknown> = {
    model: v.model,
    tools: sanitizeTools(v.tools),
  };
  // Existing runtime clients still read the flattened text field.
  if (messages.length && messages.every(({ content }) => typeof content === "string")) {
    request.instructions = messages.map(({ content }) => content).join("\n\n");
  }
  for (const [key, value] of Object.entries(agentSettingsSchema.parse(v.settings))) {
    if (value !== null && value !== undefined) request[key] = value;
  }
  return { messages, request };
}
