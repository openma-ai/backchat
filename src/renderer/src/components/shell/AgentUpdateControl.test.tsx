import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import * as updateControl from "./AgentUpdateControl";

describe("AgentUpdateControl", () => {
  it("shows an unknown-length update as accessible progress instead of a disabled button", () => {
    const UpdateAction = (
      updateControl as unknown as {
        AgentUpdateAction?: ComponentType<{
          actionLabel: string;
          error?: string;
          retryLabel: string;
          updateLabel: string;
          updating: boolean;
          updatingLabel: string;
          onUpgrade: () => void;
        }>;
      }
    ).AgentUpdateAction;

    expect(UpdateAction).toBeTypeOf("function");
    if (!UpdateAction) return;

    const html = renderToStaticMarkup(createElement(UpdateAction, {
      actionLabel: "Updating Codex",
      retryLabel: "Retry",
      updateLabel: "Update",
      updating: true,
      updatingLabel: "Updating",
      onUpgrade: () => undefined,
    }));

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Updating Codex"');
    expect(html).toContain('aria-valuetext="Updating"');
    expect(html).toContain('data-agent-update-progress="indeterminate"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("[ ... ]");
  });

  it("summarizes a disk-space failure and keeps the raw command in collapsed details", () => {
    const UpdateError = (
      updateControl as unknown as {
        AgentUpdateError?: ComponentType<{
          detailsLabel: string;
          diskSpaceMessage: string;
          error: string;
          fallbackMessage: string;
        }>;
      }
    ).AgentUpdateError;

    expect(UpdateError).toBeTypeOf("function");
    if (!UpdateError) return;

    const rawError = "npm ERR! code ENOSPC\nnpm install --prefix /Users/test/.oma/acp/registry";
    const html = renderToStaticMarkup(createElement(UpdateError, {
      detailsLabel: "Error details",
      diskSpaceMessage: "Not enough disk space. Free up space, then retry.",
      error: rawError,
      fallbackMessage: "Update failed. Please try again.",
    }));

    expect(html).toContain("Not enough disk space. Free up space, then retry.");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Error details");
    expect(html.indexOf("npm ERR! code ENOSPC")).toBeGreaterThan(
      html.indexOf("<details"),
    );
  });
});
