import packageJson from "../../package.json" with { type: "json" };

export const githubRepoUrl = "https://github.com/openma-ai/backchat";
export const desktopVersion: string = packageJson.version;
export const desktopTag = `v${desktopVersion}`;
export const macArm64DmgUrl = `${githubRepoUrl}/releases/download/${desktopTag}/Backchat-${desktopVersion}-arm64.dmg`;
