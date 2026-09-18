import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { injectSession } from "./helpers";

/** 1×1 PNG. Real bytes, so the capture store's signature check and the
 *  attachment reader both see a genuine image. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type TransferEvent = "paste" | "drop" | "dragover" | "dragleave";

/** Dispatch a synthetic clipboard or drag event carrying the PNG as a File,
 *  the same shape Chromium hands the page for a real Cmd+V or Finder drop. */
async function dispatchImageTransfer(
  page: Page,
  kind: TransferEvent,
  target: "textarea" | "body" | "card",
): Promise<void> {
  await page.evaluate(
    ({ png, kind, target }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const file = new File([bytes], "image.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const element =
        target === "textarea"
          ? document.querySelector('[data-chat-surface="main"] textarea')
          : target === "card"
            ? document.querySelector('[data-chat-surface="main"] .composer-stack-card')
            : document.body;
      if (!element) throw new Error(`no ${target} to dispatch ${kind} on`);
      if (target === "body") (document.activeElement as HTMLElement | null)?.blur();
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
          : new DragEvent(kind, { dataTransfer: transfer, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    },
    { png: PNG_1X1, kind, target },
  );
}

test.describe("composer image paste and drop", () => {
  test("pastes a clipboard bitmap into the focused composer as an image attachment", async ({
    page,
    composer,
    home,
  }) => {
    const sessionId = await injectSession(page);
    await composer.input.click();

    await dispatchImageTransfer(page, "paste", "textarea");

    const thumbnail = page.getByRole("img", { name: /pasted-image\.png$/ });
    await expect(thumbnail).toBeVisible();
    // A files-only paste must not leave stray text in the editor.
    await expect(composer.input).toHaveValue("");

    await composer.send("what is in this image?");
    await composer.waitForPromptCount(1);
    const [prompt] = await composer.readPrompts();
    expect(prompt).toMatchObject({
      session_id: sessionId,
      text: "what is in this image?",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          name: expect.stringMatching(/pasted-image\.png$/),
        },
      ],
    });
    // The bitmap was persisted under the (test-isolated) Backchat data root,
    // so the agent receives a real file path, not an anonymous blob.
    expect(prompt.attachments?.[0]?.path.startsWith(join(home, "captures"))).toBe(true);
    const saved = await readdir(join(home, "captures"));
    expect(saved.filter((name) => name.endsWith("pasted-image.png"))).toHaveLength(1);
    await expect(thumbnail).toBeHidden();
  });

  test("routes a paste to the composer even when focus is elsewhere on the page", async ({
    page,
    composer,
  }) => {
    await injectSession(page);
    await expect(composer.input).toBeVisible();

    await dispatchImageTransfer(page, "paste", "body");

    await expect(page.getByRole("img", { name: /pasted-image\.png$/ })).toBeVisible();
  });

  test("accepts a dropped image on the composer card and shows the drop state", async ({
    page,
    composer,
    capture,
  }) => {
    await injectSession(page);
    await expect(composer.input).toBeVisible();
    // A draft in progress is the usual state when someone drags a file in.
    await composer.input.fill("what is in this image?");
    const card = page.locator('[data-chat-surface="main"] .composer-stack-card');

    await dispatchImageTransfer(page, "dragover", "card");
    await expect(card).toHaveAttribute("data-composer-drop-active", "true");
    // The drop state is a ring drawn with the card's shadow: measure what the
    // browser composited rather than trusting the attribute alone.
    const cardShadow = () =>
      card.locator(".composer-card").evaluate((element) => getComputedStyle(element).boxShadow);
    const activeShadow = await cardShadow();
    await capture("composer-drop-active.png", "file held over the composer", true);

    await dispatchImageTransfer(page, "drop", "card");
    await expect(page.getByRole("img", { name: /pasted-image\.png$/ })).toBeVisible();
    await expect(card).not.toHaveAttribute("data-composer-drop-active", "true");
    await expect(composer.input).toHaveValue("what is in this image?");
    const restingShadow = await cardShadow();
    expect(activeShadow).not.toBe(restingShadow);
    expect(activeShadow).toContain(restingShadow.split(",")[0]!.trim().split(" ")[0]!);
    await capture("composer-dropped-image.png", "dropped image attached", true);
  });

  test("attaches path-backed files and non-PNG bitmaps through the main process", async ({
    page,
    home,
  }) => {
    await injectSession(page);
    const notesPath = join(home, "dropped-notes.md");
    await writeFile(notesPath, "# dropped\n");

    const fromPaths = await page.evaluate(
      (path) => window.backchat.uiFsAttachPaths({ paths: [path] }),
      notesPath,
    );
    expect(fromPaths).toMatchObject([
      { name: "dropped-notes.md", path: notesPath, kind: "file", mimeType: "text/markdown" },
    ]);

    // A JPEG header + end marker is enough for the signature check; the store
    // never decodes pixels.
    const jpegBytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9];
    const saved = await page.evaluate(
      (bytes) =>
        window.backchat.uiFsSaveCapture({
          data: btoa(String.fromCharCode(...bytes)),
          name: "pasted-image.jpg",
          mimeType: "image/jpeg",
        }),
      jpegBytes,
    );
    expect(saved).toMatchObject({ kind: "image", mimeType: "image/jpeg" });
    expect(saved.name.endsWith("pasted-image.jpg")).toBe(true);

    // Declared type and bytes must agree.
    await expect(
      page.evaluate(() =>
        window.backchat.uiFsSaveCapture({
          data: btoa("not an image"),
          name: "x.png",
          mimeType: "image/jpeg",
        }),
      ),
    ).rejects.toThrow(/JPEG/i);
  });
});
