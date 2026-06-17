export type PetVisualLayer = "atlas" | "side-peek-strip" | "bottom-rest-strip";

export function visualLayerForEdgeMode(edgeMode: PetEdgeMode): PetVisualLayer {
  if (edgeMode === "left" || edgeMode === "right") return "side-peek-strip";
  if (edgeMode === "bottom") return "bottom-rest-strip";
  return "atlas";
}
