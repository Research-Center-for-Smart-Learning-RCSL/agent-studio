import { describe, expect, it } from "vitest";
import { normalizeInstructions, sanitizeTools, toResponsesRequest } from "../src/lib/openai-shape";

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

describe("toResponsesRequest", () => {
  it("drops response-only tool fields and nulls, omits empty instructions", () => {
    const req = toResponsesRequest({
      model: "m",
      instructions: [],
      tools: [{ type: "image_generation", n: 1, size: "auto", output_schema: null }],
      settings: { temperature: 1, top_p: null },
    });
    expect(req).toEqual({ model: "m", tools: [{ type: "image_generation", size: "auto" }], temperature: 1 });
  });

  it("sends multi-message instructions as one string in order", () => {
    const req = toResponsesRequest({
      model: "m",
      instructions: [
        { role: "developer", content: "one" },
        { role: "user", content: "two" },
      ],
      tools: [],
      settings: {},
    });
    expect(req.instructions).toBe("one\n\ntwo");
  });

  it("refuses non-text instructions instead of sending something wrong", () => {
    expect(() =>
      toResponsesRequest({ model: "m", instructions: [{ role: "user", content: [{ type: "input_image" }] }], tools: [], settings: {} }),
    ).toThrow();
  });
});

describe("sanitizeTools", () => {
  it("does not mutate the stored definition", () => {
    const tool = { type: "image_generation", n: 1 };
    sanitizeTools([tool]);
    expect(tool.n).toBe(1);
  });
});
