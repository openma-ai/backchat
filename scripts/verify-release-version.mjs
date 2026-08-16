import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packagePath = resolve(process.argv[2] ?? "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const packageTag = `v${packageJson.version}`;
const releaseTag = process.env.GITHUB_REF_NAME?.trim();

if (!releaseTag) {
  console.error("GITHUB_REF_NAME is required to verify a release tag");
  process.exitCode = 1;
} else if (releaseTag !== packageTag) {
  console.error(
    `release tag ${releaseTag} does not match package version ${packageTag}`,
  );
  process.exitCode = 1;
} else {
  console.log(`release tag ${releaseTag} matches package version ${packageTag}`);
}
