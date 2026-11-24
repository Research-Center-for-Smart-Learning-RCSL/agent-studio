import { describe, expect, it } from "vitest";
import { normalizeInstructions, sanitizeTools, toResponsesConfig } from "../src/lib/openai-shape";

describe("normalizeInstructions", () => {
  it("joins text parts, drops empty messages, keeps roles", () => {
    const out = normalizeInstructions([
      { role: "system", content: [{ type: "input_text", text: "a" }, { type: "input_text", text: "b" }] },
      { role: "user", content: [] },
    ]);
    expect(out).toEqual([{ role: "system", content: "a\n\nb" }]);
  });

  it("keeps non-text content verbatim", () => {
    const parts = [{ type: "input_image", image_url: "x" }];
    expect(normalizeInstructions([{ role: "user", content: parts }])).toEqual([{ role: "user", content: parts }]);
  });
});

describe("toResponsesConfig", () => {
  it("drops response-only tool fields and nulls, omits empty instructions", () => {
    const { request } = toResponsesConfig({
      model: "m",
      instructions: [],
      tools: [{ type: "image_generation", n: 1, size: "auto", output_schema: null }],
      settings: { temperature: 1, top_p: null },
    });
    expect(request).toEqual({ model: "m", tools: [{ type: "image_generation", size: "auto" }], temperature: 1 });
  });

  it("preserves message order and roles with a legacy text fallback", () => {
    const instructions = [
      { role: "developer", content: "one" },
      { role: "user", content: "two" },
      { role: "assistant", content: "three" },
    ] as const;
    const { messages, request } = toResponsesConfig({
      model: "m",
      instructions: [...instructions],
      tools: [],
      settings: {},
    });
    expect(messages).toEqual(instructions);
    expect(request.instructions).toBe("one\n\ntwo\n\nthree");
  });

  it("keeps supported content parts in their messages", () => {
    const content = [{ type: "input_image", file_id: "file-test" }];
    const { messages, request } = toResponsesConfig({
      model: "m",
      instructions: [{ role: "user", content }],
      tools: [],
      settings: {},
    });
    expect(messages).toEqual([{ role: "user", content }]);
    expect(request).not.toHaveProperty("instructions");
  });

  it("refuses incomplete content parts", () => {
    expect(() =>
      toResponsesConfig({ model: "m", instructions: [{ role: "user", content: [{ type: "input_image" }] }], tools: [], settings: {} }),
    ).toThrow();
  });

  it("passes validated tool selection and limits without stripping them", () => {
    const choice = { type: "function", name: "upload_file" } as const;
    const { request } = toResponsesConfig({
      model: "m",
      instructions: [],
      tools: [],
      settings: { tool_choice: choice, max_tool_calls: 2 },
    });
    expect(request).toMatchObject({ tool_choice: choice, max_tool_calls: 2 });
  });
});

describe("sanitizeTools", () => {
  it("does not mutate the stored definition", () => {
    const tool = { type: "image_generation", n: 1 };
    sanitizeTools([tool]);
    expect(tool.n).toBe(1);
  });
});
