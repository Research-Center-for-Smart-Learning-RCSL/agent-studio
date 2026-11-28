import { describe, expect, it } from "vitest";
import { hasLocalShell } from "../src/lib/tool-warnings";

describe("hasLocalShell", () => {
  it("flags a shell tool whose environment is local", () => {
    expect(hasLocalShell([{ type: "shell", environment: { type: "local" }, allowed_callers: ["programmatic"] }])).toBe(true);
    expect(hasLocalShell([{ type: "web_search" }, { type: "shell", environment: { type: "local" } }])).toBe(true);
  });

  it("does not flag a hosted shell, however it is configured", () => {
    expect(hasLocalShell([{ type: "shell", environment: { type: "container_auto" } }])).toBe(false);
    expect(hasLocalShell([{ type: "shell", environment: { type: "container_reference", container_id: "cntr_1" } }])).toBe(false);
    expect(hasLocalShell([{ type: "shell" }])).toBe(false);
    expect(hasLocalShell([{ type: "shell", environment: null }])).toBe(false);
    expect(hasLocalShell([{ type: "shell", environment: "local" }])).toBe(false);
  });

  it("ignores other tools that mention local", () => {
    expect(hasLocalShell([{ type: "function", name: "local", environment: { type: "local" } }])).toBe(false);
    expect(hasLocalShell([])).toBe(false);
  });
});
