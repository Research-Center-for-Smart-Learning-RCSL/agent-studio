import dictionary from "./i18n-dictionary.json";

export type Locale = "zh-Hant" | "en" | "pl";
export function parseLocale(value: string | undefined): Locale {
  return value === "en" || value === "pl" ? value : "zh-Hant";
}
export function translate(locale: Locale, key: string, values: unknown[] = []): string {
  const text = locale === "zh-Hant" ? key : (dictionary[locale] as Record<string, string>)[key] ?? key;
  return text.replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] === undefined ? match : String(values[Number(index)]));
}

// Server actions and upload endpoints return stable source messages, sometimes with a field path.
export function translateError(locale: Locale, message: string): string {
  if (locale === "zh-Hant") return message;
  const entries = dictionary[locale] as Record<string, string>;
  return message.split("; ").map((part) => {
    if (entries[part]) return entries[part];
    const separator = part.indexOf(": ");
    if (separator >= 0 && entries[part.slice(separator + 2)]) return part.slice(0, separator + 2) + entries[part.slice(separator + 2)];
    for (const [key, value] of Object.entries(entries)) {
      if (!key.includes("{0}")) continue;
      const pattern = key.split(/\{\d+\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)");
      const match = part.match(new RegExp(`^${pattern}$`));
      if (match) return value.replace(/\{(\d+)\}/g, (_, index: string) => match[Number(index) + 1] ?? "");
    }
    return part;
  }).join("; ");
}
