import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { preview } from "vite";
import { describe, expect, it } from "vitest";
import { Homepage } from "./Homepage";
import { DeepSeekGuide } from "./DeepSeekGuide";

const projectRoot = resolve(__dirname, "../..");
const outputHtml = resolve(projectRoot, "dist/website/index.html");
const outputHeaders = resolve(projectRoot, "dist/website/_headers");
const deepSeekHtml = resolve(projectRoot, "dist/website/deepseek/index.html");
const chineseHomeHtml = resolve(projectRoot, "dist/website/zh/index.html");
const chineseDeepSeekHtml = resolve(projectRoot, "dist/website/zh/deepseek/index.html");
const robotsTxt = resolve(projectRoot, "dist/website/robots.txt");
const sitemapXml = resolve(projectRoot, "dist/website/sitemap.xml");
const logoSvg = resolve(projectRoot, "dist/website/logo.svg");
const faviconIco = resolve(projectRoot, "dist/website/favicon.ico");
const webManifest = resolve(projectRoot, "dist/website/site.webmanifest");
const readmePath = resolve(projectRoot, "README.md");
const packageJsonPath = resolve(projectRoot, "package.json");

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
    expect(html).toContain('<div id="root">');
    expect(html).toContain('rel="canonical" href="https://backchat.openma.dev/"');
    expect(html).toContain('property="og:url" content="https://backchat.openma.dev/"');
    expect(html).toContain("One workspace. Every agent.");
    expect(html).toContain('application/ld+json');
    expect(existsSync(outputHeaders)).toBe(true);
    expect(readFileSync(outputHeaders, "utf8")).toContain("X-Content-Type-Options: nosniff");
    expect(existsSync(deepSeekHtml)).toBe(true);
    const guide = readFileSync(deepSeekHtml, "utf8");
    expect(guide).toContain("Use DeepSeek Harness in Backchat");
    expect(guide).toContain('https://backchat.openma.dev/deepseek/');
    expect(guide).toContain('"@type":"HowTo"');
    expect(guide).toContain('hreflang="zh-CN"');
    expect(existsSync(chineseHomeHtml)).toBe(true);
    const chineseHome = readFileSync(chineseHomeHtml, "utf8");
    expect(chineseHome).toContain('<html lang="zh-CN">');
    expect(chineseHome).toContain("一个工作区，连接所有智能体");
    expect(chineseHome).toContain('hreflang="en"');
    expect(existsSync(chineseDeepSeekHtml)).toBe(true);
    expect(readFileSync(chineseDeepSeekHtml, "utf8")).toContain("在 Backchat 中使用 DeepSeek Harness");
    expect(readFileSync(robotsTxt, "utf8")).toContain("Sitemap: https://backchat.openma.dev/sitemap.xml");
    expect(readFileSync(sitemapXml, "utf8")).toContain("https://backchat.openma.dev/deepseek/");
    expect(readFileSync(sitemapXml, "utf8")).toContain("https://backchat.openma.dev/zh/deepseek/");
    expect(html).toContain('rel="icon" href="/logo.svg"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    expect(existsSync(logoSvg)).toBe(true);
    expect(existsSync(faviconIco)).toBe(true);
    expect(existsSync(webManifest)).toBe(true);
    const builtMarketing = [
      html,
      guide,
      chineseHome,
      readFileSync(chineseDeepSeekHtml, "utf8"),
      readFileSync(webManifest, "utf8"),
    ].join("\n");
    expect(builtMarketing).not.toMatch(/local-first|本地优先/i);
  }, 15_000);

  it("hydrates every prerendered locale without browser errors", async () => {
    const server = await preview({
      configFile: resolve(projectRoot, "website.vite.config.ts"),
      preview: { host: "127.0.0.1", port: 44173, strictPort: false },
    });
    const baseUrl = server.resolvedUrls?.local[0];
    expect(baseUrl).toBeTruthy();

    const browser = await chromium.launch({ headless: true });
    const errors: string[] = [];
    try {
      const page = await browser.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      for (const route of ["/", "/deepseek/", "/zh/", "/zh/deepseek/"]) {
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
      }
    } finally {
      await browser.close();
      await server.close();
    }

    expect(errors).toEqual([]);
  });

  it("presents the product, supported harnesses, and a real download path", () => {
    const html = renderToStaticMarkup(<Homepage />);

    expect(html).toContain('<span class="hero-title-line">One workspace.</span>');
    expect(html).toContain('<span class="hero-title-line">Every agent.</span>');
    expect(html).toContain("Bring multiple agents into the same conversation");
    expect(html).toContain("built-in browser");
    expect(html).toContain("Native MCP Apps");
    expect(html).toContain("Codex plugins");
    expect(html).not.toContain("Your workspace stays yours.");
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('aria-label="Backchat on GitHub"');
    expect(html).not.toContain("without taking your work off your machine");
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('id="product"');
    expect(html).toContain('id="agents"');
    expect(html).toContain('id="download"');
    expect(html).toContain("Claude Code");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("DeepSeek Harness");
    expect(html).toContain('href="/deepseek/"');
    expect(html).toContain("Gemini CLI");
    expect(html).toContain(
      'href="https://github.com/openma-ai/backchat/releases/download/preview/Backchat-preview-arm64.dmg"',
    );
    expect(html).toContain("Download for macOS");
    expect(html).toContain("Download latest build");
    expect(html).not.toContain("/actions/workflows/build-dmg.yml");
    expect(html).toContain('alt="Backchat desktop home"');
    expect(html).toContain('alt="Grouped agent activity in Backchat"');

    const guideHtml = renderToStaticMarkup(<DeepSeekGuide />);
    expect(guideHtml).toContain('aria-label="DeepSeek Harness on GitHub"');
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

  it("positions Backchat around multi-harness workflows instead of local-first", () => {
    const presentation = [
      renderToStaticMarkup(<Homepage />),
      renderToStaticMarkup(<Homepage locale="zh-CN" />),
      readFileSync(readmePath, "utf8"),
      readFileSync(packageJsonPath, "utf8"),
    ].join("\n");

    expect(presentation).not.toMatch(/local-first|本地优先/i);
    expect(presentation).toContain("MULTI-HARNESS");
  });
});
