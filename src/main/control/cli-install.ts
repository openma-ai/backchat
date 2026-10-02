import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { cliInstallCandidates } from "../cli-path.js";

export async function installBackchatCli(options: {
  scriptPath: string;
  home?: string;
  platform?: NodeJS.Platform;
  pathEnv?: string;
}): Promise<{ path: string | null; detail: string }> {
  try {
    await access(options.scriptPath);
  } catch {
    return { path: null, detail: `CLI script is missing: ${options.scriptPath}` };
  }
  const platform = options.platform ?? process.platform;
  const name = platform === "win32" ? "backchat.cmd" : "backchat";
  const body = platform === "win32"
    ? `@echo off\r\nnode ${quoteCmd(options.scriptPath)} %*\r\n`
    : `#!/bin/sh\nexec node ${shellQuote(options.scriptPath)} "$@"\n`;
  const pathDirs = new Set((options.pathEnv ?? process.env.PATH ?? "").split(delimiter).filter(Boolean));
  for (const dir of cliInstallCandidates(options.home, platform)) {
    try {
      await mkdir(dir, { recursive: true });
      const target = join(dir, name);
      await writeFile(target, body, "utf8");
      if (platform !== "win32") await chmod(target, 0o755);
      const onPath = pathDirs.has(dir);
      return {
        path: target,
        detail: onPath
          ? `Installed ${target}`
          : `Installed ${target}. Add ${dir} to PATH to run \`backchat\` from a shell.`,
      };
    } catch {
      continue;
    }
  }
  return { path: null, detail: "No writable directory for the backchat CLI" };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
