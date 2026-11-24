import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("agent editor layout", () => {
  it("never makes an inactive tab pane visible while Instructions is active", () => {
    const rules = css.split("}").filter((rule) => rule.includes(".is-instructions-active .ant-tabs-content"));
    const unscoped = rules.filter(
      (rule) =>
        /display:\s*flex/.test(rule) &&
        !rule.split("{")[0].includes(".ant-tabs-content-active") &&
        !rule.split("{")[0].includes(".ant-tabs-content-holder"),
    );
    expect(unscoped).toEqual([]);
    expect(css).toMatch(/\.is-instructions-active \.ant-tabs-content:not\(\.ant-tabs-content-active\)\s*\{\s*display:\s*none/);
  });
});
