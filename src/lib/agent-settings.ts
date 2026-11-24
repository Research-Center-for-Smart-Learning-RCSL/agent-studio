import { z } from "zod";

const nonempty = z.string().min(1);
const toolSelector = z.union([
  z.strictObject({ type: z.enum(["function", "custom"]), name: nonempty }),
  z.strictObject({ type: z.literal("mcp"), server_label: nonempty, name: nonempty.nullish() }),
  z.strictObject({ type: z.enum([
    "file_search", "web_search", "web_search_preview", "web_search_preview_2025_03_11",
    "computer", "computer_use", "computer_use_preview", "code_interpreter",
    "image_generation", "programmatic_tool_calling", "apply_patch", "shell",
  ]) }),
]);

export const agentSettingsSchema = z.strictObject({
  reasoning: z.record(z.string(), z.unknown()).nullish(),
  text: z.record(z.string(), z.unknown()).nullish(),
  temperature: z.number().min(0).max(2).nullish(),
  top_p: z.number().min(0).max(1).nullish(),
  max_output_tokens: z.number().int().positive().nullish(),
  max_tool_calls: z.number().int().nonnegative().nullish(),
  truncation: z.enum(["auto", "disabled"]).nullish(),
  parallel_tool_calls: z.boolean().nullish(),
  tool_choice: z.union([
    z.enum(["none", "auto", "required"]),
    toolSelector,
    z.strictObject({ type: z.literal("allowed_tools"), mode: z.enum(["auto", "required"]), tools: z.array(toolSelector).min(1) }),
  ]).nullish(),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;
