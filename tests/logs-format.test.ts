import { describe, expect, it } from "vitest";
import {
  badRange, entriesOf, filterParams, hasMedia, highlightParts, inlineImageSrc, searchTerms, taipeiDayEnd, taipeiDayStart, textSegments, wallClock,
} from "../src/lib/logs-format";

describe("logs formatting", () => {
  it("shows the wall clock part of a Taipei timestamp as is", () => {
    expect(wallClock("2026-10-28T00:08:40.317+08:00")).toBe("2026-10-28 00:08:40");
    expect(wallClock(null)).toBe("");
  });

  it("bounds a Taipei day with an exclusive end", () => {
    expect(taipeiDayStart("2026-12-31")).toBe("2026-12-31T00:00:00+08:00");
    expect(taipeiDayEnd("2026-12-31")).toBe("2027-01-01T00:00:00+08:00");
  });

  it("never loads an image from its own host", () => {
    const kept = inlineImageSrc("https://cdn.example.org/a.png");
    expect(kept?.src).toBe("/api/logs/v1/remote-images?url=" + encodeURIComponent("https://cdn.example.org/a.png"));
    expect(kept?.original).toBe("https://cdn.example.org/a.png");
    expect(inlineImageSrc("http://cdn.example.org/a.png")).toBeNull();
    expect(inlineImageSrc("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(inlineImageSrc("data:image/png;base64,AAAA")).toEqual({ src: "data:image/png;base64,AAAA" });
    expect(inlineImageSrc("javascript:alert(1)")).toBeNull();
  });

  it("splits Markdown images out of message text and keeps the rest", () => {
    expect(textSegments("看 ![貓](https://x.test/c.png) 好可愛")).toEqual([
      "看 ", { alt: "貓", url: "https://x.test/c.png", raw: "![貓](https://x.test/c.png)" }, " 好可愛",
    ]);
    expect(textSegments("no images")).toEqual(["no images"]);
  });

  it("reads media groups given as arrays or objects", () => {
    expect(entriesOf([1, 2])).toEqual([[null, 1], [null, 2]]);
    expect(entriesOf({ a: 1 })).toEqual([["a", 1]]);
    expect(entriesOf("x")).toEqual([]);
    expect(hasMedia({ images: [] })).toBe(false);
    expect(hasMedia({ images: [1] })).toBe(true);
    expect(hasMedia(null)).toBe(false);
  });

  it("takes the words a search looks for, leaving out what it excludes", () => {
    expect(searchTerms('紅茶 AND "珍珠奶茶" OR 奶*')).toEqual(["紅茶", "珍珠奶茶", "奶"]);
    expect(searchTerms("紅茶 NOT 熱")).toEqual(["紅茶"]);
    expect(searchTerms("紅茶 -熱 (冰 OR 溫)")).toEqual(["紅茶", "冰", "溫"]);
    expect(searchTerms("紅茶 NOT (熱 OR 溫)")).toEqual(["紅茶"]);
  });

  it("splits text at the matches without losing a character", () => {
    const parts = highlightParts("Red tea or red TEA", ["red tea"]);
    expect(parts.map((p) => p.text).join("")).toBe("Red tea or red TEA");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["Red tea", "red TEA"]);
    expect(highlightParts("abc", [])).toEqual([{ text: "abc", match: false }]);
  });
});

describe("list filters", () => {
  const base = { q: "", runtime: "", robot: "", bookmarked: "", since: "", until: "", status: "" };

  it("sends only what is set, with Taipei day bounds", () => {
    expect(filterParams(base)).toEqual({
      q: undefined, robot: undefined, runtime: undefined, status: undefined, bookmarked: undefined, since: undefined, until: undefined,
    });
    expect(filterParams({ ...base, q: " 紅茶 ", runtime: "robot", bookmarked: "1", since: "2026-11-01", until: "2026-11-30" }))
      .toMatchObject({ q: "紅茶", runtime: "robot", bookmarked: true, since: "2026-11-01T00:00:00+08:00", until: "2026-12-01T00:00:00+08:00" });
  });

  it("drops values the API would refuse", () => {
    expect(filterParams({ ...base, runtime: "mars", status: "weird", since: "tomorrow" }))
      .toMatchObject({ runtime: undefined, status: undefined, since: undefined });
  });

  it("notices a start after the end", () => {
    expect(badRange({ ...base, since: "2026-11-30", until: "2026-11-01" })).toBe(true);
    expect(badRange({ ...base, since: "2026-11-01", until: "2026-11-01" })).toBe(false);
    expect(badRange(base)).toBe(false);
  });
});
