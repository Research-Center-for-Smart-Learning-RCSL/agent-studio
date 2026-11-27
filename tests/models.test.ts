import { describe, expect, it } from "vitest";
import { initialModel, isCostlyModel, modelWarning, isPresetModel, maxModelPresets, parseModelPresets, startsInManualMode, type ModelPreset } from "../src/lib/models";

const presets: ModelPreset[] = [
  { model: "gpt-6-luna", costly: false },
  { model: "gpt-6.3-sol", costly: true },
];

describe("model presets", () => {
  it("warns only for models an administrator marked costly", () => {
    expect(isCostlyModel("gpt-6.3-sol", presets)).toBe(true);
    expect(isCostlyModel("gpt-6-luna", presets)).toBe(false);
    expect(isCostlyModel("gpt-5.2", presets)).toBe(false);
    expect(isCostlyModel("gpt-6.3-sol", [{ model: "gpt-6.3-sol", costly: false }])).toBe(false);
    expect(isCostlyModel("gpt-6.3-sol", [])).toBe(false);
  });

  it("also warns when a costly model is typed by hand in another case", () => {
    expect(isCostlyModel(" GPT-6.3-Sol ", presets)).toBe(true);
  });

  it("opens in manual mode only for a saved model outside the presets", () => {
    expect(startsInManualMode("", presets)).toBe(false);
    expect(startsInManualMode("gpt-6-luna", presets)).toBe(false);
    expect(startsInManualMode("gpt-5.2", presets)).toBe(true);
    expect(startsInManualMode("gpt-6-luna", [])).toBe(true);
    expect(isPresetModel("GPT-6-LUNA", presets)).toBe(false);
  });
});

describe("parseModelPresets", () => {
  it("trims ids and keeps order and flags", () => {
    expect(parseModelPresets([{ model: " a ", costly: true }, { model: "b", costly: false }])).toEqual([
      { model: "a", costly: true },
      { model: "b", costly: false },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseModelPresets([])).toEqual([]);
  });

  it("rejects blank ids, ids with spaces, and duplicates ignoring case", () => {
    expect(() => parseModelPresets([{ model: "  ", costly: false }])).toThrow(new Error("模型 ID 不可空白"));
    expect(() => parseModelPresets([{ model: "a b", costly: false }])).toThrow();
    expect(() => parseModelPresets([{ model: "gpt-x", costly: false }, { model: "GPT-X", costly: true }])).toThrow("預設模型不可重複");
  });

  it("rejects a missing flag, wrong types and too many entries", () => {
    expect(() => parseModelPresets([{ model: "a" }])).toThrow();
    expect(() => parseModelPresets("a")).toThrow();
    const many = Array.from({ length: maxModelPresets + 1 }, (_, i) => ({ model: `m${i}`, costly: false }));
    expect(() => parseModelPresets(many)).toThrow();
  });
});

describe("initialModel", () => {
  it("starts a new agent on the first preset, whatever its cost flag", () => {
    expect(initialModel(presets, "gpt-5.2")).toBe("gpt-6-luna");
    expect(initialModel([{ model: "gpt-6.3-sol", costly: true }], "gpt-5.2")).toBe("gpt-6.3-sol");
  });

  it("falls back when no preset is configured", () => {
    expect(initialModel([], "gpt-5.2")).toBe("gpt-5.2");
  });
});

describe("modelWarning", () => {
  it("warns about cost for a costly preset, also typed by hand", () => {
    expect(modelWarning("gpt-6.3-sol", presets)).toBe("costly");
    expect(modelWarning("GPT-6.3-SOL", presets)).toBe("costly");
  });

  it("warns that a manually entered model is unconfirmed", () => {
    expect(modelWarning("gpt-5.2", presets)).toBe("unlisted");
    expect(modelWarning("gpt-6-LUNA", presets)).toBe("unlisted");
    expect(modelWarning("gpt-6-luna", [])).toBe("unlisted");
  });

  it("does not warn for a plain preset or an empty field", () => {
    expect(modelWarning("gpt-6-luna", presets)).toBeNull();
    expect(modelWarning("", presets)).toBeNull();
    expect(modelWarning("   ", presets)).toBeNull();
  });
});
