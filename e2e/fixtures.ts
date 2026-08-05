import { test as base, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

import { ComposerPage } from "./composer-page";
import { launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

type LaunchedApp = Awaited<ReturnType<typeof launchApp>>;

/**
 * Shared Electron fixtures for the E2E suite.
 *
 * A test gets one fresh app and one page automatically. Cleanup runs even
 * when an assertion fails, and the composer page object is created from the
 * same page so selectors stay in one place.
 */
type OpenMAFixtures = {
  electron: LaunchedApp;
  app: ElectronApplication;
  page: Page;
  home: string;
  bridge: TestBridge;
  composer: ComposerPage;
  capture: (name: string, label?: string, fullPage?: boolean) => Promise<string>;
};

export const test = base.extend<OpenMAFixtures>({
  electron: async ({}, use, testInfo) => {
    const launched = await launchApp();
    const tracing = launched.app.context().tracing;
    let tracingStarted = false;
    try {
      await tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
      await use(launched);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (tracingStarted && failed) {
        const screenshotPath = testInfo.outputPath("e2e-failure.png");
        await launched.page
          .screenshot({ path: screenshotPath, fullPage: true })
          .catch(() => undefined);
        await testInfo.attach("E2E failure screenshot", {
          path: screenshotPath,
          contentType: "image/png",
        }).catch(() => undefined);
        await tracing.stop({ path: testInfo.outputPath("e2e-failure-trace.zip") }).catch(() => undefined);
      } else if (tracingStarted) {
        await tracing.stop().catch(() => undefined);
      }
      await launched.cleanup();
    }
  },

  app: async ({ electron }, use) => {
    await use(electron.app);
  },

  page: async ({ electron }, use) => {
    await use(electron.page);
  },

  home: async ({ electron }, use) => {
    await use(electron.home);
  },

  bridge: async ({ page }, use) => {
    await use(new TestBridge(page));
  },

  capture: async ({ page }, use, testInfo) => {
    await use(async (name, label = name, fullPage = false) => {
      const screenshotPath = testInfo.outputPath(name);
      await page.screenshot({ path: screenshotPath, fullPage });
      await testInfo.attach(label, {
        path: screenshotPath,
        contentType: "image/png",
      });
      return screenshotPath;
    });
  },

  composer: async ({ page }, use) => {
    await use(new ComposerPage(page));
  },
});

export { expect };
