#!/usr/bin/env node
/**
 * Release check for Backchat. This does not create a release or move a tag.
 *
 * Default (pull request, or push to main): print a non-blocking ::notice:: for
 * each pull request already merged to the base since the previous v* tag, and
 * for whether package.json's version bump is a patch. A minor bump fails
 * unless the PR has release:minor. A major bump fails unless it has
 * release:major. Those labels are not created here.
 *
 * --tag (push of a v* tag): package.json must match the tag
 * (scripts/verify-release-version.mjs), the website version must come from
 * that package.json, and GitHub's generated release notes must mention every
 * pull request in the first-parent range since the previous v* tag. The notes
 * come from the generate-notes API, the same text `gh release create
 * --generate-notes` publishes. The API call does not create the release.
 * Build macOS DMG is a separate workflow and is not blocked.
 *
 * --audit: replay published GitHub release bodies for every local vX.Y.Z tag.
 * Not used by CI. v0.0.3's hand-written notes omit pull requests, so a full
 * audit exits 1.
 *
 * Pull requests are read from first-parent subjects only: `(#N)` or
 * `Merge pull request #N`. Commits with neither are not pull requests.
 * Notes count when they contain `#N` or `/pull/N` with the number bounded
 * so `#10` does not match `#100`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const versionVerifier = join(scriptDir, "verify-release-version.mjs");

export function parseVersion(version) {
  const match = VERSION_RE.exec(version);
  if (!match) {
    throw new Error(`Version must be x.y.z, got ${JSON.stringify(version)}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: version,
  };
}

export function classifyBump(previous, next) {
  let from;
  let to;
  try {
    from = parseVersion(previous);
    to = parseVersion(next);
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (to.major !== from.major) return { kind: to.major > from.major ? "major" : "downgrade" };
  if (to.minor !== from.minor) return { kind: to.minor > from.minor ? "minor" : "downgrade" };
  if (to.patch !== from.patch) return { kind: to.patch > from.patch ? "patch" : "downgrade" };
  return { kind: "same" };
}

/** Pull request numbers from one first-parent subject, in order. */
export function extractPrNumbers(subject) {
  const numbers = [];
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge) numbers.push(Number(merge[1]));
  for (const match of subject.matchAll(/\(#(\d+)\)/g)) {
    numbers.push(Number(match[1]));
  }
  return numbers;
}

export function uniquePrNumbers(commits) {
  const seen = new Set();
  const numbers = [];
  for (const commit of commits) {
    for (const number of extractPrNumbers(commit.subject)) {
      if (seen.has(number)) continue;
      seen.add(number);
      numbers.push(number);
    }
  }
  return numbers;
}

export function mentionsPullRequest(notes, number) {
  const hash = new RegExp(`(^|[^0-9])#${number}(?![0-9])`);
  const pull = new RegExp(`/pull/${number}(?![0-9])`);
  return hash.test(notes) || pull.test(notes);
}

export function missingPullRequests(notes, numbers) {
  return numbers.filter((number) => !mentionsPullRequest(notes ?? "", number));
}

export function coverageErrors(notes, commits) {
  return missingPullRequests(notes, uniquePrNumbers(commits)).map(
    (number) => `generated release notes do not mention #${number}`,
  );
}

/**
 * @param {"major" | "minor" | "patch" | "downgrade" | "same" | "invalid"} kind
 * @param {readonly string[]} labels
 */
export function bumpLabelErrors(kind, labels, previous, next) {
  const present = new Set(labels);
  if (kind === "patch" || kind === "same") return [];
  if (kind === "minor") {
    if (present.has("release:minor")) return [];
    return [
      `version ${previous} -> ${next} is a minor bump; add the release:minor label or keep the bump to a patch`,
    ];
  }
  if (kind === "major") {
    if (present.has("release:major")) return [];
    return [
      `version ${previous} -> ${next} is a major bump; add the release:major label or keep the bump to a patch`,
    ];
  }
  if (kind === "downgrade") {
    return [`version ${previous} -> ${next} does not increase the version`];
  }
  return [`Cannot classify bump ${previous} -> ${next}; versions must be major.minor.patch`];
}

/** README pins only `Backchat … vX.Y.Z`. pnpm's 11.24.0 is not a product pin. */
export function readmeVersionErrors(readme, version) {
  if (readme == null) return [];
  const errors = [];
  const pins = readme.matchAll(/\bBackchat\b[^\n]{0,80}?\bv(\d+\.\d+\.\d+)\b/g);
  for (const pin of pins) {
    if (pin[1] !== version) {
      errors.push(`README.md pins Backchat v${pin[1]}, expected v${version}`);
    }
  }
  return errors;
}

export function websiteVersionErrors(releaseSource, version, homepageSource = null) {
  const errors = [];
  if (releaseSource == null) {
    errors.push("src/website/release.ts does not exist");
  } else {
    const assignment = releaseSource.match(
      /export const desktopVersion\s*(?::\s*string\s*)?=\s*([^;\n]+);/,
    );
    const expression = assignment?.[1]?.trim();
    const literal = expression?.match(/^["'](\d+\.\d+\.\d+)["']$/);
    if (expression === "packageJson.version" || literal?.[1] === version) {
      // The site reads package.json, or it repeats the same version.
    } else if (!expression) {
      errors.push("src/website/release.ts does not export desktopVersion");
    } else {
      errors.push(
        `src/website/release.ts desktopVersion is ${expression}, expected packageJson.version (${version})`,
      );
    }
  }
  if (homepageSource != null) {
    if (/v\d+\.\d+\.\d+/.test(homepageSource)) {
      errors.push(
        "src/website/Homepage.tsx hardcodes a vX.Y.Z version; use desktopVersion from release.ts",
      );
    }
    if (!homepageSource.includes("desktopVersion")) {
      errors.push("src/website/Homepage.tsx does not use desktopVersion");
    }
  }
  return errors;
}

export function unreleasedNotices({ previousTag, revision, commits }) {
  if (!previousTag) {
    return [
      `No previous v* tag is reachable from ${revision}; unreleased pull requests were not listed.`,
    ];
  }
  const notices = [];
  const seen = new Set();
  for (const commit of commits) {
    const numbers = extractPrNumbers(commit.subject);
    if (numbers.length === 0) {
      notices.push(
        `Unreleased commit ${commit.sha.slice(0, 7)} on ${revision} since ${previousTag} has no pull request number: ${commit.subject}`,
      );
      continue;
    }
    for (const number of numbers) {
      if (seen.has(number)) continue;
      seen.add(number);
      notices.push(
        `Unreleased PR #${number} on ${revision} since ${previousTag}: ${commit.subject}`,
      );
    }
  }
  return notices;
}

export function compareBase(notes, tag) {
  const match = /compare\/([^\s/]+?)\.{2,3}v\d+\.\d+\.\d+/.exec(notes ?? "");
  if (!match || match[1] === tag) return null;
  return match[1];
}

export function formatAuditLine({ tag, previous, numbers, missing, ignored, versionError }) {
  const listed = numbers.length > 0 ? numbers.map((number) => `#${number}`).join(" ") : "none";
  const coverage = missing.length > 0
    ? `notes missing ${missing.map((number) => `#${number}`).join(" ")}`
    : "notes cover them";
  const shas = ignored.map((commit) => commit.sha.slice(0, 7)).filter(Boolean);
  const ignoredText = ignored.length === 0
    ? ""
    : `; ignored ${ignored.length} commit${ignored.length === 1 ? "" : "s"} with no pull request${shas.length > 0 ? `: ${shas.join(", ")}` : ""}`;
  const versionText = versionError ? `; ${versionError}` : "";
  return `${tag} since ${previous}: pull requests ${listed}; ${coverage}${ignoredText}${versionText}`;
}

function createReport(env) {
  const stdout = [];
  const errors = [];
  return {
    log(message) {
      stdout.push(message);
    },
    notice(message) {
      stdout.push(`::notice::${escapeAnnotation(env, message)}`);
    },
    error(message) {
      errors.push(message);
      stdout.push(`::error::${escapeAnnotation(env, message)}`);
    },
    get errors() {
      return errors;
    },
    done() {
      const stderr = errors.length === 0
        ? ""
        : `release check failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`;
      return {
        code: errors.length === 0 ? 0 : 1,
        stdout: stdout.length > 0 ? `${stdout.join("\n")}\n` : "",
        stderr,
      };
    },
  };
}

function escapeAnnotation(env, message) {
  if (env.GITHUB_ACTIONS !== "true") return message;
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return (result.stdout ?? "").replace(/\n$/, "");
}

function gitOk(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  return (result.stdout ?? "").replace(/\n$/, "");
}

function readOptional(cwd, relativePath) {
  try {
    return readFileSync(join(cwd, relativePath), "utf8");
  } catch {
    return null;
  }
}

function headVersion(cwd) {
  const parsed = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json version must be a non-empty string");
  }
  return parsed.version;
}

function versionAt(cwd, rev) {
  const parsed = JSON.parse(git(cwd, ["show", `${rev}:package.json`]));
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${rev}:package.json version must be a non-empty string`);
  }
  return parsed.version;
}

function versionTag(name) {
  return VERSION_TAG.test(name ?? "") ? name : null;
}

function latestVersionTag(cwd, rev) {
  return versionTag(gitOk(cwd, ["describe", "--tags", "--abbrev=0", "--match", "v*", rev]));
}

function previousVersionTag(cwd, rev) {
  const parent = gitOk(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^`]);
  if (!parent) return null;
  return versionTag(gitOk(cwd, ["describe", "--tags", "--abbrev=0", "--match", "v*", parent]));
}

function commitsSince(cwd, from, to) {
  const range = from ? `${from}..${to}` : to;
  const raw = git(cwd, ["log", "--first-parent", "--reverse", "--format=%H%x09%s", range]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    if (tab === -1) return { sha: line, subject: "" };
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}

function releaseLabels(env) {
  return (env.RELEASE_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function resolveRevision(cwd, env) {
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_BASE_REF) {
    const name = env.GITHUB_BASE_REF || env.BASE_REF || "main";
    for (const ref of [`origin/${name}`, name]) {
      if (gitOk(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) {
        return { name, ref };
      }
    }
    throw new Error(`Cannot resolve base ref ${name}`);
  }
  const name = env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF_NAME
    ? env.GITHUB_REF_NAME
    : "HEAD";
  if (!gitOk(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])) {
    throw new Error("Cannot resolve HEAD");
  }
  return { name, ref: "HEAD" };
}

function currentTag(cwd, env) {
  const ref = env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  if (versionTag(env.GITHUB_REF_NAME)) return env.GITHUB_REF_NAME;
  return versionTag(gitOk(cwd, ["describe", "--tags", "--exact-match", "HEAD"]));
}

function repositoryName(cwd, env) {
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY.includes("/")) return env.GITHUB_REPOSITORY;
  const result = spawnSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd, env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`Cannot resolve GitHub repository: ${detail}`);
  }
  return (result.stdout ?? "").trim();
}

function generatedNotes(cwd, env, { repository, tag, previousTag, commit }) {
  const result = spawnSync(
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${repository}/releases/generate-notes`,
      "-f",
      `tag_name=${tag}`,
      "-f",
      `previous_tag_name=${previousTag}`,
      "-f",
      `target_commitish=${commit}`,
    ],
    { cwd, env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`gh generate-notes failed: ${detail}`);
  }
  const parsed = JSON.parse(result.stdout || "{}");
  if (typeof parsed.body !== "string") {
    throw new Error("gh generate-notes returned no body");
  }
  return parsed.body;
}

function publishedNotes(cwd, env, tag) {
  const result = spawnSync(
    "gh",
    ["release", "view", tag, "--json", "body", "--jq", ".body"],
    { cwd, env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`gh release view ${tag} failed: ${detail}`);
  }
  return result.stdout ?? "";
}

function runVersionVerifier(cwd, env, tag) {
  const result = spawnSync(process.execPath, [versionVerifier, join(cwd, "package.json")], {
    cwd,
    env: { ...env, GITHUB_REF_NAME: tag },
    encoding: "utf8",
  });
  if (result.status === 0) return { message: (result.stdout ?? "").trim() };
  const detail = (result.stderr || result.stdout || result.error?.message || "verify-release-version failed").trim();
  return { error: detail };
}

function checkVersionPins(cwd, report) {
  const version = headVersion(cwd);
  const errors = [
    ...websiteVersionErrors(
      readOptional(cwd, "src/website/release.ts"),
      version,
      readOptional(cwd, "src/website/Homepage.tsx"),
    ),
    ...readmeVersionErrors(readOptional(cwd, "README.md"), version),
  ];
  for (const error of errors) report.error(error);
  if (errors.length === 0) {
    report.log(`package.json ${version} matches the website version source; README has no Backchat vX.Y.Z pin.`);
  }
}

function checkDefault(cwd, env, report) {
  const revision = resolveRevision(cwd, env);
  const previousTag = latestVersionTag(cwd, revision.ref);
  const commits = previousTag ? commitsSince(cwd, previousTag, revision.ref) : [];
  const notices = unreleasedNotices({ previousTag, revision: revision.name, commits });
  if (notices.length === 0 && previousTag) {
    report.log(`No unreleased pull requests on ${revision.name} since ${previousTag}.`);
  }
  for (const notice of notices) report.notice(notice);

  const previousVersion = versionAt(cwd, revision.ref);
  const nextVersion = headVersion(cwd);
  if (previousVersion === nextVersion) {
    report.notice(
      `Version bump: ${nextVersion} is unchanged; minor and major bumps need release:minor or release:major.`,
    );
  } else {
    const bump = classifyBump(previousVersion, nextVersion);
    const labels = releaseLabels(env);
    const problems = bump.kind === "invalid"
      ? [bump.reason]
      : bumpLabelErrors(bump.kind, labels, previousVersion, nextVersion);
    if (problems.length === 0) {
      const label = bump.kind === "minor" || bump.kind === "major" ? ` with release:${bump.kind}` : "";
      report.notice(`Version bump ${previousVersion} -> ${nextVersion} is a ${bump.kind}${label}.`);
    }
    for (const problem of problems) report.error(problem);
  }
  checkVersionPins(cwd, report);
}

function checkTag(cwd, env, report) {
  const tag = currentTag(cwd, env);
  if (!tag) {
    report.error("release tag is missing");
    return;
  }
  const verified = runVersionVerifier(cwd, env, tag);
  if (verified.error) report.error(verified.error);
  else if (verified.message) report.log(verified.message);
  checkVersionPins(cwd, report);

  const commit = gitOk(cwd, ["rev-parse", "--verify", "--quiet", `${tag}^{commit}`]);
  if (!commit) {
    report.error(`tag ${tag} does not resolve to a commit`);
    return;
  }
  const previous = previousVersionTag(cwd, commit);
  if (!previous) {
    report.error(`no previous v* tag is reachable from ${tag}`);
    return;
  }
  const commits = commitsSince(cwd, previous, commit);
  const notes = generatedNotes(cwd, env, {
    repository: repositoryName(cwd, env),
    tag,
    previousTag: previous,
    commit,
  });
  const errors = coverageErrors(notes, commits);
  for (const error of errors) report.error(error);
  if (errors.length === 0) {
    const numbers = uniquePrNumbers(commits);
    const listed = numbers.length > 0 ? numbers.map((number) => `#${number}`).join(" ") : "none";
    report.log(`generated release notes for ${tag} since ${previous} cover ${listed}.`);
  }
}

function audit(cwd, env, report) {
  const tags = git(cwd, ["tag", "-l", "v*", "--sort=v:refname"])
    .split("\n")
    .filter((tag) => VERSION_TAG.test(tag));
  if (tags.length === 0) throw new Error("No vX.Y.Z tags to audit");
  let passed = 0;
  for (const tag of tags) {
    const commit = git(cwd, ["rev-parse", "--verify", `${tag}^{commit}`]);
    let previous = previousVersionTag(cwd, commit);
    let notes = null;
    if (!previous) {
      notes = publishedNotes(cwd, env, tag);
      previous = compareBase(notes, tag);
      if (!previous) {
        report.error(`${tag}: no previous v* tag and the release notes do not name a compare base`);
        continue;
      }
      if (!gitOk(cwd, ["rev-parse", "--verify", "--quiet", `${previous}^{commit}`])) {
        report.error(`${tag}: compare base ${previous} does not resolve`);
        continue;
      }
    }
    if (notes == null) notes = publishedNotes(cwd, env, tag);
    const commits = commitsSince(cwd, previous, commit);
    const numbers = uniquePrNumbers(commits);
    const missing = missingPullRequests(notes, numbers);
    const ignored = commits.filter((entry) => extractPrNumbers(entry.subject).length === 0);
    let versionError = "";
    const packageVersion = versionAt(cwd, `${tag}^{commit}`);
    if (packageVersion !== tag.slice(1)) {
      versionError = `${tag} package.json version is ${packageVersion}, expected ${tag.slice(1)}`;
      report.error(versionError);
    }
    for (const number of missing) report.error(`${tag} notes do not mention #${number}`);
    report.log(formatAuditLine({
      tag,
      previous,
      numbers,
      missing,
      ignored,
      versionError,
    }));
    if (missing.length === 0 && !versionError) passed += 1;
  }
  const failed = tags.length - passed;
  const passedLabel = `${passed} ${passed === 1 ? "tag covers" : "tags cover"} every merged pull request.`;
  const failedLabel = failed === 1
    ? "1 tag omitted pull requests or disagrees with package.json."
    : `${failed} tags omitted pull requests or disagree with package.json.`;
  report.log(`${passedLabel} ${failedLabel}`);
}

export function runReleaseCheck(cwd, env, argv) {
  const report = createReport(env);
  try {
    const unknown = argv.filter((arg) => arg !== "--tag" && arg !== "--audit");
    if (unknown.length > 0) {
      report.error(`Unknown arguments: ${unknown.join(" ")}`);
      return report.done();
    }
    if (argv.includes("--tag") && argv.includes("--audit")) {
      report.error("Use either --tag or --audit");
      return report.done();
    }
    if (argv.includes("--audit")) audit(cwd, env, report);
    else if (argv.includes("--tag")) checkTag(cwd, env, report);
    else checkDefault(cwd, env, report);
  } catch (error) {
    report.error(error instanceof Error ? error.message : String(error));
  }
  return report.done();
}

const invokedDirectly = typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const result = runReleaseCheck(process.cwd(), process.env, process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
