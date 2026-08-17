import { useEffect, useRef } from "react";

import { sessionStore } from "@/lib/session-store";
import { thoughtHeadline } from "@/lib/thought-headline";

export function thoughtProjectionLines(text: string, fallback: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
}

function syncProjectionLines(host: HTMLSpanElement, lines: string[]) {
  while (host.children.length > lines.length) {
    host.lastElementChild?.remove();
  }
  lines.forEach((line, index) => {
    let row = host.children.item(index) as HTMLSpanElement | null;
    if (!row) {
      row = document.createElement("span");
      row.dataset.thoughtProjectionLine = "true";
      row.className = "block min-w-0 truncate leading-6";
      host.append(row);
    }
    if (row.textContent !== line) row.textContent = line;
  });
}

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
      const lines = thoughtProjectionLines(text, fallback);
      if (mode === "headline") {
        host.textContent = thoughtHeadline(text) || lines[0] || fallback;
      } else {
        syncProjectionLines(host, lines);
      }
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

  if (mode === "headline") return <span ref={hostRef}>{fallback}</span>;
  return (
    <span ref={hostRef} className="block min-w-0" data-thought-projection="lines">
      {thoughtProjectionLines(fallback, fallback).map((line, index) => (
        <span
          key={`${index}-${line}`}
          data-thought-projection-line="true"
          className="block min-w-0 truncate leading-6"
        >
          {line}
        </span>
      ))}
    </span>
  );
}
