import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";

const openmaCommonRoot = resolve(__dirname, "../../../Proj/openma-common");

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    dedupe: ["react", "react-dom", "use-stick-to-bottom"],
    alias: [
      {
        find: /^@openma\/common\/chat-ui$/,
        replacement: resolve(openmaCommonRoot, "src/chat-ui/index.ts"),
      },
      {
        find: /^@openma\/common\/agent-ui\/react$/,
        replacement: resolve(openmaCommonRoot, "src/agent-ui/react.tsx"),
      },
      {
        find: /^@openma\/common\/agent-ui$/,
        replacement: resolve(openmaCommonRoot, "src/agent-ui/index.ts"),
      },
      {
        find: /^react$/,
        replacement: resolve(__dirname, "node_modules/react/index.js"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: resolve(
          __dirname,
          "node_modules/react/jsx-dev-runtime.js",
        ),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(__dirname, "node_modules/react-dom/index.js"),
      },
      {
        find: /^@radix-ui\/react-collapsible$/,
        replacement: resolve(
          __dirname,
          "node_modules/@radix-ui/react-collapsible/dist/index.mjs",
        ),
      },
      {
        find: /^streamdown$/,
        replacement: resolve(__dirname, "node_modules/streamdown/dist/index.js"),
      },
      {
        find: /^lucide-react$/,
        replacement: resolve(
          __dirname,
          "node_modules/lucide-react/dist/esm/lucide-react.mjs",
        ),
      },
      { find: "@shared", replacement: resolve(__dirname, "src/shared") },
      { find: "@", replacement: resolve(__dirname, "src/renderer/src") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
