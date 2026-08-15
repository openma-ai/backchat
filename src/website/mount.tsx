import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

export function mountWebsite(content: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Website root element is missing");

  const app = <StrictMode>{content}</StrictMode>;
  if (root.hasChildNodes()) {
    hydrateRoot(root, app);
    return;
  }

  createRoot(root).render(app);
}
