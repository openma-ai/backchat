import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const warning = "Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill.";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("groups only the skill-description warning, leaving unrelated warnings alone", async () => {
  const { noticePreferenceKey } = await import("./notice-preferences");
  expect(noticePreferenceKey(warning)).toBe(noticePreferenceKey("Skill descriptions were shortened to fit the skills context budget. Different details."));
  expect(noticePreferenceKey("Warning: Skill failed to load.")).not.toBe(noticePreferenceKey(warning));
});
it("remembers the choice across reloads while keeping different notices visible", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.resetModules();
  const first = await import("./notice-preferences");
  first.hideNoticePermanently(warning);
  vi.resetModules();
  const reloaded = await import("./notice-preferences");
  function Probe({ message }: { message: string }) { return createElement("span", null, String(reloaded.useNoticeHidden(message))); }
  expect(renderToStaticMarkup(createElement(Probe, { message: warning }))).toContain("true");
  expect(renderToStaticMarkup(createElement(Probe, { message: "Connection failed" }))).toContain("false");
});
