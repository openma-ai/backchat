import { expect, it } from "vitest";
import { relatedReviews } from "./related-reviews";
it("finds and deduplicates PR and nested self-hosted MR links", () => {
  expect(relatedReviews(["[fix](https://github.com/org/repo/pull/42)", "https://github.com/org/repo/pull/42/files#diff", "https://git.example.com/team/sub/repo/-/merge_requests/7?tab=changes"])).toEqual([
    { url: "https://github.com/org/repo/pull/42", kind: "PR", repository: "org/repo", number: "42" },
    { url: "https://git.example.com/team/sub/repo/-/merge_requests/7", kind: "MR", repository: "team/sub/repo", number: "7" },
  ]);
});
it("ignores unrelated links, credentials, scripts, and unfinished numbers", () => {
  expect(relatedReviews(["https://github.com/org/repo/issues/4 https://user:secret@example.com/a/b/pull/2 javascript:alert(1) https://github.com/a/b/pull/"])).toEqual([]);
});
