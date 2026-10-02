#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { exitCodeFor, ExitCode } from "./exit-codes.mjs";
import { parseArgs, ParseError } from "./parse.mjs";
import { callControl, controlSocketPath } from "./client.mjs";

const HELP = `backchat — local control CLI for a running Backchat app

Usage:
  backchat project list [--json]
  backchat project show <id> [--json]
  backchat project create --name <name> --source <dir> [--source <dir> ...] [--json]
  backchat workspace list [--project <id>] [--json]
  backchat workspace show <id> [--json]
  backchat workspace create --project <id> --branch <name> [--base <ref>] [--json]
  backchat workspace remove <id> [--force] [--json]

Global:
  --json              machine-readable stdout
  --client <name>     caller identity (or BACKCHAT_CLIENT)
  --help

Exit codes:
  0 ok
  1 generic error
  2 Backchat is not running
  3 not found
  4 timeout
  5 invalid arguments
`;

export async function runCli(argv, env = process.env, io = { stdout: console.log, stderr: console.error }) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return ExitCode.invalidArgs;
  }
  if (parsed.help || argv.length === 0) {
    io.stdout(HELP.trimEnd());
    return parsed.help || argv.length === 0 ? ExitCode.ok : ExitCode.invalidArgs;
  }
  const client = parsed.client || env.BACKCHAT_CLIENT || undefined;
  let call;
  try {
    call = commandCall(parsed);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return ExitCode.invalidArgs;
  }
  try {
    const result = await callControl({
      socketPath: controlSocketPath(env),
      method: call.method,
      params: call.params,
      client,
    });
    io.stdout(parsed.json ? JSON.stringify(result, null, 2) : formatText(call.method, result));
    return ExitCode.ok;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "error";
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) {
      io.stdout(JSON.stringify({
        ok: false,
        error: { code, message },
        ...(error && typeof error === "object" && "result" in error && error.result !== undefined
          ? { result: error.result }
          : {}),
      }, null, 2));
    } else {
      io.stderr(message);
    }
    return exitCodeFor(code);
  }
}

function commandCall(parsed) {
  const { group, action, args, flags } = parsed;
  if (group === "project" && action === "list") return { method: "project.list", params: {} };
  if (group === "project" && action === "show") {
    return { method: "project.show", params: { id: requiredArg(args[0], "project id") } };
  }
  if (group === "project" && action === "create") {
    const sources = Array.isArray(flags.source) ? flags.source : [];
    if (!flags.name || typeof flags.name !== "string") throw new ParseError("--name is required");
    if (sources.length === 0) throw new ParseError("At least one --source directory is required");
    return { method: "project.create", params: { name: flags.name, sources } };
  }
  if (group === "workspace" && action === "list") {
    return {
      method: "workspace.list",
      params: typeof flags.project === "string" ? { project_id: flags.project } : {},
    };
  }
  if (group === "workspace" && action === "show") {
    return { method: "workspace.show", params: { id: requiredArg(args[0], "workspace id") } };
  }
  if (group === "workspace" && action === "create") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    if (typeof flags.branch !== "string") throw new ParseError("--branch is required");
    return {
      method: "workspace.create",
      params: {
        project_id: flags.project,
        branch: flags.branch,
        ...(typeof flags.base === "string" ? { base: flags.base } : {}),
      },
    };
  }
  if (group === "workspace" && (action === "remove" || action === "delete")) {
    return {
      method: "workspace.remove",
      params: { id: requiredArg(args[0], "workspace id"), force: flags.force === true },
    };
  }
  throw new ParseError(`Unknown command: ${[group, action].filter(Boolean).join(" ") || "(none)"}`);
}

function requiredArg(value, label) {
  if (!value) throw new ParseError(`${label} is required`);
  return value;
}

function formatText(method, result) {
  if (method === "project.list" && Array.isArray(result)) {
    if (result.length === 0) return "No projects.";
    return result.map((project) => `${project.id}\t${project.name}\t${project.primary_folder}`).join("\n");
  }
  if (method === "project.show" || method === "project.create") {
    const sources = Array.isArray(result.source_folders) ? result.source_folders.join(", ") : "";
    return `${result.id}\t${result.name}\n${sources}`;
  }
  if (method === "workspace.list" && Array.isArray(result)) {
    if (result.length === 0) return "No workspaces.";
    return result.map((workspace) => `${workspace.id}\t${workspace.kind}\t${workspace.branch ?? ""}\t${workspace.name}`).join("\n");
  }
  if (method === "workspace.show" || method === "workspace.create") {
    const repos = Array.isArray(result.repos) ? result.repos : result.worktrees ?? [];
    const lines = [`${result.id}\t${result.kind ?? "managed"}\t${result.branch ?? ""}`];
    for (const repo of repos) {
      lines.push(`${repo.path ?? repo.repo_root}\t${repo.branch ?? ""}\t${repo.head ?? ""}\tdirty=${repo.dirty ? "yes" : "no"}`);
    }
    return lines.join("\n");
  }
  if (method === "workspace.remove") return `removed ${result.id}`;
  return JSON.stringify(result, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
