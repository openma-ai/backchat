/** Resolve a typography token to the family list xterm and other non-CSS
 *  hosts can consume. The literal stacks live only in `styles/index.css`. */
export function cssFontFamily(variable: "--font-sans" | "--font-mono"): string {
  if (typeof document === "undefined") {
    return variable === "--font-mono" ? "ui-monospace, monospace" : "sans-serif";
  }
  const probe = document.createElement("span");
  probe.style.fontFamily = `var(${variable})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || (variable === "--font-mono" ? "ui-monospace, monospace" : "sans-serif");
}
