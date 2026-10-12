/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { showRendererCrashFallback } from "./RendererCrashFallback";

(window as unknown as Record<string, unknown>).backchat = {
  onSettingsChanged: () => () => {},
  settingsGet: async () => null,
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showRendererCrashFallback", () => {
  it("mounts the crash page once into a dedicated host", async () => {
    await act(async () => {
      showRendererCrashFallback({
        errorId: "abc12345",
        message: "kaboom",
      });
    });

    const hosts = document.body.querySelectorAll(
      "[data-renderer-crash-fallback]",
    );
    expect(hosts).toHaveLength(1);
    const page = hosts[0].querySelector("[data-renderer-crash-page]");
    expect(page).not.toBeNull();
    expect(
      hosts[0].querySelector("[data-renderer-crash-error-id]")?.textContent,
    ).toContain("abc12345");

    // A second fatal error does not remount or duplicate the overlay.
    await act(async () => {
      showRendererCrashFallback({ errorId: "ffffffff", message: "again" });
    });
    expect(
      document.body.querySelectorAll("[data-renderer-crash-fallback]"),
    ).toHaveLength(1);
    expect(
      document.body.querySelector("[data-renderer-crash-error-id]")
        ?.textContent,
    ).toContain("abc12345");
  });
});
