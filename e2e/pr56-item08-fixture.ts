import { execFile as execFileCallback } from "node:child_process";
import { mkdir as fsMkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

const execFile = promisify(execFileCallback);

export const ITEM08_MODEL_SESSION_ID = "item08-evidence-model";

/** Identical project/workspace seed for main and PR item-08 evidence. */
export async function seedItem08ProjectFixture(page: Page, home: string) {
  const alphaDir = join(home, "picker-grid-alpha");
  const betaDir = join(home, "picker-grid-beta");
  await fsMkdir(alphaDir, { recursive: true });
  await fsMkdir(betaDir, { recursive: true });
  await page.evaluate(async ({ alphaDir, betaDir }) => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    const pinProjectIcon = (projectId: string, glyph: string, color: string) => {
      localStorage.setItem(
        `backchat.project-icon.v1:project:${projectId}`,
        JSON.stringify({ kind: "icon", glyph, color }),
      );
    };
    pinProjectIcon("picker-grid-a", "chat", "#7c3aed");
    pinProjectIcon("picker-grid-b", "cloud", "#2563eb");
    await window.backchat.projectSave({
      project_id: "picker-grid-a",
      name: "Alpha workspace",
      source_folders: [alphaDir],
      primary_folder: alphaDir,
    });
    await new Promise((r) => setTimeout(r, 40));
    const beta = {
      project_id: "picker-grid-b",
      name: "Beta monorepo",
      source_folders: [betaDir],
      primary_folder: betaDir,
    };
    await window.backchat.projectSave(beta);
    await new Promise((r) => setTimeout(r, 40));
    await window.backchat.projectSave(beta);
  }, { alphaDir, betaDir });
  await page.reload();
}

export async function seedItem08WorkspaceFixture(page: Page, home: string) {
  const repo = join(home, "workspace-fit-repo");
  await fsMkdir(repo, { recursive: true });
  await execFile("git", ["init", "--initial-branch=main", repo]);
  await execFile("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  await page.evaluate(async (path) => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    localStorage.setItem(
      "backchat.project-icon.v1:project:workspace-fit-project",
      JSON.stringify({ kind: "icon", glyph: "cloud", color: "#2563eb" }),
    );
    await window.backchat.projectSave({
      project_id: "workspace-fit-project",
      name: "Workspace fit",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();
  return repo;
}
