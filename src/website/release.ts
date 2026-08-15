import packageJson from "../../package.json" with { type: "json" };

export const githubRepoUrl = "https://github.com/openma-ai/backchat";
export const desktopVersion: string = packageJson.version;
export const macArm64DmgUrl = `${githubRepoUrl}/releases/latest/download/Backchat-arm64.dmg`;
