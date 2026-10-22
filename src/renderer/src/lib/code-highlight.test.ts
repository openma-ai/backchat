import { describe, expect, it } from "vitest";
import { highlightCode, languageForPath, PLAIN_LANGUAGE } from "./code-highlight";

describe("languageForPath", () => {
  it.each([
    ["/repo/src/main.ts", "typescript"],
    ["/repo/App.tsx", "tsx"],
    ["/repo/run.sh", "shellscript"],
    ["/repo/Dockerfile", "docker"],
    ["/repo/docker-compose.dev.yml", "yaml"],
    ["/repo/Makefile", "make"],
    ["/repo/README.md", "markdown"],
    ["/repo/.env.local", "dotenv"],
    ["/repo/lib/x.h", "c"],
    ["/repo/notes.txt", PLAIN_LANGUAGE],
    ["/repo/LICENSE", PLAIN_LANGUAGE],
    ["/repo/data.unknownext", PLAIN_LANGUAGE],
  ])("%s → %s", async (path, language) => {
    await expect(languageForPath(path)).resolves.toBe(language);
  });
});

describe("highlightCode", () => {
  it("emits dual-theme token spans for a known grammar", async () => {
    const html = await highlightCode("const answer = 42;\n", "typescript");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-light:");
    expect(html).toContain("--shiki-dark:");
    expect(html).toContain('class="line"');
  });

  it("returns null for plain text", async () => {
    await expect(highlightCode("hello", PLAIN_LANGUAGE)).resolves.toBeNull();
  });
});
