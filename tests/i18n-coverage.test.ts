import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import dictionary from "../src/lib/i18n-dictionary.json";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Messages are looked up by their Chinese text, so a reworded message or a
// misspelled key silently falls back to Chinese in the other languages.
const literals = /\b(?:t|rich|failure)\(\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/g;

function messages() {
  const found = new Map<string, string>();
  for (const file of sources("src")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(literals)) {
      const key = match[1] !== undefined
        ? (JSON.parse(`"${match[1]}"`) as string)
        : match[2].replace(/\$\{[^}]*\}/g, (() => { let n = 0; return () => `{${n++}}`; })());
      // Only user-facing Chinese text is translated; identifiers and other calls named t( are skipped.
      if (/[㐀-鿿]/.test(key)) found.set(key, file);
    }
  }
  return found;
}

describe("translation coverage", () => {
  const found = messages();
  it("finds the messages it is meant to check", () => {
    expect(found.size).toBeGreaterThan(100);
    expect(found.has("上傳過於頻繁，請稍後再試")).toBe(true);
  });
  for (const locale of ["en", "pl"] as const) {
    it(`has a ${locale} translation for every message in the source`, () => {
      const entries = dictionary[locale] as Record<string, string>;
      const missing = [...found].filter(([key]) => !entries[key]).map(([key, file]) => `${file}: ${key}`);
      expect(missing).toEqual([]);
    });
  }
  it("keeps no key with surrounding whitespace, which a trimmed lookup would miss", () => {
    for (const locale of ["en", "pl"] as const) {
      expect(Object.keys(dictionary[locale]).filter((key) => key !== key.trim())).toEqual([]);
    }
  });
  it("places placeholders identically in every language", () => {
    for (const locale of ["en", "pl"] as const) {
      for (const [key, value] of Object.entries(dictionary[locale] as Record<string, string>)) {
        const slots = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join();
        expect(slots(value), key).toBe(slots(key));
      }
    }
  });
});
