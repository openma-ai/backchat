import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { macArm64DmgUrl } from "./release";

const websiteFiles = [
  "src/website/Homepage.tsx",
  "src/website/DeepSeekGuide.tsx",
  "src/website/index.html",
  "src/website/zh/index.html",
];

const stableDmgUrl =
  "https://github.com/openma-ai/backchat/releases/latest/download/Backchat-arm64.dmg";

describe("website desktop release", () => {
  it("points the macOS download at GitHub's stable latest asset", () => {
    expect(macArm64DmgUrl).toBe(stableDmgUrl);
  });

  it("does not pin visitors to a versioned or preview asset name", () => {
    const sources = websiteFiles.map((path) => readFileSync(resolve(path), "utf8"));
    for (const source of sources) {
      expect(source).not.toContain("/releases/download/preview/");
      expect(source).not.toContain("Backchat-preview-arm64.dmg");
      expect(source).not.toMatch(/releases\/download\/v\d/);
    }
    expect(sources[0]).toContain("macArm64DmgUrl");
    expect(sources[1]).toContain("macArm64DmgUrl");
    expect(sources[2]).toContain(stableDmgUrl);
    expect(sources[3]).toContain(stableDmgUrl);
  });
});
