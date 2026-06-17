declare module "*.css";
declare module "*.webp";
declare module "*.png";

type PetEdgeMode = "none" | "left" | "right" | "top" | "bottom";
type PetEdgeSurface = "screen" | "dock";
type PetEdgeAttachment = { mode: PetEdgeMode; surface: PetEdgeSurface };
type PetWindowBounds = { x: number; y: number; width: number; height: number };

interface Window {
  openmaPet?: {
    onEdgeMode(handler: (mode: PetEdgeMode) => void): () => void;
    onEdgeAttachment(handler: (attachment: PetEdgeAttachment) => void): () => void;
    onHarnessEvent(handler: (event: import("./pet-harness").PetHarnessEvent) => void): () => void;
    getWindowBounds(): Promise<PetWindowBounds>;
    startWindowDrag(): Promise<PetWindowBounds>;
    moveWindowTo(point: { x: number; y: number }): void;
    endWindowDrag(): void;
    setEventPanelOpen(open: boolean): void;
  };
}

type OpenmaPetStandaloneEvent = {
  name: import("./pet-controller").StandalonePetEventName;
  label?: string;
  sessionId?: string;
  turnId?: string;
  agentId?: string;
  source?: string;
  payload?: unknown;
};

interface WindowEventMap {
  "openma-pet-event": CustomEvent<OpenmaPetStandaloneEvent | import("./pet-harness").PetHarnessEvent>;
}
