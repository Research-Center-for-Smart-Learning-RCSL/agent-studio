import { describe, expect, it } from "vitest";
import { defaultConversationName, describeFilter, titleAsName } from "../src/lib/logs-export";

const t = (key: string, values?: unknown[]) => (values ? key.replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)])) : key);

describe("titleAsName", () => {
  it("keeps a plain title and drops characters a file name cannot hold", () => {
    expect(titleAsName("點餐助理 對話", "pdf")).toBe("點餐助理 對話");
    expect(titleAsName('a/b:c*d?"e', "xlsx")).toBe("a-b-c-d--e");
  });

  it("removes a repeated extension and the marks the server adds", () => {
    expect(titleAsName("report.xlsx", "xlsx")).toBe("report");
    expect(titleAsName("notes_含筆記", "pdf")).toBe("notes");
  });

  it("returns an empty name when nothing usable is left", () => {
    expect(titleAsName("  ...  ", "pdf")).toBe("");
  });
});

describe("describeFilter", () => {
  it("says what a list filter holds and leaves out empty values and the caller's scope", () => {
    const text = describeFilter({ q: "紅茶", robot: "R-1", bookmarked: false, scope: "x", status: undefined }, t, (s) => `名稱:${s}`);
    expect(text).toBe("關鍵字: 紅茶, 機器人: 名稱:R-1");
  });

  it("counts conversations instead of listing their ids", () => {
    expect(describeFilter({ conversations: ["a", "b", "c"] }, t)).toBe("對話: 3 段");
  });

  it("is empty when nothing is filtered", () => {
    expect(describeFilter({ bookmarked: false }, t)).toBe("");
  });
});

describe("defaultConversationName", () => {
  it("names a conversation like the server names its export", () => {
    expect(defaultConversationName("點餐助理", "2026-11-20T11:00:05.000+08:00", "zh-TW")).toBe("對話_點餐助理_2026-11-20-1100");
    expect(defaultConversationName("Order Bot", "2026-11-20T11:00:05+08:00", "en")).toBe("conversation_Order Bot_2026-11-20-1100");
  });

  it("leaves out what is unknown and makes the agent safe as a file name", () => {
    expect(defaultConversationName(null, "2026-11-20T03:01:00+08:00", "zh-TW")).toBe("對話_2026-11-20-0301");
    expect(defaultConversationName("a/b: v1.2", null, "en")).toBe("conversation_a-b- v1-2");
  });
});
