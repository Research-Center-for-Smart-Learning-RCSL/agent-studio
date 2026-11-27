import { z } from "zod";

export type ModelPreset = { model: string; costly: boolean };

export const maxModelPresets = 30;

const presetSchema = z.object({
  model: z.string().trim().min(1, "模型 ID 不可空白").max(200, "模型 ID 太長").regex(/^\S+$/, "模型 ID 不可含空白"),
  costly: z.boolean(),
});

/** Validates what an administrator submits; IDs are unique ignoring case, since the warning match ignores case. */
export function parseModelPresets(input: unknown): ModelPreset[] {
  const list = z.array(presetSchema).max(maxModelPresets, "預設模型過多").parse(input);
  const seen = new Set<string>();
  for (const { model } of list) {
    const key = model.toLowerCase();
    if (seen.has(key)) throw new Error("預設模型不可重複");
    seen.add(key);
  }
  return list;
}

export function isPresetModel(model: string, presets: readonly ModelPreset[]): boolean {
  return presets.some((p) => p.model === model);
}

/** Case-insensitive, so a hand-typed "GPT-6.3-Sol" still gets the warning. */
export function isCostlyModel(model: string, presets: readonly ModelPreset[]): boolean {
  const wanted = model.trim().toLowerCase();
  return presets.some((p) => p.costly && p.model.toLowerCase() === wanted);
}

/** A saved model outside the presets reopens in manual mode; an empty draft starts on the dropdown. */
export function startsInManualMode(model: string, presets: readonly ModelPreset[]): boolean {
  return model.trim() !== "" && !isPresetModel(model, presets);
}
