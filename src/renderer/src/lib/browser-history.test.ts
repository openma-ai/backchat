import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_HISTORY_LIMIT,
  type BrowserVisit,
  recordBrowserVisit,
  removeBrowserVisit,
  resetBrowserHistoryCacheForTests,
  updateBrowserVisitMeta,
} from "./browser-history";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

// What survives a restart: the persisted list.
const visits = (): BrowserVisit[] =>
  JSON.parse(localStorage.getItem("oma.browser.recentVisits.v1") ?? "[]");

describe("browser visit history", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    resetBrowserHistoryCacheForTests();
  });

  it("remembers web pages most-recent first and ignores blank or local files", () => {
    recordBrowserVisit("https://a.example/", 1);
    recordBrowserVisit("about:blank", 2);
    recordBrowserVisit("file:///tmp/x.html", 3);
    recordBrowserVisit("http://localhost:5173/", 4);

    expect(visits().map((visit) => visit.url)).toEqual([
      "http://localhost:5173/",
      "https://a.example/",
    ]);
  });

  it("moves a revisited page to the front, keeping its title, ignoring the fragment", () => {
    recordBrowserVisit("https://a.example/docs", 1);
    updateBrowserVisitMeta("https://a.example/docs", { title: "Docs" });
    recordBrowserVisit("https://b.example/", 2);
    recordBrowserVisit("https://a.example/docs#install", 3);

    const [first, second] = visits();
    expect(first).toMatchObject({ url: "https://a.example/docs#install", title: "Docs", visitedAt: 3 });
    expect(second?.url).toBe("https://b.example/");
    expect(visits()).toHaveLength(2);
  });

  it("caps the list and supports removal", () => {
    for (let index = 0; index < BROWSER_HISTORY_LIMIT + 3; index += 1) {
      recordBrowserVisit(`https://site${index}.example/`, index);
    }
    expect(visits()).toHaveLength(BROWSER_HISTORY_LIMIT);

    removeBrowserVisit(`https://site${BROWSER_HISTORY_LIMIT + 2}.example/`);
    expect(visits()[0]?.url).toBe(`https://site${BROWSER_HISTORY_LIMIT + 1}.example/`);
  });
});
