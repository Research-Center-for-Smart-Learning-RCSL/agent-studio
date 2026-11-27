/**
 * Models offered in the editor's dropdown. Any other model ID is entered by hand.
 * `costly` models show a price warning when selected.
 */
export const presetModels: readonly { id: string; costly: boolean }[] = [
  { id: "gpt-6-luna", costly: false },
  { id: "gpt-6.1-terra", costly: false },
  { id: "gpt-6.3-sol", costly: true },
  { id: "gpt-6.2-astra", costly: true },
];

export function isPresetModel(model: string): boolean {
  return presetModels.some((m) => m.id === model);
}

/** Case-insensitive, so a hand-typed "GPT-6.3-Sol" still gets the warning. */
export function isCostlyModel(model: string): boolean {
  const wanted = model.trim().toLowerCase();
  return presetModels.some((m) => m.costly && m.id === wanted);
}

/** A saved model outside the presets reopens in manual mode; an empty draft starts on the dropdown. */
export function startsInManualMode(model: string): boolean {
  return model.trim() !== "" && !isPresetModel(model);
}
