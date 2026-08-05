import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_KEYCHAIN_APIS =
  /\b(?:keytar|safeStorage|SecKeychain)\b|security\s+(?:add|find|delete)-generic-password/i;

function productionSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (
      ![".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(entry.name))
      || /\.test\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

describe("credential storage contract", () => {
  it("does not link or call macOS Keychain APIs", () => {
    const roots = [resolve("src"), resolve("packages"), resolve("scripts")];
    const sources = roots.flatMap(productionSources);
    const violations = sources.filter((path) =>
      FORBIDDEN_KEYCHAIN_APIS.test(readFileSync(path, "utf8")),
    );
    const packageJson = readFileSync(resolve("package.json"), "utf8");

    expect(violations).toEqual([]);
    expect(packageJson).not.toMatch(/"keytar"\s*:/i);
  });
});
