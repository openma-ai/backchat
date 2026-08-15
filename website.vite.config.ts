import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { desktopVersion } from "./src/website/release";

const websiteRoot = resolve(__dirname, "src/website");

function stampDesktopRelease(): Plugin {
  return {
    name: "stamp-desktop-release",
    transformIndexHtml(html) {
      return html.replaceAll("__DESKTOP_VERSION__", desktopVersion);
    },
  };
}

export default defineConfig({
  root: websiteRoot,
  plugins: [react(), stampDesktopRelease()],
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
