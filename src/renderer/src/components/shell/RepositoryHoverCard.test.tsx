import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { homeRelative, RepositoryCardBody } from "./RepositoryHoverCard";

const path = "/Users/me/.oma/worktrees/ws-fix-7c6f/02-hilo-agent-opencode";

function render(reviews: unknown[] | null) {
  const client = new QueryClient();
  client.setQueryData(["git-upstream", path], [{
    remote: "git@gitlab.xaminim.com:data/hilo-agent-opencode.git",
    branch: "backchat/fix-7c6f",
    repositoryUrl: "https://gitlab.xaminim.com/data/hilo-agent-opencode",
  }]);
  if (reviews) client.setQueryData(["git-reviews", path], { environmentId: null, checkouts: [{ path, reviews }] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}><RepositoryCardBody paths={[path]} /></QueryClientProvider>,
  );
}

describe("RepositoryCardBody", () => {
  it("links the GitLab repository, the branch tree and the branch's MR", () => {
    const html = render([{
      kind: "MR", number: 5452, title: "Fix skill attribution", state: "open", draft: false, checks: "unknown", review: "unknown",
      url: "https://gitlab.xaminim.com/data/hilo-agent-opencode/-/merge_requests/5452",
    }]);
    expect(html).toContain('href="https://gitlab.xaminim.com/data/hilo-agent-opencode"');
    expect(html).toContain('href="https://gitlab.xaminim.com/data/hilo-agent-opencode/-/tree/backchat/fix-7c6f"');
    expect(html).toContain('href="https://gitlab.xaminim.com/data/hilo-agent-opencode/-/merge_requests/5452"');
    expect(html).toContain("!5452");
    expect(html).toContain('data-repository-review="open"');
    expect(html).toContain('target="_blank"');
  });

  it("says it is still looking while the review query is pending, and that there is none when empty", () => {
    expect(render(null)).toContain('data-repository-review-status="pending"');
    expect(render([])).toContain('data-repository-review-status="none"');
  });

  it("shows home as ~", () => {
    expect(homeRelative("/Users/me/oos/backchat")).toBe("~/oos/backchat");
    expect(homeRelative("/home/me")).toBe("~");
    expect(homeRelative("/opt/x")).toBe("/opt/x");
  });
});
