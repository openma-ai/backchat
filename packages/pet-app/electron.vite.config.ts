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
        external: ["electron"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    server: { port: 5666, strictPort: true },
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
