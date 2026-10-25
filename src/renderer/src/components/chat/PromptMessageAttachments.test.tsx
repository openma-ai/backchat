import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromptMessageAttachments } from "./PromptMessageAttachments";
import { localFileProtocolUrl } from "@shared/local-file-url";

describe("sent-message attachments", () => {
  it("previews persisted image paths even after inline data was stripped", () => {
    const html = renderToStaticMarkup(<PromptMessageAttachments attachments={[{ id: "image", name: "screen.png", kind: "image", mimeType: "image/png", path: "/tmp/screen.png", uri: "file:///tmp/screen.png" }]} />);
    expect(html).toContain('alt="screen.png"');
    expect(html).toContain(localFileProtocolUrl("/tmp/screen.png").replaceAll("&", "&amp;"));
  });
});

it("renders multiple images and leaves ordinary files available", () => {
  const html = renderToStaticMarkup(<PromptMessageAttachments attachments={[
    { id: "one", name: "one.png", kind: "image", mimeType: "image/png", path: "/tmp/one.png", uri: "file:///tmp/one.png" },
    { id: "two", name: "two.png", kind: "image", mimeType: "image/png", path: "/tmp/two.png", uri: "file:///tmp/two.png" },
    { id: "file", name: "notes.txt", kind: "file", path: "/tmp/notes.txt", uri: "file:///tmp/notes.txt" },
  ]} />);
  expect(html.match(/<img /g)).toHaveLength(2);
  expect(html).toContain('download="notes.txt"');
  expect(html).toContain("notes.txt");
});
