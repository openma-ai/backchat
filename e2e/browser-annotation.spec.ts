import { access } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { injectSession, launchApp } from "./helpers";

test("a selected browser element adds DOM context and a screenshot to the composer", async ({}, testInfo) => {
  const { page, cleanup } = await launchApp();
  try {
    const sessionId = await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-annotation",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await expect(closeSidePanel).toBeVisible();
    await page.getByRole("button", { name: /浏览器/ }).click();

    const webview = page.locator("webview");
    await webview.waitFor();
    const annotateButton = page.getByRole("button", { name: "Annotate page element" });
    await expect(annotateButton).toBeEnabled();
    await webview.evaluate((element) =>
      (element as HTMLElement & {
        executeJavaScript<T>(code: string): Promise<T>;
      }).executeJavaScript(`(() => {
        document.title = 'Settings';
        document.body.innerHTML = '<main><button id="save" class="primary" type="button" aria-label="Save settings">Save</button></main>';
        Object.assign(document.body.style, {
          margin: '0', padding: '40px', background: '#e8f0ff', fontFamily: 'sans-serif'
        });
        Object.assign(document.querySelector('#save').style, {
          width: '160px', height: '48px', background: '#f84f32', color: 'white',
          border: '0', borderRadius: '8px'
        });
      })()`),
    );

    await annotateButton.click();
    await expect(page.getByRole("button", { name: "Cancel page annotation" })).toBeVisible();
    const guestHasInjectedPicker = await webview.evaluate((element) =>
      (element as HTMLElement & {
        executeJavaScript<T>(code: string): Promise<T>;
      }).executeJavaScript(
        `Boolean(document.querySelector('[id^="__backchat-element-picker"]'))`,
      ),
    );
    expect(guestHasInjectedPicker).toBe(false);

    const webviewBox = await webview.boundingBox();
    expect(webviewBox).not.toBeNull();
    await page.mouse.move(webviewBox!.x + 120, webviewBox!.y + 64);
    await expect(page.locator("[data-browser-element-hover]")).toContainText(
      "#save  160x48",
    );
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "1 page annotation" })).toBeVisible();
    const screenshot = page.getByRole("img", { name: /page-element-.*\.png/ });
    await expect(screenshot).toBeVisible();
    await expect(screenshot).toHaveCSS("object-fit", "cover");
    await expect(screenshot).toHaveCSS("object-position", "50% 0%");
    await expect(page.locator('textarea[placeholder="Reply…"]')).toHaveValue("");

    const screenshotPath = testInfo.outputPath("browser-element-annotation.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("browser element annotation", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.locator('textarea[placeholder="Reply…"]').press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          // @ts-expect-error -- test bridge
          window.__backchatTest.readSessionPrompts().then(
            (items: unknown[]) => items.length,
          ),
        ),
      )
      .toBe(1);
    const [prompt] = await page.evaluate(() =>
      // @ts-expect-error -- test bridge
      window.__backchatTest.readSessionPrompts(),
    );
    expect(prompt.session_id).toBe(sessionId);
    expect(prompt.attachments).toHaveLength(1);
    expect(prompt.annotations).toMatchObject([
      {
        kind: "browser_element",
        browser: {
          selector: "#save",
          tag_name: "button",
          aria_label: "Save settings",
          text: "Save",
        },
      },
    ]);
    await access(prompt.attachments[0].path);
    await testInfo.attach("captured annotated page", {
      path: prompt.attachments[0].path,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});

test("a dragged browser region adds visual context and a screenshot without DOM metadata", async ({}, testInfo) => {
  const { app, page, cleanup } = await launchApp();
  try {
    const sessionId = await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-region",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await page.getByRole("button", { name: /浏览器/ }).click();

    const webview = page.locator("webview");
    await webview.waitFor();
    await webview.evaluate((element) =>
      (element as HTMLElement & {
        executeJavaScript<T>(code: string): Promise<T>;
      }).executeJavaScript(`(() => {
        document.title = 'Rubric settings';
        document.body.innerHTML = '<main><h1>Rubric management</h1><section>Scoring configuration</section></main>';
        Object.assign(document.body.style, {
          margin: '0', padding: '32px', background: '#fff', fontFamily: 'sans-serif'
        });
      })()`),
    );

    await page.getByRole("button", { name: "Annotate page element" }).click();
    const webviewBox = await webview.boundingBox();
    expect(webviewBox).not.toBeNull();
    const start = { x: webviewBox!.x + 40, y: webviewBox!.y + 150 };
    const end = { x: webviewBox!.x + 300, y: webviewBox!.y + 330 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await expect(page.locator("[data-browser-region-selection]")).toBeVisible();
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "1 page annotation" })).toBeVisible();
    const screenshot = page.getByRole("img", { name: /page-region-.*\.png/ });
    await expect(screenshot).toBeVisible();
    await expect(screenshot).toHaveCSS("object-position", "50% 0%");

    const screenshotPath = testInfo.outputPath("browser-region-annotation.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("browser region annotation", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.locator('textarea[placeholder="Reply…"]').press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          // @ts-expect-error -- test bridge
          window.__backchatTest.readSessionPrompts().then(
            (items: unknown[]) => items.length,
          ),
        ),
      )
      .toBe(1);
    const [prompt] = await page.evaluate(() =>
      // @ts-expect-error -- test bridge
      window.__backchatTest.readSessionPrompts(),
    );
    expect(prompt.session_id).toBe(sessionId);
    expect(prompt.attachments).toHaveLength(1);
    expect(prompt.annotations).toMatchObject([
      {
        kind: "browser_region",
        browser_region: {
          title: "Rubric settings",
          rect: { x: 40, y: 150, width: 260, height: 180 },
        },
      },
    ]);
    await access(prompt.attachments[0].path);
    const capturedSize = await app.evaluate(
      ({ nativeImage }, path: string) => nativeImage.createFromPath(path).getSize(),
      prompt.attachments[0].path,
    );
    const regionViewport = prompt.annotations[0].browser_region.viewport;
    expect(capturedSize.width).toBeCloseTo(
      regionViewport.width * regionViewport.device_pixel_ratio,
      0,
    );
    await testInfo.attach("captured browser region", {
      path: prompt.attachments[0].path,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});

test("elements inside Shadow DOM and an iframe resolve through their own CDP contexts", async ({}, testInfo) => {
  const { app, page, cleanup } = await launchApp();
  try {
    await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-complex-dom",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await page.getByRole("button", { name: /浏览器/ }).click();

    const webview = page.locator("webview");
    await webview.waitFor();
    const executeGuest = <T,>(code: string): Promise<T> => webview.evaluate(
      (element, source) => Promise.race([
        (element as HTMLElement & {
          executeJavaScript<TValue>(script: string): Promise<TValue>;
        }).executeJavaScript<T>(source),
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error("Guest script timed out")), 3_000);
        }),
      ]),
      code,
    );
    await test.step("build the Shadow DOM and iframe fixture", async () => {
      await executeGuest(`(() => {
        document.title = 'Complex DOM';
        document.body.replaceChildren();
        Object.assign(document.body.style, {
          margin: '0', minHeight: '720px', background: '#f7f9fc', fontFamily: 'sans-serif'
        });

        const host = document.createElement('div');
        host.id = 'shadow-host';
        Object.assign(host.style, {
          position: 'absolute', left: '28px', top: '32px', width: '220px', height: '72px'
        });
        document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const shadowButton = document.createElement('button');
        shadowButton.id = 'shadow-action';
        shadowButton.setAttribute('aria-label', 'Shadow action');
        shadowButton.textContent = 'Shadow action';
        Object.assign(shadowButton.style, {
          width: '180px', height: '48px', margin: '12px', border: '0', borderRadius: '8px',
          background: '#1f2937', color: 'white'
        });
        shadow.append(shadowButton);

        const frame = document.createElement('iframe');
        frame.id = 'settings-frame';
        frame.title = 'Settings frame';
        frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Nested frame</title><style>body{margin:0;padding:30px;font-family:sans-serif;background:#eef6ff}button{width:170px;height:46px;border:0;border-radius:8px;background:#2563eb;color:white}</style><button id="frame-action" aria-label="Frame action">Frame action</button>');
        frame.addEventListener('load', () => {
          frame.dataset.loaded = 'true';
        }, { once: true });
        Object.assign(frame.style, {
          position: 'absolute', left: '20px', top: '150px', width: '300px', height: '180px', border: '0'
        });
        document.body.append(frame);
        return true;
      })()`);
    });

    await expect.poll(() => executeGuest<boolean>(
      `document.querySelector('#settings-frame')?.dataset.loaded === 'true'`,
    )).toBe(true);
    const targetCenters = await executeGuest<{
        shadow: { x: number; y: number };
        frame: { x: number; y: number };
      }>(`(() => {
        const host = document.querySelector('#shadow-host');
        const shadowButton = host.shadowRoot.querySelector('#shadow-action');
        const frame = document.querySelector('#settings-frame');
        const shadowRect = shadowButton.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return {
          shadow: {
            x: shadowRect.left + shadowRect.width / 2,
            y: shadowRect.top + shadowRect.height / 2,
          },
          frame: {
            x: frameRect.left + 30 + 170 / 2,
            y: frameRect.top + 30 + 46 / 2,
          },
        };
      })()`);

    const webviewBox = await webview.boundingBox();
    expect(webviewBox).not.toBeNull();
    const annotateButton = page.getByRole("button", { name: "Annotate page element" });

    await annotateButton.click();
    await expect(page.getByRole("button", { name: "Cancel page annotation" })).toBeVisible();
    await page.mouse.move(
      webviewBox!.x + targetCenters.shadow.x,
      webviewBox!.y + targetCenters.shadow.y,
    );
    await expect(page.locator("[data-browser-element-hover]")).toContainText(
      "#shadow-action",
    );
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "1 page annotation" })).toBeVisible({
      timeout: 8_000,
    });

    await annotateButton.click();
    await expect(page.getByRole("button", { name: "Cancel page annotation" })).toBeVisible();
    await page.mouse.move(
      webviewBox!.x + targetCenters.frame.x,
      webviewBox!.y + targetCenters.frame.y,
    );
    await expect(page.locator("[data-browser-element-hover]")).toContainText(
      "#frame-action",
    );
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "2 page annotations" })).toBeVisible({
      timeout: 8_000,
    });

    await expect(page.getByRole("img", { name: /page-element-.*\.png/ })).toHaveCount(2);

    const screenshotPath = testInfo.outputPath("browser-complex-dom-annotations.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("browser complex DOM annotations", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.locator('textarea[placeholder="Reply…"]').press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          // @ts-expect-error -- test bridge
          window.__backchatTest.readSessionPrompts().then(
            (items: unknown[]) => items.length,
          ),
        ),
      )
      .toBe(1);
    const [prompt] = await page.evaluate(() =>
      // @ts-expect-error -- test bridge
      window.__backchatTest.readSessionPrompts(),
    );
    expect(prompt.attachments).toHaveLength(2);
    expect(prompt.annotations).toMatchObject([
      {
        kind: "browser_element",
        browser: {
          selector: "#shadow-host >>> #shadow-action",
          aria_label: "Shadow action",
        },
      },
      {
        kind: "browser_element",
        browser: {
          url: expect.stringMatching(/^data:text\/html/),
          title: "Nested frame",
          selector: "#frame-action",
          aria_label: "Frame action",
        },
      },
    ]);
    for (const [index, attachment] of prompt.attachments.entries()) {
      await access(attachment.path);
      await testInfo.attach(`captured complex DOM element ${index + 1}`, {
        path: attachment.path,
        contentType: "image/png",
      });
    }
    const bottomPixels = await app.evaluate(
      ({ nativeImage }, paths: string[]) => paths.map((path) => {
        const image = nativeImage.createFromPath(path);
        const { width, height } = image.getSize();
        const bitmap = image.toBitmap();
        const offset = ((height - 8) * width + Math.floor(width / 2)) * 4;
        return Array.from(bitmap.subarray(offset, offset + 3));
      }),
      prompt.attachments.map((attachment: { path: string }) => attachment.path),
    );
    expect(bottomPixels.every((pixel) => Math.max(...pixel) > 100)).toBe(true);
  } finally {
    await cleanup();
  }
});

test("subframe loads preserve the picker while Escape and main-frame navigation cancel it", async () => {
  const { page, cleanup } = await launchApp();
  try {
    await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-picker-lifecycle",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await page.getByRole("button", { name: /浏览器/ }).click();

    const webview = page.locator("webview");
    await webview.waitFor();
    const annotateButton = page.getByRole("button", { name: "Annotate page element" });
    await annotateButton.click();
    const cancelButton = page.getByRole("button", { name: "Cancel page annotation" });
    await expect(cancelButton).toBeVisible();

    await webview.evaluate((element) =>
      (element as HTMLElement & {
        executeJavaScript<T>(code: string): Promise<T>;
      }).executeJavaScript(`(() => {
        const frame = document.createElement('iframe');
        frame.id = 'late-subframe';
        frame.srcdoc = '<!doctype html><p>Subframe loaded</p>';
        document.body.append(frame);
      })()`),
    );
    await expect.poll(() => webview.evaluate((element) =>
      (element as HTMLElement & {
        executeJavaScript<T>(code: string): Promise<T>;
      }).executeJavaScript<boolean>(
        `document.querySelector('#late-subframe')?.contentDocument?.readyState === 'complete'`,
      ),
    )).toBe(true);
    await expect(cancelButton).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(annotateButton).toBeVisible();
    await expect(page.locator("[data-browser-annotation-overlay]")).toHaveCount(0);

    await annotateButton.click();
    await expect(cancelButton).toBeVisible();
    await webview.evaluate((element) => {
      (element as HTMLElement & { src: string }).src =
        "data:text/html,<title>Navigated</title><main>New page</main>";
    });
    await expect(page.locator("[data-browser-annotation-overlay]")).toHaveCount(0);
    await expect(annotateButton).toBeEnabled();
  } finally {
    await cleanup();
  }
});
