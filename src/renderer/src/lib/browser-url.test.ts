import { describe, expect, it } from "vitest";

import { browserAddressLabel, normalizeBrowserUrl } from "./browser-url";

describe("normalizeBrowserUrl", () => {
  it.each([
    ["", "about:blank"],
    ["  about:blank  ", "about:blank"],
    ["https://example.test/path?q=1", "https://example.test/path?q=1"],
    ["/tmp/report.html", "file:///tmp/report.html"],
    ["localhost:3000/work", "https://localhost:3000/work"],
    ["example.test/docs", "https://example.test/docs"],
    ["openma", "https://openma"],
    ["find this phrase", "https://www.google.com/search?q=find%20this%20phrase"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeBrowserUrl(raw)).toBe(expected);
  });
});

describe("browserAddressLabel", () => {
  it.each([
    ["https://example.test/", "example.test"],
    [
      "https://example.test/docs/page?q=browser#section",
      "example.test/docs/page",
    ],
    ["about:blank", "about:blank"],
    ["not a complete url", "not a complete url"],
  ])("formats %j as %j", (url, expected) => {
    expect(browserAddressLabel(url)).toBe(expected);
  });
});
