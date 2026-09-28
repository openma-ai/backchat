export interface RelatedReview { url: string; kind: "PR" | "MR"; repository: string; number: string }
export function relatedReviews(texts: readonly string[]): RelatedReview[] {
  const found = new Map<string, RelatedReview>();
  for (const text of texts) for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    try {
      const url = new URL(match[0].replace(/[).,;\]}]+$/, ""));
      if (url.username || url.password) continue;
      const pr = url.pathname.match(/^\/(.+)\/pull\/(\d+)(?:\/|$)/);
      const mr = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)(?:\/|$)/);
      const item = pr ?? mr;
      if (!item) continue;
      const kind = pr ? "PR" : "MR";
      const canonical = `${url.origin}/${item[1]}/${pr ? "pull" : "-/merge_requests"}/${item[2]}`;
      found.set(canonical, { url: canonical, kind, repository: item[1]!, number: item[2]! });
    } catch { /* Ignore incomplete URLs while a reply streams. */ }
  }
  return [...found.values()];
}
