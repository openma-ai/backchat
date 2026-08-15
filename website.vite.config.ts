import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: resolve(__dirname, "src/website"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/website"),
    emptyOutDir: true,
  },
});
