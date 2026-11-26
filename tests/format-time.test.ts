import { describe, expect, it } from "vitest";
import { formatTaipei } from "../src/lib/format-time";

describe("formatTaipei", () => {
  it("shows Taipei wall-clock time with plain spaces", () => {
    expect(formatTaipei("2026-11-26T01:28:43.000Z", "zh-Hant")).toBe("2026/11/26 09:28:43");
    expect(formatTaipei("2026-11-26T01:28:43.000Z", "en")).toBe("2026-11-26 09:28:43");
  });

  it("can leave out the seconds and rolls over midnight", () => {
    expect(formatTaipei("2026-12-31T16:05:09Z", "pl", false)).toBe("2027-01-01 00:05");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatTaipei("not a date", "en")).toBe("");
  });

  it("never contains characters other than digits, separators and a plain space", () => {
    expect(formatTaipei(Date.UTC(2026, 0, 1), "zh-Hant")).toMatch(/^[0-9/:]+ [0-9/:]+$/);
  });
});
