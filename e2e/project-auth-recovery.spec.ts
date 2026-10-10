import { test, expect } from "./fixtures";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

type AuthEvent = { method: string; sessionId?: string; text?: string };

for (const recovery of ["Sign in", "Check sign-in"] as const) {
  test(`project coordinator recovers legacy Codex auth through ${recovery} without replaying its failed turn`, async ({ page, home }) => {
    const projectId = "auth-recovery-project";
    const authStatePath = join(home, "fake-auth-state");
    const agentExecutable = join(home, "fake-codex-acp");
    await writeFile(authStatePath, "configured");
    // Registry-managed command resolution intentionally omits adapter args.
    // Use an executable adapter, just like an installed codex-acp shim.
    await writeFile(agentExecutable, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(resolve("e2e/fixtures/fake-acp-agent.mjs")).href)});\n`, { mode: 0o755 });
    // Keep registry refresh offline while exercising real ACP auth probes.
    await writeFile(join(home, "registry-cache.json"), JSON.stringify({
      fetchedAt: Date.now(), data: { version: 1, agents: [] },
    }));
    await page.evaluate(async ({ agentExecutable, authStatePath, projectId }) => {
      await window.backchat.settingsPatch({
        agents: [{
          id: "codex-acp",
          enabled: true,
          command_override: agentExecutable,
          args_override: [],
          env: [
            { name: "BACKCHAT_FAKE_AUTH_STATE", value: authStatePath },
            { name: "BACKCHAT_FAKE_ADDITIONAL_DIRECTORIES", value: "1" },
          ],
        }],
      });
      await Promise.race([
        window.backchat.agentsList({ refresh: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture auth probe did not settle")), 15000)),
      ]);
      await window.backchat.projectSave({
        project_id: projectId,
        name: "Auth recovery project",
        source_folders: [],
      });
      await window.backchat.projectWorkSave({
        projectId,
        description: "",
        instructions: "",
        context: "",
        resources: [],
        coordinatorAgent: "codex-acp",
        workerAgent: "codex-acp",
        continuity: "per-scope",
        controls: ["delegate", "steer", "cancel", "complete"],
        execution: { kind: "local" },
      });
    }, {
      agentExecutable,
      authStatePath,
      projectId,
    });
    await page.reload();
    const coordinator = page.getByRole("link", { name: "Open project coordinator: Auth recovery project" });
    const expand = page.getByRole("button", { name: "Expand project: Auth recovery project" });
    await coordinator.or(expand).first().waitFor();
    if (await expand.isVisible()) await expand.click();
    await coordinator.click();
    const composer = page.getByLabel("Message coordinator", { exact: true });
    const send = page.getByRole("button", { name: "Send (Enter)", exact: true });
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    const checkSignIn = page.getByRole("button", { name: "Check sign-in", exact: true });
    const view = () => page.evaluate((id) => window.backchat.projectWorkView(id), projectId);
    const authEvents = async (): Promise<AuthEvent[]> =>
      (await readFile(`${authStatePath}.events.jsonl`, "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line));

    await composer.fill("Remember the original coordinator history.");
    await send.click();
    await expect.poll(async () => (await view()).facts.turns.map((turn) => turn.state)).toEqual(["completed"]);
    const original = await page.evaluate(async (id) => {
      const work = await window.backchat.projectWorkView(id);
      const coordinator = work.facts.sessions.find((session) => session.agentId === "coordinator")!;
      const persisted = (await window.backchat.sessionsList()).find((session) => session.id === coordinator.id)!;
      return { id: coordinator.id, acpId: persisted.acp_session_id };
    }, projectId);
    expect(original.acpId).toBeTruthy();

    // Exercise the real ACP transport: the fixture emits assistant text and
    // rejects the prompt as InternalError with structured unauthorized details.
    await composer.fill("expire-codex-auth-e2e");
    await send.click();
    await expect.poll(async () => (await view()).facts.turns.map((turn) => turn.state)).toEqual(["completed", "failed"]);
    await expect.poll(async () => (await view()).facts.agentEvents.some((event) =>
      event.type === "session.error" && (event.data as { code?: string }).code === "auth_required",
    )).toBe(true);
    if (recovery === "Check sign-in") {
      await page.reload();
      await page.getByRole("link", { name: "Open project coordinator: Auth recovery project", exact: true }).click();
    }
    const setupTitle = page.getByText("Set up Codex", { exact: true });
    if (await setupTitle.isVisible()) {
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(setupTitle).toBeHidden();
    }
    await expect(signIn).toBeVisible();
    await expect(checkSignIn).toBeVisible();
    const draft = "Continue after login, keeping the same coordinator.";
    await expect(composer).toBeDisabled();
    await expect(send).toBeDisabled();
    if (recovery === "Check sign-in") {
      await page.screenshot({ path: "artifacts/projects-work/auth-required.png", scale: "css" });
    }
    const eventsBeforeRecovery = await authEvents();
    const promptsBeforeRecovery = eventsBeforeRecovery.filter((event) => event.method === "session/prompt");
    expect(promptsBeforeRecovery).toHaveLength(2);

    if (recovery === "Sign in") {
      await signIn.click();
      await expect(page.getByText("Set up Codex", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else {
      // Check before credentials change must not claim recovery or replay work.
      await checkSignIn.click();
      await expect(checkSignIn).toBeEnabled();
      await expect(signIn).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(composer).toBeDisabled();
      // This marker is the fake agent's credential store in the isolated test
      // home, equivalent to completing its login externally.
      await writeFile(authStatePath, "recovered");
      await checkSignIn.click();
    }

    await expect(signIn).toBeHidden({ timeout: 15000 });
    await expect(checkSignIn).toBeHidden();
    await expect(composer).toBeEnabled();
    await composer.fill(draft);
    await expect(send).toBeEnabled();
    await expect.poll(async () => (await authEvents()).slice(eventsBeforeRecovery.length).some((event) =>
      ["session/resume", "session/load"].includes(event.method) && event.sessionId === original.acpId,
    )).toBe(true);
    // Recovery is a reconnect, not another prompt or a new durable session.
    expect((await authEvents()).filter((event) => event.method === "session/prompt")).toEqual(promptsBeforeRecovery);
    const recovered = await view();
    expect(recovered.facts.sessions.filter((session) => session.agentId === "coordinator").map((session) => session.id)).toEqual([original.id]);
    expect(recovered.facts.turns.map((turn) => turn.state)).toEqual(["completed", "failed"]);
    await expect(page.getByText("Remember the original coordinator history.", { exact: true })).toBeVisible();

    await send.click();
    await expect(composer).toHaveValue("");
    await expect.poll(async () => (await view()).facts.turns.map((turn) => turn.state)).toEqual(["completed", "failed", "completed"]);
    const prompts = (await authEvents()).filter((event) => event.method === "session/prompt");
    expect(prompts).toHaveLength(3);
    expect(prompts.map((event) => event.sessionId)).toEqual([original.acpId, original.acpId, original.acpId]);
    expect(prompts[2]!.text).toContain(draft);
    const finalSessions = await page.evaluate(() => window.backchat.sessionsList());
    expect(finalSessions.find((session) => session.id === original.id)?.acp_session_id).toBe(original.acpId);
    await page.reload();
    await page.getByRole("link", { name: "Open project coordinator: Auth recovery project", exact: true }).click();
    await expect(composer).toBeVisible();
    await expect(signIn).toBeHidden();
    await expect(checkSignIn).toBeHidden();
    await expect(page.getByText(draft, { exact: true })).toBeVisible();
    expect((await view()).facts.turns.map((turn) => turn.state)).toEqual(["completed", "failed", "completed"]);
  });
}
