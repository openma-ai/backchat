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
  backchat session list [--workspace <id>] [--project <id>] [--json]
  backchat session start --workspace <id> --agent <id> [--root <dir>] [--dir <dir>] [--prompt <text>] [--approve ask|auto-read|auto-all] [--json]
  backchat session send <id> <message> [--wait] [--stream] [--timeout <sec>] [--json]
  backchat session status <id> [--json]
  backchat session transcript <id> [--since <cursor>] [--json]
  backchat session cancel <id> [--json]
  backchat session pending <id> [--json]
  backchat session respond <id> <requestId> <option> [--json]
  backchat coordinator create --project <id> --name <name> [--json]
  backchat coordinator list [--project <id>] [--json]
  backchat coordinator remove --project <id> --name <name> [--delete-threads] [--json]
  backchat work submit --project <id> --text <text> [--type message|delegate|steer|cancel] [--worker <id>] [--json]
  backchat work status [<projectId>] [--json]
  backchat work view --project <id> [--json]
  backchat work goal --project <id> --thread <id> [--status active|paused] [--objective <text>] [--clear] [--json]

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
    const lines = [];
    const result = await callControl({
      socketPath: controlSocketPath(env),
      method: call.method,
      params: call.params,
      client,
      onEvent: (event) => lines.push(JSON.stringify(event)),
    });
    if (call.params?.stream) {
      io.stdout(lines.join("\n"));
    } else {
      io.stdout(parsed.json ? JSON.stringify(result, null, 2) : formatText(call.method, result));
    }
    return ExitCode.ok;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "error";
    const message = error instanceof Error ? error.message : String(error);
    const failure = error && typeof error === "object" && "result" in error ? error.result : undefined;
    if (parsed.json || failure !== undefined) {
      io.stdout(JSON.stringify({
        ok: false,
        error: { code, message },
        ...(failure !== undefined ? { result: failure } : {}),
      }, null, 2));
    }
    if (!parsed.json) io.stderr(message);
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
  if (group === "session" && action === "list") {
    return {
      method: "session.list",
      params: {
        ...(typeof flags.workspace === "string" ? { workspace_id: flags.workspace } : {}),
        ...(typeof flags.project === "string" ? { project_id: flags.project } : {}),
      },
    };
  }
  if (group === "session" && action === "start") {
    if (typeof flags.agent !== "string") throw new ParseError("--agent is required");
    return {
      method: "session.start",
      params: {
        agent_id: flags.agent,
        ...(typeof flags.workspace === "string" ? { workspace_id: flags.workspace } : {}),
        ...(typeof flags.root === "string" ? { root: flags.root } : {}),
        ...(Array.isArray(flags.dir) ? { directories: flags.dir } : {}),
        ...(typeof flags.prompt === "string" ? { prompt: flags.prompt } : {}),
        ...(typeof flags.approve === "string" ? { approve: flags.approve } : {}),
        ...(typeof flags.project === "string" ? { project_id: flags.project } : {}),
      },
    };
  }
  if (group === "session" && action === "send") {
    return {
      method: "session.send",
      params: {
        id: requiredArg(args[0], "session id"),
        message: requiredArg(args.slice(1).join(" "), "message"),
        wait: flags.wait === true,
        stream: flags.stream === true,
        ...(typeof flags.timeout === "string" ? { timeout: flags.timeout } : {}),
      },
    };
  }
  if (group === "session" && action === "status") {
    return { method: "session.status", params: { id: requiredArg(args[0], "session id") } };
  }
  if (group === "session" && action === "transcript") {
    return {
      method: "session.transcript",
      params: {
        id: requiredArg(args[0], "session id"),
        ...(typeof flags.since === "string" ? { since: flags.since } : {}),
      },
    };
  }
  if (group === "session" && action === "cancel") {
    return { method: "session.cancel", params: { id: requiredArg(args[0], "session id") } };
  }
  if (group === "session" && action === "pending") {
    return { method: "session.pending", params: { id: requiredArg(args[0], "session id") } };
  }
  if (group === "session" && action === "respond") {
    return {
      method: "session.respond",
      params: {
        id: requiredArg(args[0], "session id"),
        request_id: requiredArg(args[1], "request id"),
        option: requiredArg(args[2], "option"),
      },
    };
  }
  if (group === "coordinator" && action === "create") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    if (typeof flags.name !== "string") throw new ParseError("--name is required");
    return { method: "coordinator.create", params: { project_id: flags.project, name: flags.name } };
  }
  if (group === "coordinator" && action === "list") {
    return {
      method: "coordinator.list",
      params: typeof flags.project === "string" ? { project_id: flags.project } : {},
    };
  }
  if (group === "coordinator" && action === "remove") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    if (typeof flags.name !== "string") throw new ParseError("--name is required");
    return {
      method: "coordinator.remove",
      params: {
        project_id: flags.project,
        name: flags.name,
        delete_threads: flags["delete-threads"] === true,
      },
    };
  }
  if (group === "work" && action === "submit") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    if (typeof flags.text !== "string") throw new ParseError("--text is required");
    return {
      method: "work.submit",
      params: {
        project_id: flags.project,
        text: flags.text,
        ...(typeof flags.type === "string" ? { type: flags.type } : {}),
        ...(typeof flags.worker === "string" ? { worker_id: flags.worker } : {}),
        ...(typeof flags.run === "string" ? { run_id: flags.run } : {}),
      },
    };
  }
  if (group === "work" && action === "status") {
    return { method: "work.status", params: args[0] ? { id: args[0] } : {} };
  }
  if (group === "work" && action === "view") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    return { method: "work.view", params: { project_id: flags.project } };
  }
  if (group === "work" && action === "goal") {
    if (typeof flags.project !== "string") throw new ParseError("--project is required");
    if (typeof flags.thread !== "string") throw new ParseError("--thread is required");
    return {
      method: "work.goal",
      params: {
        project_id: flags.project,
        thread_id: flags.thread,
        ...(typeof flags.status === "string" ? { status: flags.status } : {}),
        ...(typeof flags.objective === "string" ? { objective: flags.objective } : {}),
        ...(flags.clear === true ? { clear: true } : {}),
      },
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
  if (method === "coordinator.create") {
    return `${result.id}\t${result.name}\t${result.created ? "created" : "exists"}`;
  }
  if (method === "coordinator.list" && Array.isArray(result)) {
    if (result.length === 0) return "No external coordinators.";
    return result.map((coordinator) => `${coordinator.id}\t${coordinator.project_id}\t${coordinator.name}`).join("\n");
  }
  if (method === "coordinator.remove") {
    return `removed ${result.name}${result.sessions_deleted?.length ? `, deleted ${result.sessions_deleted.length} threads` : ""}`;
  }
  if (method === "work.submit" && result?.routed === "external") {
    return `${result.task?.id ?? result.command_id}\t${result.external_coordinator}\t${result.task?.text ?? ""}`;
  }
  return JSON.stringify(result, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
