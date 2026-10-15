import { describe, expect, it } from "vitest";
import { repositoryWebLink } from "./repository-web.js";

describe("repositoryWebLink", () => {
  it("maps a GitHub clone URL to the repository page and its branch tree", () => {
    const link = repositoryWebLink("https://github.com/openma-ai/backchat.git", "devin/turn-projector");
    expect(link).toEqual({
      provider: "github",
      name: "openma-ai/backchat",
      url: "https://github.com/openma-ai/backchat",
      branchUrl: "https://github.com/openma-ai/backchat/tree/devin/turn-projector",
    });
  });

  it("recognises self-hosted GitLab over https and scp-style ssh, including nested groups", () => {
    expect(repositoryWebLink("https://gitlab.xaminim.com/qa/minimaxhub_benchmark.git", "backchat/fix-abc-7c6f")).toEqual({
      provider: "gitlab",
      name: "qa/minimaxhub_benchmark",
      url: "https://gitlab.xaminim.com/qa/minimaxhub_benchmark",
      branchUrl: "https://gitlab.xaminim.com/qa/minimaxhub_benchmark/-/tree/backchat/fix-abc-7c6f",
    });
    // task-environment strips the login from scp remotes: git@host:path -> host:path
    expect(repositoryWebLink("gitlab.xaminim.com:data/team/hilo-agent-opencode.git", null)).toMatchObject({
      provider: "gitlab",
      name: "data/team/hilo-agent-opencode",
      url: "https://gitlab.xaminim.com/data/team/hilo-agent-opencode",
      branchUrl: null,
    });
    expect(repositoryWebLink("git@gitlab.xaminim.com:data/hilo-agent-opencode.git", "b")?.url).toBe("https://gitlab.xaminim.com/data/hilo-agent-opencode");
    expect(repositoryWebLink("ssh://gitlab.example.com:2222/group/repo.git", "main")?.url).toBe("https://gitlab.example.com/group/repo");
  });

  it("uses the review kind to place an unrecognised host, and otherwise links nothing", () => {
    expect(repositoryWebLink("https://git.corp.dev/a/b.git", null, "MR")?.provider).toBe("gitlab");
    expect(repositoryWebLink("https://ghe.corp.dev/a/b.git", "x", "PR")?.branchUrl).toBe("https://ghe.corp.dev/a/b/tree/x");
    expect(repositoryWebLink("https://git.corp.dev/a/b.git", null)).toBeNull();
    expect(repositoryWebLink("/local/bare.git", null)).toBeNull();
    expect(repositoryWebLink(null, null)).toBeNull();
  });

  it("escapes branch characters without breaking the path separators", () => {
    expect(repositoryWebLink("https://github.com/a/b", "feat/a b#1")?.branchUrl).toBe("https://github.com/a/b/tree/feat/a%20b%231");
  });
});
