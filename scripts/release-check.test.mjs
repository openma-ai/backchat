import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bumpLabelErrors,
  classifyBump,
  compareBase,
  coverageErrors,
  extractPrNumbers,
  formatAuditLine,
  mentionsPullRequest,
  missingPullRequests,
  readmeVersionErrors,
  runReleaseCheck,
  uniquePrNumbers,
  websiteVersionErrors,
} from "./release-check.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const checker = resolve(scriptsDir, "release-check.mjs");

const v0012Notes = `## What's Changed
* Backchat 0.0.12: compose icon on sidebar hover by @hrhrng in https://github.com/openma-ai/backchat/pull/24

**Full Changelog**: https://github.com/openma-ai/backchat/compare/v0.0.11...v0.0.12
`;

const v003Notes = `Unsigned Apple Silicon DMG. Backchat is still pre-release.

## Highlights
- Scheduled chats: create, run, and archive recurring tasks from the desktop shell
- Agent setup shows installed versions instead of burying them behind auth status
- Windows launch maximized (not macOS fullscreen), with the sidebar running state in the same trailing slot as the schedule clock
- Composer auth setup and DeepSeek Harness 0.4.6 wiring
- Bilingual website and canonical OpenMA logo assets

## Checks
Packaged runtime imports are verified before this installer is published.

## Assets
- \`Backchat-0.0.3-arm64.dmg\`

**Full Changelog**: https://github.com/openma-ai/backchat/compare/preview...v0.0.3
`;

function commits(lines) {
  return lines.map((line) => {
    const space = line.indexOf(" ");
    return { sha: line.slice(0, space), subject: line.slice(space + 1) };
  });
}

test("pull request mentions are bounded", () => {
  assert.equal(mentionsPullRequest("see #24 and /pull/24", 24), true);
  assert.equal(mentionsPullRequest("https://github.com/openma-ai/backchat/pull/24", 24), true);
  assert.equal(mentionsPullRequest("https://github.com/openma-ai/backchat/pull/240", 24), false);
  assert.equal(mentionsPullRequest("#240 #100 pull/100", 24), false);
  assert.equal(mentionsPullRequest("#100", 10), false);
  assert.equal(mentionsPullRequest("/pull/100", 10), false);
  assert.equal(mentionsPullRequest("DeepSeek Harness 0.4.6 and v0.0.3", 4), false);
  assert.equal(mentionsPullRequest("#10", 10), true);
  assert.deepEqual(missingPullRequests("#100 /pull/240", [24]), [24]);
  assert.deepEqual(missingPullRequests(v0012Notes, [24]), []);
});

test("subjects yield squash and merge pull request numbers once", () => {
  const found = uniquePrNumbers(commits([
    "aaaaaaaa Merge pull request #14 from openma-ai/codex/release-backchat-0.0.7",
    "bbbbbbbb Ship it (#14)",
    "cccccccc Fix macOS DMG bundle signing (#9)",
    "dddddddd chore(release): v0.0.6",
  ]));
  assert.deepEqual(found, [14, 9]);
  assert.deepEqual(extractPrNumbers("Merge pull request #13 from openma-ai/x"), [13]);
});

test("version bumps and release labels", () => {
  assert.equal(classifyBump("0.0.12", "0.0.13").kind, "patch");
  assert.equal(classifyBump("0.0.12", "0.1.0").kind, "minor");
  assert.equal(classifyBump("0.0.12", "1.0.0").kind, "major");
  assert.equal(classifyBump("0.0.12", "0.0.12").kind, "same");
  assert.equal(classifyBump("0.0.12", "0.0.11").kind, "downgrade");
  assert.deepEqual(bumpLabelErrors("patch", [], "0.0.12", "0.0.13"), []);
  assert.match(
    bumpLabelErrors("minor", [], "0.0.12", "0.1.0")[0],
    /release:minor/,
  );
  assert.deepEqual(bumpLabelErrors("minor", ["release:minor"], "0.0.12", "0.1.0"), []);
  assert.match(bumpLabelErrors("minor", ["release:major"], "0.0.12", "0.1.0")[0], /release:minor/);
  assert.match(bumpLabelErrors("major", [], "0.0.12", "1.0.0")[0], /release:major/);
  assert.deepEqual(bumpLabelErrors("major", ["release:major"], "0.0.12", "1.0.0"), []);
  assert.match(bumpLabelErrors("downgrade", [], "0.0.2", "0.0.1")[0], /does not increase/);
});

test("website and README pins follow package.json", () => {
  const version = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;
  const releaseSource = readFileSync(resolve(repoRoot, "src/website/release.ts"), "utf8");
  const homepage = readFileSync(resolve(repoRoot, "src/website/Homepage.tsx"), "utf8");
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
  assert.deepEqual(websiteVersionErrors(releaseSource, version, homepage), []);
  assert.deepEqual(readmeVersionErrors(readme, version), []);
  assert.deepEqual(
    readmeVersionErrors("Requirements: Node.js 24 and pnpm 11.24.0\n", "0.0.12"),
    [],
  );
  assert.match(
    readmeVersionErrors("Install Backchat v0.0.9 today.\n", "0.0.12")[0],
    /README.md pins Backchat v0\.0\.9, expected v0\.0\.12/,
  );
  assert.match(
    websiteVersionErrors('export const desktopVersion: string = "0.0.3";\n', "0.0.12")[0],
    /0\.0\.3/,
  );
  assert.match(
    websiteVersionErrors(
      "export const desktopVersion: string = packageJson.version;\n",
      "0.0.12",
      "const label = `v0.0.1`;\n",
    )[0],
    /Homepage\.tsx hardcodes/,
  );
});

test("compare bases come from published changelog links", () => {
  assert.equal(compareBase(v0012Notes, "v0.0.12"), "v0.0.11");
  assert.equal(compareBase(v003Notes, "v0.0.3"), "preview");
});

test("historical ranges cover real notes and catch omissions", () => {
  const cases = [
    {
      tag: "v0.0.12",
      previous: "v0.0.11",
      lines: ["7ba68da Backchat 0.0.12: compose icon on sidebar hover (#24)"],
      notes: v0012Notes,
      missing: [],
    },
    {
      tag: "v0.0.11",
      previous: "v0.0.10",
      lines: ["a6d9f4d Backchat 0.0.11: faster startup and shared project chat UI (#23)"],
      notes: "https://github.com/openma-ai/backchat/pull/23",
      missing: [],
    },
    {
      tag: "v0.0.10",
      previous: "v0.0.9",
      lines: ["26dd81b Backchat v0.0.10: repair packaged runtime and add sidebar sections (#22)"],
      notes: "https://github.com/openma-ai/backchat/pull/22",
      missing: [],
    },
    {
      tag: "v0.0.9",
      previous: "v0.0.8",
      lines: ["cbdcd6a Merge pull request #21 from openma-ai/codex/backchat-dependabot-20260928"],
      notes: "https://github.com/openma-ai/backchat/pull/21",
      missing: [],
    },
    {
      tag: "v0.0.6",
      previous: "v0.0.5",
      lines: ["9f5c83b chore(release): v0.0.6"],
      notes: "**Full Changelog**: https://github.com/openma-ai/backchat/compare/v0.0.5...v0.0.6\n",
      missing: [],
    },
    {
      tag: "v0.0.5",
      previous: "v0.0.4",
      lines: ["1211ac0 Ship reliable ACP updates and timeline ordering (#11)"],
      notes: "https://github.com/openma-ai/backchat/pull/11",
      missing: [],
    },
    {
      tag: "v0.0.4",
      previous: "v0.0.3",
      lines: [
        "bae6711 Point the website at tagged DMGs and deploy it on GitHub releases.",
        "1c91dbe Point website downloads at GitHub latest instead of a versioned DMG.",
        "691818e Fix macOS DMG bundle signing (#9)",
        "0397e11 Release v0.0.4 (#10)",
      ],
      notes: [
        "https://github.com/openma-ai/backchat/pull/9",
        "https://github.com/openma-ai/backchat/pull/10",
      ].join("\n"),
      missing: [],
    },
    {
      tag: "v0.0.7",
      previous: "v0.0.6",
      lines: [
        "6ec7665 refactor(chat): consume common Backchat state machine",
        "3684c6b refactor(chat): consume common Backchat renderer",
        "c669125 test(chat): cover retained disclosure state",
        "f03b25e fix(chat): stabilize activity disclosure state",
        "1f7a7e1 fix(deps): patch xmldom security vulnerabilities",
        "e5a2c9e Merge pull request #13 from openma-ai/codex/tenant-sessions-20260916",
        "8bdd3b7 Merge pull request #14 from openma-ai/codex/release-backchat-0.0.7",
      ],
      notes: "https://github.com/openma-ai/backchat/pull/13\nhttps://github.com/openma-ai/backchat/pull/14\n",
      missing: [],
    },
    {
      tag: "v0.0.8",
      previous: "v0.0.7",
      lines: [
        "7954562 Merge pull request #15 from openma-ai/codex/website-ai-domain",
        "17d7062 refactor(website): consume shared marketing theme (#16)",
        "698789b Merge pull request #17 from openma-ai/codex/neutral-website-text",
        "99e2ad3 Add direct agent connections and local host power management (#18)",
        "ac777a4 feat(composer): attach pasted and dropped images and files",
        "c92b90b chore(openma): default to app.openma.ai and canonicalize legacy hosts",
        "afdc81f style: transcript density, neutral primary buttons, settings primitives",
        "6f7605b feat: history paging and Project > Workspace > Worktree model",
        "3f4fb5c fix(workspace): picker polish, no recents from checkouts, quiet New chat row",
        "92a7ef9 fix(select): one highlight at a time in command lists",
        "202f70c Merge pull request #20 from openma-ai/codex/backchat-release-0.0.8",
      ],
      notes: [15, 16, 17, 18, 20].map((number) => `https://github.com/openma-ai/backchat/pull/${number}`).join("\n"),
      missing: [],
    },
    {
      tag: "v0.0.3",
      previous: "preview",
      lines: [
        "5d24792 Build bilingual Backchat website and guides (#4)",
        "177593c Restore canonical OpenMA logo assets (#5)",
        "b9b996a Ship scheduled chats and tighten agent desktop chrome.",
        "aae7ed9 ci: add PR gates, CodeQL, and packaged first-prompt checks",
        "710020b ci: run GitHub Actions on Node 24 for node:sqlite",
        "38497ed ci: publish the DMG before the packaged first-prompt smoke",
      ],
      notes: v003Notes,
      missing: [4, 5],
    },
  ];

  for (const entry of cases) {
    const history = commits(entry.lines);
    assert.deepEqual(
      missingPullRequests(entry.notes, uniquePrNumbers(history)),
      entry.missing,
      entry.tag,
    );
    assert.deepEqual(coverageErrors(entry.notes, history).length, entry.missing.length, entry.tag);
  }

  const current = commits(["7ba68da Backchat 0.0.12: compose icon on sidebar hover (#24)"]);
  const dropped = v0012Notes.replace("/pull/24", "/pull/240");
  assert.deepEqual(coverageErrors(dropped, current), [
    "generated release notes do not mention #24",
  ]);
  assert.match(
    formatAuditLine({
      tag: "v0.0.12",
      previous: "v0.0.11",
      numbers: [24],
      missing: [],
      ignored: [],
      versionError: "",
    }),
    /v0\.0\.12 since v0\.0\.11: pull requests #24; notes cover them$/,
  );
  const v004 = commits(cases.find((entry) => entry.tag === "v0.0.4").lines);
  assert.match(
    formatAuditLine({
      tag: "v0.0.4",
      previous: "v0.0.3",
      numbers: uniquePrNumbers(v004),
      missing: [],
      ignored: v004.filter((commit) => extractPrNumbers(commit.subject).length === 0),
      versionError: "",
    }),
    /pull requests #9 #10; notes cover them; ignored 2 commits with no pull request: bae6711, 1c91dbe$/,
  );
});

test("the executable rejects unknown arguments", () => {
  const result = spawnSync(process.execPath, [checker, "--publish"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown arguments: --publish/);
  assert.match(result.stdout, /::error::Unknown arguments: --publish/);
});

async function withRepo(run) {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-release-check-"));
  const bin = resolve(root, "bin");
  const ghLog = resolve(root, "gh.log");
  await mkdir(bin);
  await mkdir(resolve(root, "src/website"), { recursive: true });
  const fakeGh = resolve(bin, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
if (args.includes("create")) {
  console.error("refusing to create a release");
  process.exit(1);
}
if (args[0] === "api") {
  process.stdout.write(JSON.stringify({ body: process.env.FAKE_NOTES ?? "" }));
  process.exit(0);
}
console.error("unexpected gh " + args.join(" "));
process.exit(1);
`,
    "utf8",
  );
  await chmod(fakeGh, 0o755);
  const gitResult = spawnSync("git", ["init", "-b", "main"], { cwd: root, encoding: "utf8" });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  spawnSync("git", ["config", "user.email", "release-check@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "release-check"], { cwd: root });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  const env = { ...process.env };
  // GitHub Actions sets these for the pull request. Tests that need them set
  // the values explicitly; inheriting them makes a local git repo look like
  // the PR base and changes the notice text.
  for (const key of [
    "GITHUB_ACTIONS",
    "GITHUB_EVENT_NAME",
    "GITHUB_BASE_REF",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_HEAD_REF",
    "BASE_REF",
    "RELEASE_LABELS",
  ]) {
    delete env[key];
  }
  env.PATH = `${bin}:${process.env.PATH}`;
  env.GH_LOG = ghLog;
  env.GITHUB_REPOSITORY = "openma-ai/backchat";
  try {
    await run({
      root,
      env,
      ghLog,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeTree(root, version, homepage = "export const label = `v${desktopVersion}`;\n") {
  await writeFile(resolve(root, "package.json"), `${JSON.stringify({ version })}\n`, "utf8");
  await writeFile(
    resolve(root, "src/website/release.ts"),
    "export const desktopVersion: string = packageJson.version;\n",
    "utf8",
  );
  await writeFile(resolve(root, "src/website/Homepage.tsx"), homepage, "utf8");
  await writeFile(
    resolve(root, "README.md"),
    "Requirements: Node.js 24 and pnpm 11.24.0\n",
    "utf8",
  );
}

async function commitAll(root, message) {
  await writeFile(resolve(root, ".commit-marker"), message, "utf8");
  const add = spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync("git", ["commit", "-m", message], { cwd: root, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr || commit.stdout);
}

function tag(root, name) {
  const result = spawnSync("git", ["tag", name], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("tag check reuses verify-release-version and generated notes", async () => {
  await withRepo(async ({ root, env, ghLog }) => {
    await writeTree(root, "0.0.1");
    await commitAll(root, "start (#1)");
    tag(root, "v0.0.1");
    await writeTree(root, "0.0.1");
    await commitAll(root, "direct push with no pull request");
    await writeTree(root, "0.0.2");
    await commitAll(root, "ship (#2)");
    tag(root, "v0.0.2");

    const pass = runReleaseCheck(root, {
      ...env,
      FAKE_NOTES: "https://github.com/openma-ai/backchat/pull/2\n",
      GITHUB_REF: "refs/tags/v0.0.2",
      GITHUB_REF_NAME: "v0.0.2",
    }, ["--tag"]);
    assert.equal(pass.code, 0, pass.stderr);
    assert.match(pass.stdout, /release tag v0\.0\.2 matches package version v0\.0\.2/);
    assert.match(pass.stdout, /generated release notes for v0\.0\.2 since v0\.0\.1 cover #2/);
    const calls = (await readFile(ghLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args.includes("create")), false);
    const generate = calls.find((args) => args.some((arg) => String(arg).includes("generate-notes")));
    assert.ok(generate, JSON.stringify(calls));
    assert.ok(generate.includes("tag_name=v0.0.2"));
    assert.ok(generate.includes("previous_tag_name=v0.0.1"));

    const omitted = runReleaseCheck(root, {
      ...env,
      FAKE_NOTES: "DeepSeek Harness 0.4.6\nhttps://github.com/openma-ai/backchat/pull/20\n#100\n",
      GITHUB_REF: "refs/tags/v0.0.2",
      GITHUB_REF_NAME: "v0.0.2",
    }, ["--tag"]);
    assert.equal(omitted.code, 1);
    assert.match(omitted.stderr, /generated release notes do not mention #2/);
    assert.doesNotMatch(omitted.stderr, /do not mention #1/);

    const mismatch = runReleaseCheck(root, {
      ...env,
      FAKE_NOTES: "https://github.com/openma-ai/backchat/pull/2\n",
      GITHUB_REF: "refs/tags/v0.0.9",
      GITHUB_REF_NAME: "v0.0.9",
    }, ["--tag"]);
    assert.equal(mismatch.code, 1);
    assert.match(
      mismatch.stderr,
      /release tag v0\.0\.9 does not match package version v0\.0\.2/,
    );
  });
});

test("pull requests notice unreleased work and reject unlabeled minor or major bumps", async () => {
  await withRepo(async ({ root, env }) => {
    await writeTree(root, "0.0.1");
    await commitAll(root, "start (#1)");
    tag(root, "v0.0.1");
    await commitAll(root, "fix the window drag (#7)");

    const open = runReleaseCheck(root, env, []);
    assert.equal(open.code, 0, open.stderr);
    assert.match(open.stdout, /::notice::Unreleased PR #7 on HEAD since v0\.0\.1: fix the window drag \(#7\)/);
    assert.match(open.stdout, /::notice::Version bump: 0\.0\.1 is unchanged/);
    assert.match(open.stdout, /README has no Backchat vX\.Y\.Z pin/);

    await commitAll(root, "direct follow-up");
    const direct = runReleaseCheck(root, env, []);
    assert.equal(direct.code, 0, direct.stderr);
    assert.match(direct.stdout, /::notice::Unreleased commit [0-9a-f]{7} on HEAD since v0\.0\.1 has no pull request number: direct follow-up/);

    spawnSync("git", ["checkout", "-b", "feature"], { cwd: root });
    await writeTree(root, "0.1.0");
    await commitAll(root, "minor bump");
    const minor = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    }, []);
    assert.equal(minor.code, 1);
    assert.match(minor.stderr, /version 0\.0\.1 -> 0\.1\.0 is a minor bump; add the release:minor label/);
    assert.match(minor.stdout, /::notice::Unreleased PR #7 on main since v0\.0\.1/);

    const labeled = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
      RELEASE_LABELS: "release:minor",
    }, []);
    assert.equal(labeled.code, 0, labeled.stderr);
    assert.match(labeled.stdout, /Version bump 0\.0\.1 -> 0\.1\.0 is a minor with release:minor/);

    await writeTree(root, "0.0.2");
    await commitAll(root, "patch bump");
    const patch = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    }, []);
    assert.equal(patch.code, 0, patch.stderr);
    assert.match(patch.stdout, /Version bump 0\.0\.1 -> 0\.0\.2 is a patch/);

    await writeTree(root, "1.0.0");
    await commitAll(root, "major bump");
    const major = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
      RELEASE_LABELS: "release:minor",
    }, []);
    assert.equal(major.code, 1);
    assert.match(major.stderr, /version 0\.0\.1 -> 1\.0\.0 is a major bump; add the release:major label/);

    const majorLabeled = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
      RELEASE_LABELS: " docs , release:major ",
    }, []);
    assert.equal(majorLabeled.code, 0, majorLabeled.stderr);

    await writeTree(root, "0.0.1", "export const label = `v0.0.9`;\n");
    await writeFile(
      resolve(root, "README.md"),
      "Install Backchat v0.0.9 today.\n",
      "utf8",
    );
    await commitAll(root, "wrong pins");
    const pins = runReleaseCheck(root, {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    }, []);
    assert.equal(pins.code, 1);
    assert.match(pins.stderr, /Homepage\.tsx hardcodes/);
    assert.match(pins.stderr, /README.md pins Backchat v0\.0\.9, expected v0\.0\.1/);
  });
});

test("annotations escape percent signs on GitHub Actions", async () => {
  await withRepo(async ({ root, env }) => {
    await writeTree(root, "0.0.1");
    await commitAll(root, "start (#1)");
    tag(root, "v0.0.1");
    await commitAll(root, "100% done (#8)");
    const result = runReleaseCheck(root, { ...env, GITHUB_ACTIONS: "true" }, []);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /100%25 done \(#8\)/);
  });
});
