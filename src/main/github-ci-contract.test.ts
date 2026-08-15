import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
const dmg = readFileSync(resolve(".github/workflows/build-dmg.yml"), "utf8");
const codeql = readFileSync(resolve(".github/workflows/codeql.yml"), "utf8");
const dependabot = readFileSync(resolve(".github/dependabot.yml"), "utf8");
const setup = readFileSync(
  resolve(".github/actions/setup-node-pnpm/action.yml"),
  "utf8",
);
const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("github ci", () => {
  it("exposes a curated life-saving unit lane instead of the full red suite", () => {
    expect(pkg.scripts["test:ci"]).toMatch(/vitest\.ci\.config/);
    expect(ci).not.toMatch(/pnpm run test(?:\s|$)/);
    expect(dmg).not.toMatch(/pnpm run test(?:\s|$)/);
  });

  it("runs typecheck, the curated lane, and fast Electron e2e on pull requests", () => {
    expect(ci).toMatch(/^\s*pull_request:/m);
    expect(ci).toContain("pnpm run typecheck");
    expect(ci).toContain("pnpm run test:ci");
    expect(ci).toContain("pnpm run test:e2e:fast");
    expect(ci).toContain("node --test scripts/*.test.mjs");
    expect(setup).toContain("pnpm install --frozen-lockfile");
  });

  it("uses official GitHub and pnpm setup actions", () => {
    expect(ci).toContain("./.github/actions/setup-node-pnpm");
    expect(setup).toMatch(/uses: pnpm\/action-setup@v\d+/);
    expect(setup).toMatch(/uses: actions\/setup-node@v\d+/);
    expect(ci).toMatch(/uses: actions\/checkout@v\d+/);
    expect(ci).toMatch(/uses: actions\/dependency-review-action@v\d+/);
    expect(ci).toMatch(/uses: actions\/upload-artifact@v\d+/);
    expect(codeql).toMatch(/uses: github\/codeql-action\/init@v\d+/);
    expect(codeql).toContain("javascript-typescript");
    expect(dependabot).toContain("package-ecosystem: github-actions");
  });

  it("keeps packaged-runtime and first-prompt verification on the DMG job", () => {
    expect(dmg).toContain("./.github/actions/setup-node-pnpm");
    expect(dmg).toContain("pnpm run test:ci");
    expect(dmg).toContain("verify-packaged-runtime.mjs");
    expect(dmg).toContain("verify-packaged-first-prompt.mjs");
    expect(dmg).toContain("find release -type f -name '*.dmg'");
  });
});
