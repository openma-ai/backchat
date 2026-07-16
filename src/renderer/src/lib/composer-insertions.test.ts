import { beforeEach, describe, expect, it } from "vitest";

import { composerInsertionStore } from "./composer-insertions";

describe("composerInsertionStore", () => {
  beforeEach(() => composerInsertionStore.resetForTests());

  it("queues browser capture attachments for one destination session", () => {
    composerInsertionStore.add("sess-main", {
      id: "capture-1",
      attachments: [
        {
          id: "shot-1",
          name: "page-element.png",
          path: "/tmp/page-element.png",
          uri: "file:///tmp/page-element.png",
          kind: "image",
          mimeType: "image/png",
          size: 42,
        },
      ],
    });

    expect(composerInsertionStore.get("sess-main")).toHaveLength(1);
    expect(composerInsertionStore.get("sess-other")).toEqual([]);

    composerInsertionStore.consume("sess-main", ["capture-1"]);
    expect(composerInsertionStore.get("sess-main")).toEqual([]);
  });

  it("replaces an insertion with the same id instead of duplicating it", () => {
    composerInsertionStore.add("sess-main", {
      id: "capture-1",
      attachments: [],
    });
    composerInsertionStore.add("sess-main", {
      id: "capture-1",
      attachments: [],
    });

    expect(composerInsertionStore.get("sess-main")).toHaveLength(1);
  });
});
