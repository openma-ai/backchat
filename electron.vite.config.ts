import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
        // electron is a runtime built-in inside the Electron process, not
        // an npm package to bundle. The bundle hits a wrapper otherwise
        // that calls `process.execPath install.js` thinking it's in dev
        // install mode.
        //
        // better-sqlite3 is a native module — its bindings() lookup walks
        // the filesystem from the require()ing file. Inlining the package
        // breaks that lookup; externalize so Node resolves the package
        // directory normally and finds build/Release/better_sqlite3.node.
        //
        // externalizeDepsPlugin() reads package.json#dependencies and
        // marks each one external; we still need this explicit entry for
        // `electron` (which lives in devDependencies — built into the
        // runtime, not bundled).
        external: ["electron"],
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // Sandboxed preload must be CommonJS — Electron loads it via the
        // sandbox runtime which has no ESM hooks. Emit `.cjs` so the
        // engine selects the right loader regardless of `package.json#type`.
        // Externalize `electron` for the same reason as in `main`.
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
  },
});
