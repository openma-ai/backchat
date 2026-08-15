import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Homepage } from "./Homepage";

const projectRoot = resolve(__dirname, "../..");
const outputHtml = resolve(projectRoot, "dist/website/index.html");
const outputHeaders = resolve(projectRoot, "dist/website/_headers");

describe("Backchat website", () => {
  it("builds as a standalone static site", () => {
    const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(packageManager, ["run", "website:build"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(outputHtml)).toBe(true);
    const html = readFileSync(outputHtml, "utf8");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('rel="canonical" href="https://backchat.openma.dev/"');
    expect(html).toContain('property="og:url" content="https://backchat.openma.dev/"');
    expect(existsSync(outputHeaders)).toBe(true);
    expect(readFileSync(outputHeaders, "utf8")).toContain("X-Content-Type-Options: nosniff");
  });

  it("presents the product, supported harnesses, and a real download path", () => {
    const html = renderToStaticMarkup(<Homepage />);

    expect(html).toContain("One workspace. Every agent.");
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('id="product"');
    expect(html).toContain('id="agents"');
    expect(html).toContain('id="download"');
    expect(html).toContain("Claude Code");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("DeepSeek Harness");
    expect(html).toContain("Gemini CLI");
    expect(html).toContain(
      'href="https://github.com/openma-ai/backchat/releases/download/preview/Backchat-preview-arm64.dmg"',
    );
    expect(html).toContain("Download for macOS");
    expect(html).toContain("Download latest build");
    expect(html).not.toContain("/actions/workflows/build-dmg.yml");
    expect(html).toContain('alt="Backchat desktop home"');
    expect(html).toContain('alt="Grouped agent activity in Backchat"');
  });

  it("gives Windows and Linux users native packaging runbooks", () => {
    const html = renderToStaticMarkup(<Homepage />);

    expect(html).toContain('id="build-runbooks"');
    expect(html).toContain('aria-label="Windows packaging runbook"');
    expect(html).toContain('aria-label="Linux packaging runbook"');
    expect(html).toContain("Node.js 20+");
    expect(html).toContain("pnpm install --frozen-lockfile");
    expect(html).toContain("pnpm exec electron-builder --win nsis --publish never");
    expect(html).toContain("pnpm exec electron-builder --linux AppImage --publish never");
    expect(html).toContain("*.exe");
    expect(html).toContain("*.AppImage");
  });
});
