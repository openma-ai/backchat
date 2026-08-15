import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Curated GitHub Actions lane. Do not merge this with the full vitest include
 * list — Vite's mergeConfig concatenates arrays, and `pnpm test` still has
 * known red files. This set must stay green because a miss ships a broken
 * desktop build.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*-contract.test.ts",
      "packages/**/*-contract.test.ts",
      "src/main/browser-plugin-mcp.test.ts",
      "packages/acp/src/registry.test.ts",
      "packages/acp-agent-setup/src/index.test.ts",
      "src/renderer/src/pages/settings/agent-catalog-state.test.ts",
      "src/renderer/src/pages/settings/agent-setup-lifecycle.test.ts",
      "src/renderer/src/components/shell/Sidebar.test.ts",
      "src/main/schedule-*.test.ts",
      "src/main/scheduled-task-executor.test.ts",
      "src/main/ipc-schedule-cleanup.test.ts",
      "src/renderer/src/lib/scheduled-task-presentation.test.ts",
      "src/renderer/src/lib/composer-harness-state.test.ts",
      "src/shared/auth-errors.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "**/pairchat-gui-contract.test.ts",
      "**/session-level-gui-contract.test.ts",
    ],
  },
});
