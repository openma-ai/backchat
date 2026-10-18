import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { homeRelative, RepositoryCardBody } from "./RepositoryHoverCard";

const path = "/Users/me/.oma/worktrees/ws-fix-7c6f/02-hilo-agent-opencode";

function render(git: unknown | null) {
  const client = new QueryClient();
  if (git) client.setQueryData(["git-upstream", path], [git]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}><RepositoryCardBody paths={[path]} /></QueryClientProvider>,
  );
  return { html, client };
}

describe("RepositoryCardBody", () => {
  it("says where the checkout is and which branch it is on, and nothing more", () => {
    const { html, client } = render({
      remote: "git@gitlab.xaminim.com:data/hilo-agent-opencode.git",
      branch: "backchat/fix-7c6f",
    });
    expect(html).toContain("backchat/fix-7c6f");
    expect(html).toContain("~/.oma/worktrees/ws-fix-7c6f/02-hilo-agent-opencode");
    // Links and reviews live in the row's menu; the card is read-only and
    // never waits on a gh / glab lookup.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("data-repository-review");
    expect(client.getQueryCache().find({ queryKey: ["git-reviews", path] })).toBeUndefined();
  });

  it("names a folder that is not a Git checkout", () => {
    expect(render({ remote: null, branch: null }).html).toContain("data-repository-not-git");
  });

  it("shows home as ~", () => {
    expect(homeRelative("/Users/me/oos/backchat")).toBe("~/oos/backchat");
    expect(homeRelative("/home/me")).toBe("~");
    expect(homeRelative("/opt/x")).toBe("/opt/x");
  });
});
