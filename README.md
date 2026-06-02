# openma-desktop

A local-first desktop client for any ACP (Agent Client Protocol) agent — Claude
Code, Codex CLI, Gemini, OpenCode, Hermes, OpenClaw. Like Claude Code Desktop,
without the lock-in to one model or one vendor.

- **No remote backend.** Everything runs in this app. Your prompts and
  transcripts stay on your machine; only the agent itself talks to its model
  provider.
- **One unified MCP config.** Configure your MCP servers once, inject into every
  agent's `session/new`.
- **Workspace = a directory.** Sessions are grouped by the cwd they spawn in.

## Status

Pre-release. Phase 1 (scaffold).

## Stack

Electron + TypeScript main + React renderer (Vite) + Tailwind v4 + shadcn/ui +
TanStack Router/Query + cmdk + sonner + lucide.

The ACP integration is vendored from
[`open-managed-agents/packages/acp-runtime`](https://github.com/open-ma/open-managed-agents)
(Apache-2.0), trimmed of its remote-control-plane code paths.

## Develop

```bash
pnpm install
pnpm dev          # opens an Electron window in dev mode
pnpm build        # production bundle
pnpm package      # platform installer (dmg / exe / AppImage)
```
