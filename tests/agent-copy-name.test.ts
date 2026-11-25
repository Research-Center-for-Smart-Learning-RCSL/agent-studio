import { describe, expect, it } from "vitest";
import { agentCopyName } from "../src/lib/agent-copy-name";

describe("agent copy names", () => {
  it("preserves the full source name when it is available in the destination", () => {
    expect(agentCopyName("Agent", ["(2) Agent"])).toBe("Agent");
    expect(agentCopyName("(2) Agent", ["Agent"])).toBe("(2) Agent");
  });

  it("prefixes the first available number starting at two", () => {
    expect(agentCopyName("Agent", ["Agent"])).toBe("(2) Agent");
    expect(agentCopyName("Agent", ["Agent", "(2) Agent"])).toBe("(3) Agent");
    expect(agentCopyName("Agent", ["Agent", "(2) Agent", "(4) Agent"])).toBe("(3) Agent");
  });

  it("avoids stacking prefixes when duplicating an existing copy", () => {
    expect(agentCopyName("(2) Agent", ["Agent", "(2) Agent"])).toBe("(3) Agent");
  });
});
