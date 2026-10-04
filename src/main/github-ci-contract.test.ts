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
    expect(setup).toMatch(/node-version:\s*['"]?24\b/);
    expect(ci).toContain("uses: actions/checkout@v7");
    expect(ci).toContain("uses: actions/dependency-review-action@v5");
    expect(ci).toContain("uses: actions/upload-artifact@v7");
    expect(ci).not.toContain("allow-unsafe-pr-checkout");
    expect(dmg).toContain("uses: actions/checkout@v7");
    expect(dmg).toContain("uses: actions/upload-artifact@v7");
    expect(dmg).not.toContain("archive: false");
    expect(codeql).toContain("uses: actions/checkout@v7");
    expect(codeql).toMatch(/uses: github\/codeql-action\/init@v\d+/);
    expect(codeql).toContain("javascript-typescript");
    expect(dependabot).toContain("package-ecosystem: github-actions");
  });

  it("deploys the website after a versioned GitHub release", () => {
    const website = readFileSync(
      resolve(".github/workflows/deploy-website.yml"),
      "utf8",
    );
    expect(website).toMatch(/^\s*release:/m);
    expect(website).toContain("published");
    expect(website).toContain("workflow_dispatch");
    expect(website).toContain("pnpm run website:build");
    expect(website).toContain("uses: actions/checkout@v7");
    expect(website).toMatch(/uses: cloudflare\/wrangler-action@v\d+/);
    expect(website).toContain("secrets.CLOUDFLARE_API_TOKEN");
  });

  it("verifies packaged runtime, signature, and first prompt before publishing DMGs", () => {
    expect(dmg).toContain("./.github/actions/setup-node-pnpm");
    expect(dmg).toContain("pnpm run test:ci");
    expect(dmg).toContain("verify-packaged-runtime.mjs");
    expect(dmg).toContain("verify-packaged-macos-signature.mjs");
    expect(dmg).toContain("verify-packaged-first-prompt.mjs");
    expect(dmg).toContain("Backchat-arm64.dmg");
    expect(dmg).toContain("gh release create");
    expect(dmg).toContain("run-mac-builder.mjs");
    expect(dmg).toContain("preview-mac.yml");
    expect(dmg).toContain("latest-mac.yml");
    expect(dmg).toContain(".blockmap");
    expect(dmg).toContain("BACKCHAT_REQUIRE_DEVELOPER_ID");
    expect(dmg).toContain("codesign --verify --deep --strict");
    expect(dmg).toContain("spctl -a -vv");
    expect(dmg).toContain("stapler validate");
    expect(dmg).not.toContain("apply-mac-update");
    expect(dmg).not.toContain("continue-on-error");
    expect(dmg).toContain("prepare-stable-release-assets.mjs");
    expect(dmg).toContain("previous-stable-blockmap.json");
    expect(dmg).toContain("github.ref == 'refs/heads/main'");
    expect(dmg).toContain("startsWith(github.ref, 'refs/tags/')");
  });

  it("proves macOS stable and preview update flows without publishing", () => {
    const update = readFileSync(resolve(".github/workflows/macos-update-e2e.yml"), "utf8");
    expect(update).toContain("workflow_dispatch");
    expect(update).not.toMatch(/^\s*push:/m);
    expect(update).toContain("contents: read");
    expect(update).toContain("node scripts/macos-update-e2e.mjs release");
    expect(update).toContain("node scripts/macos-stable-release-update-e2e.mjs");
    expect(update).toContain("BACKCHAT_UPDATE_BUILD=910001");
    expect(update).toContain("BACKCHAT_UPDATE_BUILD=910002");
    expect(update).not.toContain("gh release");
    expect(update).not.toContain("publish-preview-release");
    expect(update).not.toContain("contents: write");
  });
});
