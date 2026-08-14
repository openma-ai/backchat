import { useEffect, useRef } from "react";

import { sessionStore } from "@/lib/session-store";
import { thoughtHeadline } from "@/lib/thought-headline";

export function StreamingThoughtProjection({
  turnId,
  prefixSkip,
  fallback,
  mode,
}: {
  turnId: string;
  prefixSkip: number;
  fallback: string;
  mode: "body" | "headline";
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let text = "";
    let replaying = true;
    const render = () => {
      const body = text.replace(/\s+/g, " ").trim();
      host.textContent = mode === "headline"
        ? thoughtHeadline(text) || body || fallback
        : body || fallback;
    };
    const off = sessionStore.subscribeTurnStream(turnId, (delta) => {
      if (delta.kind !== "thought") return;
      if (replaying) {
        text = delta.text.slice(prefixSkip);
        replaying = false;
      } else {
        text += delta.text;
      }
      render();
    });
    if (replaying) render();
    return off;
  }, [fallback, mode, prefixSkip, turnId]);

  return <span ref={hostRef}>{fallback}</span>;
}
