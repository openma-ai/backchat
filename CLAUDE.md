# openma-desktop — Claude Code project notes

## Design Context

See `.impeccable.md` in the project root. It carries the **Design Context**
section that every design / UI change must respect:

- target users (developer + GUI-hesitant power user)
- general-chat-first surface (not coding-IDE-shape)
- brand personality: quiet, dense, intentional
- aesthetic anchor: **Linear-adjacent** clean & neutral, NOT saas dashboard
- light + dark equal weight, follow `prefers-color-scheme`
- brand: muted clay `oklch(0.62 0.08 30)`
- five design principles (icon-only-thing-moves, color-earns-its-place,
  border-by-tone, first-paint-feels-like-landing, density-without-
  claustrophobia)

Read it before any UI work. Run `/impeccable teach` to update.

## Code Architecture

- **Electron 42 + electron-vite + React 19 + TanStack Router + Tailwind v4 +
  shadcn-style primitives + ai-elements (vendored from openma console)**
- ACP runtime vendored in `packages/acp/` (no workspace dep on openma OSS)
- Main process owns: SessionManager, SQL store (node:sqlite), TOML settings
  store, permission/fs/terminal brokers. See `src/main/`.
- Renderer: TanStack Router, file routes under `src/renderer/src/pages/`.
  Streaming chat uses dual-track render (streaming-markdown DOM mutation
  during stream, Streamdown React on turn complete).
- Settings file: `~/.openma-desktop/config.toml`. SQLite db:
  `<userData>/sessions.db`.
