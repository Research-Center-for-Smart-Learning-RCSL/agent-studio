import { describe, expect, it } from "vitest";
import { parseLocale, translate, translateError } from "../src/lib/i18n";

describe("localization", () => {
  it("defaults invalid locales to Traditional Chinese", () => {
    expect(parseLocale("fr")).toBe("zh-Hant");
    expect(parseLocale("pl")).toBe("pl");
  });
  it("translates and interpolates without translating user data", () => {
    expect(translate("en", "刪除 {0}？", ["user@example.com"])).toBe("Delete user@example.com?");
    expect(translate("pl", "組織")).toBe("Organizacja");
    expect(translate("zh-Hant", "名稱")).toBe("名稱");
  });
  it("translates server errors with field paths and interpolated limits", () => {
    expect(translateError("en", "model: 必填")).not.toContain("必填");
    expect(translateError("pl", "請選擇 1 至 10 個非空白檔案")).not.toContain("請選擇");
    expect(translateError("en", "unknown error")).toBe("unknown error");
  });
});
