import { describe, expect, it } from "vitest";
import { likePattern, parseLogQuery, responseStillWanted } from "../src/lib/request-log-query";

const parse = (query: string) => parseLogQuery(new URLSearchParams(query));

describe("parseLogQuery", () => {
  it("defaults to everything in the last day", () => {
    expect(parse("")).toEqual({ source: "all", range: "24h", event: null, errorsOnly: false, search: null, before: null });
  });

  it("reads each filter", () => {
    expect(parse("source=backend&range=7d&event=device_request&errors=1&q=%20robot%20%20one%20&before=250")).toEqual({
      source: "backend",
      range: "7d",
      event: "device_request",
      errorsOnly: true,
      search: "robot one",
      before: 250,
    });
  });

  it("falls back to the default for values it does not know", () => {
    expect(parse("source=other&range=1y&event=DROP%20TABLE&errors=yes&before=-3")).toEqual({ source: "all", range: "24h", event: null, errorsOnly: false, search: null, before: null });
    expect(parse("range=toString").range).toBe("24h");
    expect(parse("before=1e400").before).toBeNull();
    expect(parse("before=1.5").before).toBeNull();
  });

  it("caps the search text", () => {
    expect(parse(`q=${"a".repeat(500)}`).search).toHaveLength(100);
  });
});

describe("likePattern", () => {
  it("escapes the characters a LIKE pattern treats specially", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(likePattern("plain")).toBe("%plain%");
  });
});

describe("responseStillWanted", () => {
  it("accepts an answer for the reload that is still the latest", () => {
    expect(responseStillWanted({ generation: 3, cursor: null }, { generation: 3, cursor: null })).toBe(true);
  });

  it("rejects an answer that a newer reload or a filter change has overtaken", () => {
    expect(responseStillWanted({ generation: 3, cursor: null }, { generation: 4, cursor: null })).toBe(false);
    expect(responseStillWanted({ generation: 3, cursor: 90 }, { generation: 4, cursor: 90 })).toBe(false);
  });

  it("accepts a load-more answer only while the list still ends at the row it continued from", () => {
    expect(responseStillWanted({ generation: 3, cursor: 90 }, { generation: 3, cursor: 90 })).toBe(true);
    expect(responseStillWanted({ generation: 3, cursor: 90 }, { generation: 3, cursor: 120 })).toBe(false);
    expect(responseStillWanted({ generation: 3, cursor: 90 }, { generation: 3, cursor: null })).toBe(false);
  });
});
