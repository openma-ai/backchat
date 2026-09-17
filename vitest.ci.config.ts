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
    dedupe: ["react", "react-dom", "use-stick-to-bottom"],
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
      "src/main/openma-*.test.ts",
      "src/main/direct-agent-runtime.test.ts",
      "src/renderer/src/lib/direct-task-projection.test.ts",
      "src/shared/openma-*.test.ts",
      "src/renderer/src/lib/openma-*.test.ts",
      "src/renderer/src/lib/remote-resource-routing.test.ts",
      "src/main/openmanaged-cloud-runtime.test.ts",
      "src/main/oma-bridge.test.ts",
      "src/main/power-management.test.ts",
      "src/main/quit-coordinator.test.ts",
      "src/main/session-cwd.test.ts",
      "src/main/session-manager.test.ts",
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
