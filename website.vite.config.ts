import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const websiteRoot = resolve(__dirname, "src/website");

export default defineConfig({
  root: websiteRoot,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/website"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(websiteRoot, "index.html"),
        deepseek: resolve(websiteRoot, "deepseek/index.html"),
        chineseHome: resolve(websiteRoot, "zh/index.html"),
        chineseDeepseek: resolve(websiteRoot, "zh/deepseek/index.html"),
      },
    },
  },
});
