import { describe, expect, it } from "vitest";
import { ExitCode } from "../shared/control-protocol";
import { ExitCode as CliExitCode } from "./exit-codes.mjs";
import { parseArgs, ParseError } from "./parse.mjs";
import { runCli } from "./backchat.mjs";
import { controlSocketPath } from "./client.mjs";
import { controlSocketPath as sharedSocketPath } from "../shared/control-socket";

describe("backchat CLI parsing", () => {
  it("keeps exit codes aligned with the control protocol", () => {
    expect(CliExitCode).toEqual(ExitCode);
  });

  it("resolves the same control socket as the app", () => {
    const env = {
      BACKCHAT_TEST_HOOKS: "1",
      BACKCHAT_HOME: "/tmp/backchat-cli-home",
    };
    expect(controlSocketPath(env, "linux")).toBe(sharedSocketPath(env, "linux"));
    expect(controlSocketPath({ BACKCHAT_CONTROL_SOCK: "/tmp/custom.sock" }, "linux"))
      .toBe("/tmp/custom.sock");
    const longHome = `/tmp/${"backchat-e2e-home-".repeat(8)}`;
    const envLong = { BACKCHAT_TEST_HOOKS: "1", BACKCHAT_HOME: longHome };
    const socket = controlSocketPath(envLong, "linux");
    expect(socket).toBe(sharedSocketPath(envLong, "linux"));
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(100);
    expect(socket.startsWith("/tmp/backchat-")).toBe(true);
  });

  it("parses project create with repeated sources and a client", () => {
    expect(parseArgs([
      "--json",
      "project",
      "create",
      "--name",
      "Hilo",
      "--source",
      "/tmp/a",
      "--source",
      "/tmp/b",
      "--client",
      "cursor killer",
    ])).toMatchObject({
      json: true,
      client: "cursor killer",
      group: "project",
      action: "create",
      flags: { name: "Hilo", source: ["/tmp/a", "/tmp/b"] },
    });
  });

  it("parses workspace create and remove", () => {
    expect(parseArgs([
      "workspace",
      "create",
      "--project",
      "project-1",
      "--branch",
      "feature/x",
      "--base",
      "main",
    ])).toMatchObject({
      group: "workspace",
      action: "create",
      flags: { project: "project-1", branch: "feature/x", base: "main" },
    });
    expect(parseArgs(["workspace", "remove", "ws-1", "--force"])).toMatchObject({
      action: "remove",
      args: ["ws-1"],
      flags: { force: true },
    });
  });

  it("parses coordinator create as idempotent display setup", () => {
    expect(parseArgs([
      "coordinator",
      "create",
      "--project",
      "project-1",
      "--name",
      "cursor killer",
    ])).toMatchObject({
      group: "coordinator",
      action: "create",
      flags: { project: "project-1", name: "cursor killer" },
    });
    expect(parseArgs([
      "coordinator",
      "remove",
      "--project",
      "project-1",
      "--name",
      "cursor killer",
      "--delete-threads",
    ]).flags["delete-threads"]).toBe(true);
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["project", "create", "--name"])).toThrow(ParseError);
  });

  it("prints help and a not-running error with a stable exit code", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    };
    expect(await runCli(["--help"], {}, io)).toBe(0);
    expect(out.join("\n")).toContain("backchat project create");

    const missing = "/tmp/backchat-missing-control.sock";
    const code = await runCli(["project", "list", "--json"], {
      BACKCHAT_CONTROL_SOCK: missing,
    }, io);
    expect(code).toBe(ExitCode.appNotRunning);
    expect(out.at(-1)).toContain("app_not_running");
    expect(out.at(-1)).toContain(missing);
  });
});
