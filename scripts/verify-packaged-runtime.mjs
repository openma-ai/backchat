import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const executable = process.argv[2];

if (!executable) {
  console.error("Usage: node scripts/verify-packaged-runtime.mjs <app-executable>");
  process.exit(2);
}

const resolvedExecutable = resolve(executable);
const resources = resolve(dirname(resolvedExecutable), "../Resources");
const executableName = basename(resolvedExecutable);
const runtimeExecutable = process.platform === "darwin"
  ? join(
      resolve(resources, ".."),
      "Frameworks",
      `${executableName} Helper.app`,
      "Contents",
      "MacOS",
      `${executableName} Helper`,
    )
  : resolvedExecutable;
const sdkRoot = join(
  resources,
  "app.asar/node_modules/@modelcontextprotocol/sdk/dist/esm",
);
const entrypoints = [
  "server/mcp.js",
  "server/streamableHttp.js",
  "client/index.js",
  "client/stdio.js",
  "client/streamableHttp.js",
  "client/sse.js",
  "types.js",
  "shared/protocol.js",
];
const specifiers = entrypoints.map((entrypoint) =>
  pathToFileURL(join(sdkRoot, entrypoint)).href,
);
const source = `await Promise.all(${JSON.stringify(specifiers)}.map((specifier) => import(specifier)))`;
const result = spawnSync(
  runtimeExecutable,
  ["--input-type=module", "-e", source],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) process.exit(result.status ?? 1);

const npmCli = join(
  resources,
  "bundled-npm-runtime.asar/node_modules/npm/bin/npm-cli.js",
);
const npmResult = spawnSync(
  runtimeExecutable,
  [npmCli, "--version"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  },
);

if (npmResult.stderr) process.stderr.write(npmResult.stderr);
if (npmResult.error) {
  console.error(npmResult.error);
  process.exit(1);
}
if (npmResult.status !== 0) process.exit(npmResult.status ?? 1);
if (!/^11\.17\.0\s*$/.test(npmResult.stdout ?? "")) {
  console.error(`Unexpected bundled npm version: ${JSON.stringify(npmResult.stdout)}`);
  process.exit(1);
}

process.exit(0);
