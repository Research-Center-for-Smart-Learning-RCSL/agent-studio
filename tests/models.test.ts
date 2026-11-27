import { describe, expect, it } from "vitest";
import { isCostlyModel, isPresetModel, presetModels, startsInManualMode } from "../src/lib/models";

describe("model presets", () => {
  it("offers exactly the four dropdown models", () => {
    expect(presetModels.map((m) => m.id)).toEqual(["gpt-6-luna", "gpt-6.1-terra", "gpt-6.3-sol", "gpt-6.2-astra"]);
  });

  it("warns about cost for sol and astra only", () => {
    expect(presetModels.filter((m) => m.costly).map((m) => m.id)).toEqual(["gpt-6.3-sol", "gpt-6.2-astra"]);
    expect(isCostlyModel("gpt-6.3-sol")).toBe(true);
    expect(isCostlyModel("gpt-6.2-astra")).toBe(true);
    expect(isCostlyModel("gpt-6-luna")).toBe(false);
    expect(isCostlyModel("gpt-6.1-terra")).toBe(false);
    expect(isCostlyModel("gpt-5.2")).toBe(false);
  });

  it("also warns when a costly model is typed by hand in another case", () => {
    expect(isCostlyModel(" GPT-6.2-Astra ")).toBe(true);
  });

  it("opens in manual mode only for a saved model outside the presets", () => {
    expect(startsInManualMode("")).toBe(false);
    expect(startsInManualMode("gpt-6-luna")).toBe(false);
    expect(startsInManualMode("gpt-5.2")).toBe(true);
    expect(isPresetModel("gpt-6.2-Astra")).toBe(false);
  });
});
