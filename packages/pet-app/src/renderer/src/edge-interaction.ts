import type { PlaybackIntensity } from "./pet-presentation";

export type EdgeInteraction = "idle" | "hover" | "click";
export type EdgeInteractionEvent = "attach" | "detach" | "hover" | "click" | "settle";

export const EDGE_INTERACTION_SETTLE_MS = 1_200;

export function shouldAutoSettleEdgeInteraction(interaction: EdgeInteraction): boolean {
  return interaction === "click";
}

export function nextEdgeInteraction(
  current: EdgeInteraction,
  event: EdgeInteractionEvent,
): EdgeInteraction {
  switch (event) {
    case "attach":
    case "detach":
    case "settle":
      return "idle";
    case "click":
      return "click";
    case "hover":
      return current === "click" ? "click" : "hover";
  }
}

export function edgeIntensityForInteraction(interaction: EdgeInteraction): PlaybackIntensity {
  switch (interaction) {
    case "click":
      return "attention";
    case "hover":
      return "normal";
    case "idle":
      return "quiet";
  }
}

export function edgeInteractionClass(interaction: EdgeInteraction): string {
  return `edge-interaction-${interaction}`;
}
