import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { desktopVersion, macArm64DmgUrl } from "./release";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  version: string;
};

const websiteFiles = [
  "src/website/Homepage.tsx",
  "src/website/DeepSeekGuide.tsx",
  "src/website/index.html",
  "src/website/zh/index.html",
];

describe("website desktop release", () => {
  it("points the macOS download at the tagged GitHub asset for package.json", () => {
    expect(desktopVersion).toBe(pkg.version);
    expect(macArm64DmgUrl).toBe(
      `https://github.com/openma-ai/backchat/releases/download/v${pkg.version}/Backchat-${pkg.version}-arm64.dmg`,
    );
  });

  it("does not advertise the rolling preview DMG", () => {
    const sources = websiteFiles.map((path) => readFileSync(resolve(path), "utf8"));
    for (const source of sources) {
      expect(source).not.toContain("/releases/download/preview/");
      expect(source).not.toContain("Backchat-preview-arm64.dmg");
    }
    expect(sources[0]).toContain("macArm64DmgUrl");
    expect(sources[1]).toContain("macArm64DmgUrl");
    expect(sources[2]).toContain("__MAC_ARM64_DMG_URL__");
    expect(sources[3]).toContain("__MAC_ARM64_DMG_URL__");
    expect(sources[2]).toContain("__DESKTOP_VERSION__");
    expect(sources[3]).toContain("__DESKTOP_VERSION__");
  });
});
