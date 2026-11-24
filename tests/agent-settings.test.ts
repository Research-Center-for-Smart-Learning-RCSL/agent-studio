import { describe, expect, it } from "vitest";
import { agentSettingsSchema } from "../src/lib/agent-settings";

describe("Agent model settings", () => {
  it("validates tool selection and tool limits", () => {
    const settings = {
      tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "mcp", server_label: "workspace" }] },
      max_tool_calls: 2,
      parallel_tool_calls: false,
    };
    expect(agentSettingsSchema.parse(settings)).toEqual(settings);
    expect(agentSettingsSchema.safeParse({ max_tool_calls: 1.5 }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ tool_choice: { type: "function" } }).success).toBe(false);
  });

  it("rejects unsupported or runtime-controlled keys instead of discarding them", () => {
    for (const field of ["input", "model", "store", "tool_chioce"]) {
      expect(agentSettingsSchema.safeParse({ [field]: "example" }).success).toBe(false);
    }
  });
});
