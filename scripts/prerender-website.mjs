import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "dist/website");
const routes = [
  ["/", "index.html"],
  ["/deepseek/", "deepseek/index.html"],
  ["/zh/", "zh/index.html"],
  ["/zh/deepseek/", "zh/deepseek/index.html"],
];

const server = await preview({
  configFile: resolve(projectRoot, "website.vite.config.ts"),
  preview: { host: "127.0.0.1", port: 4173, strictPort: false },
});
const baseUrl = server.resolvedUrls?.local[0];
if (!baseUrl) throw new Error("Vite preview did not expose a local URL");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [route, output] of routes) {
    await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(document.querySelector("#root")?.children.length));
    const outputPath = resolve(outputRoot, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await page.content(), "utf8");
  }
} finally {
  await browser.close();
  await server.close();
}
