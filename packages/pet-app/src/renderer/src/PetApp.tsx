import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStandalonePetController, type PetViewState } from "./pet-controller";
import type { PetHarnessEvent } from "./pet-harness";
import { dragMotionForDelta } from "./drag-motion";
import { shouldAnimateSprite, shouldAutoSettleMotion } from "./motion-playback";
import { isWorkMotion, presentationForState, runningFallbackAfterTransient } from "./pet-presentation";
import { visualLayerForEdgeMode } from "./pet-render-model";
import { cssSizeVars } from "./pet-size-model";
import bottomRestStrip from "./assets/mote-bottom-peek-strip.png";
import edgePeekStrip from "./assets/mote-edge-peek-strip.png";
import moteSpritesheet from "./assets/mote-spritesheet.webp";

const INITIAL_STATE: PetViewState = {
  motion: "idle",
  mood: "calm",
  intensity: "low",
  priority: "low",
  label: "Mote",
  proactive: false,
  updatedAt: Date.now(),
};
const TRANSIENT_MOTION_MS = 1_400;
const HARNESS_EVENT_BADGE_MS = 7_000;
const SHOW_DEBUG_BOXES = true;

export function PetApp() {
  const controller = useMemo(() => createStandalonePetController(), []);
  const [state, setState] = useState(INITIAL_STATE);
  const stateRef = useRef<PetViewState>(INITIAL_STATE);
  const lastNonEdgeStateRef = useRef<PetViewState>(INITIAL_STATE);
  const lastWorkStateRef = useRef<PetViewState | null>(null);
  const [edgeMode, setEdgeMode] = useState<PetEdgeMode>("none");
  const [edgeSurface, setEdgeSurface] = useState<PetEdgeSurface>("screen");
  const [dragMotion, setDragMotion] = useState<PetViewState["motion"] | null>(null);
  const [lastHarnessEvent, setLastHarnessEvent] = useState<PetHarnessEvent | null>(null);
  const [harnessEventCount, setHarnessEventCount] = useState(0);
  const dragRef = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const isSidePeek = edgeMode === "left" || edgeMode === "right";
  const isTopPeek = edgeMode === "top";
  const isBottomRest = edgeMode === "bottom";
  const atlas = presentationForState(
    isTopPeek ? { ...state, motion: "jumping" } : state,
    dragMotion,
  );
  const visualLayer = visualLayerForEdgeMode(edgeMode);
  const sizeVars = useMemo(() => cssSizeVars(), []);
  const animateSprite = dragMotion !== null || shouldAnimateSprite(state.motion);

  const applyStates = useCallback((states: PetViewState[]) => {
    const next = states.at(-1);
    if (next) {
      if (isWorkMotion(next.motion)) {
        lastWorkStateRef.current = next;
      }
      stateRef.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      applyStates(controller.idleTick());
    }, 20 * 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [applyStates, controller]);

  useEffect(() => {
    if (dragMotion !== null || isSidePeek || isTopPeek || isBottomRest || !shouldAutoSettleMotion(state.motion)) return;
    const timeout = window.setTimeout(() => {
      const current = stateRef.current;
      const fallback = runningFallbackAfterTransient(current, lastWorkStateRef.current);
      const next = fallback ?? INITIAL_STATE;
      if (!fallback && current.motion === "running") {
        lastWorkStateRef.current = null;
      }
      stateRef.current = next;
      setState(next);
    }, TRANSIENT_MOTION_MS);
    return () => window.clearTimeout(timeout);
  }, [dragMotion, isBottomRest, isSidePeek, isTopPeek, state.motion]);

  useEffect(() => {
    return window.openmaPet?.onEdgeAttachment((attachment) => {
      const { mode, surface } = attachment;
      setEdgeSurface(surface);
      setEdgeMode((previousMode) => {
        const wasSidePeek = previousMode === "left" || previousMode === "right";
        const isNextSidePeek = mode === "left" || mode === "right";
        if (!wasSidePeek && isNextSidePeek) {
          lastNonEdgeStateRef.current = stateRef.current;
        }
        if (wasSidePeek && !isNextSidePeek) {
          stateRef.current = lastNonEdgeStateRef.current;
          setState(lastNonEdgeStateRef.current);
        }
        return mode;
      });
      if (mode === "left" || mode === "right") {
        applyStates(controller.dispatchEvent("pet.edge.peek", { label: "peek" }));
      }
    });
  }, [applyStates, controller]);

  useEffect(() => {
    const listener = (event: WindowEventMap["openma-pet-event"]) => {
      if ("harness" in event.detail) {
        applyStates(controller.dispatchHarnessEvent(event.detail));
        return;
      }
      const { name, ...options } = event.detail;
      applyStates(controller.dispatchEvent(name, options));
    };
    window.addEventListener("openma-pet-event", listener);
    return () => window.removeEventListener("openma-pet-event", listener);
  }, [applyStates, controller]);

  useEffect(() => {
    return window.openmaPet?.onHarnessEvent((event) => {
      setLastHarnessEvent(event);
      setHarnessEventCount((count) => Math.min(count + 1, 99));
      applyStates(controller.dispatchHarnessEvent(event));
    });
  }, [applyStates, controller]);

  useEffect(() => {
    if (!lastHarnessEvent) return;
    const timeout = window.setTimeout(() => setLastHarnessEvent(null), HARNESS_EVENT_BADGE_MS);
    return () => window.clearTimeout(timeout);
  }, [lastHarnessEvent]);

  const finishPetDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) {
      setDragMotion(null);
      return;
    }
    suppressNextClickRef.current = drag.moved;
    dragRef.current = null;
    window.openmaPet?.endWindowDrag();
    setDragMotion(null);
  }, []);

  useEffect(() => {
    window.addEventListener("blur", finishPetDrag);
    window.addEventListener("pointerup", finishPetDrag);
    window.addEventListener("pointercancel", finishPetDrag);
    return () => {
      window.removeEventListener("blur", finishPetDrag);
      window.removeEventListener("pointerup", finishPetDrag);
      window.removeEventListener("pointercancel", finishPetDrag);
    };
  }, [finishPetDrag]);

  const openTarget = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    dragRef.current = null;
    applyStates(controller.dispatchEvent("pet.clicked", { label: "hi" }));
    if (state.navigationUrl) {
      window.open(state.navigationUrl, "_blank", "noopener,noreferrer");
    }
  };

  const previewHover = () => {
    if (dragRef.current) return;
    applyStates(controller.dispatchEvent("pet.hovered", { label: "hi" }));
  };

  const startPetDrag = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !window.openmaPet) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = await window.openmaPet.startWindowDrag();
    setDragMotion(null);
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      offsetX: event.screenX - bounds.x,
      offsetY: event.screenY - bounds.y,
      moved: false,
    };
  };

  const movePetDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !window.openmaPet) return;
    const next = {
      x: event.screenX - drag.offsetX,
      y: event.screenY - drag.offsetY,
    };
    if (Math.abs(event.screenX - drag.startScreenX) + Math.abs(event.screenY - drag.startScreenY) > 3) {
      drag.moved = true;
    }
    const nextDragMotion = dragMotionForDelta(event.screenX - drag.startScreenX);
    if (nextDragMotion) setDragMotion(nextDragMotion);
    window.openmaPet.moveWindowTo(next);
  };

  const endPetDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPetDrag();
  };

  return (
    <main className={`pet-stage ${SHOW_DEBUG_BOXES ? "debug-boxes" : ""}`}>
      <section className={`pet-card mood-${state.mood} edge-${edgeMode}`}>
        <button
          className={`pet-shell surface-${edgeSurface} motion-${state.motion} edge-intensity-${atlas.intensity} ${isSidePeek ? "pet-shell-peek" : ""} ${isTopPeek ? "pet-shell-top" : ""} ${isBottomRest ? "pet-shell-bottom" : ""}`}
          type="button"
          aria-label="Mote pet"
          title={state.navigationUrl ? "Open related session" : "Mote"}
          onClick={openTarget}
          onPointerEnter={previewHover}
          onPointerDown={startPetDrag}
          onPointerMove={movePetDrag}
          onPointerUp={endPetDrag}
          onPointerCancel={endPetDrag}
          onLostPointerCapture={endPetDrag}
          style={{
            "--atlas-url": `url(${moteSpritesheet})`,
            "--atlas-row": atlas.row,
            "--atlas-frames": atlas.frames,
            "--atlas-duration": `${atlas.durationMs}ms`,
            "--bottom-rest-url": `url(${bottomRestStrip})`,
            "--peek-url": `url(${edgePeekStrip})`,
            ...sizeVars,
          } as React.CSSProperties}
        >
          {harnessEventCount > 0 ? (
            <span className="pet-event-count" aria-label={`${harnessEventCount} harness events`}>
              {harnessEventCount}
            </span>
          ) : null}
          {lastHarnessEvent ? (
            <span className={`pet-event-badge priority-${state.priority}`}>
              <span className="pet-event-source">{lastHarnessEvent.harness}</span>
              <span className="pet-event-name">{lastHarnessEvent.label ?? lastHarnessEvent.event}</span>
              {state.navigationUrl ? <span className="pet-event-link">go</span> : null}
            </span>
          ) : null}
          <span
            className={
              visualLayer === "side-peek-strip"
                ? "pet-peek"
                : visualLayer === "bottom-rest-strip"
                  ? "pet-bottom-rest"
                  : "pet-sprite"
            }
            data-animated={animateSprite || isTopPeek ? "true" : "false"}
          />
        </button>
      </section>
    </main>
  );
}
