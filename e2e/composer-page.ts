import { expect, type Locator, type Page } from "@playwright/test";

import type { PromptAttachment, SessionPromptParams } from "../src/shared/session-events.js";
import { TestBridge } from "./test-bridge";

/**
 * Page object for the composer surfaces shared by session, file, slash, and
 * attachment E2Es. Keep selectors and test-bridge plumbing here so product
 * markup changes have one maintenance point.
 */
export class ComposerPage {
  readonly input: Locator;
  readonly bridge: TestBridge;

  constructor(readonly page: Page) {
    this.input = page.locator('[data-chat-surface="main"] textarea').last();
    this.bridge = new TestBridge(page);
  }

  mentionPicker(): Locator {
    return this.page.getByRole("listbox", { name: "Mention another session" });
  }

  async fillMention(query = ""): Promise<void> {
    await this.input.fill(query.startsWith("@") ? query : `@${query}`);
  }

  async pickMention(name: string | RegExp): Promise<void> {
    const picker = this.mentionPicker();
    await expect(picker).toBeVisible();
    await picker.getByRole("option", { name }).first().click();
  }

  async pickBrowseFile(): Promise<void> {
    await this.pickMention(/Choose a file/);
  }

  fileChip(name: string): Locator {
    return this.page.getByRole("button", { name: `Open ${name}` });
  }

  sessionOpenButton(): Locator {
    return this.page.getByRole("button", {
      name: /Open referenced session:/,
    });
  }

  sessionRemoveButton(): Locator {
    return this.page.getByRole("button", {
      name: /Remove session reference:/,
    });
  }

  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.input.press("Enter");
  }

  async setPickedFiles(files: PromptAttachment[]): Promise<void> {
    await this.bridge.setPickedFiles(files);
  }

  async readPrompts(): Promise<SessionPromptParams[]> {
    return this.bridge.readSessionPrompts();
  }

  async readPromptTexts(): Promise<string[]> {
    return (await this.readPrompts()).map((prompt) => prompt.text);
  }

  async waitForPromptCount(count: number): Promise<void> {
    await expect.poll(async () => (await this.readPrompts()).length).toBe(count);
  }

  async waitForPromptTexts(texts: string[]): Promise<void> {
    await expect.poll(() => this.readPromptTexts()).toEqual(texts);
  }

  async expectInlineMentionLayout(chip: Locator): Promise<void> {
    const chipBox = await chip.boundingBox();
    const inputBox = await this.input.boundingBox();
    expect(chipBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(Math.abs((chipBox?.y ?? 0) - (inputBox?.y ?? 0))).toBeLessThan(32);
  }

  async expectStandaloneAttachmentLayout(attachment: Locator): Promise<void> {
    const attachmentBox = await attachment.boundingBox();
    const inputBox = await this.input.boundingBox();
    expect(attachmentBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect((attachmentBox?.y ?? 0)).toBeLessThan((inputBox?.y ?? 0) - 20);
  }
}
