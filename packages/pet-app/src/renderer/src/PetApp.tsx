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
const MAX_HARNESS_EVENT_ITEMS = 4;
const SHOW_DEBUG_BOXES = true;

type HarnessEventItem = {
  id: string;
  event: PetHarnessEvent;
  label: string;
  navigationUrl?: string;
  priority: PetViewState["priority"];
  createdAt: number;
};

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
  const [harnessEvents, setHarnessEvents] = useState<HarnessEventItem[]>([]);
  const [eventPanelOpen, setEventPanelOpen] = useState(false);
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
      const states = controller.dispatchHarnessEvent(event);
      applyStates(states);
      const nextState = states.at(-1);
      setHarnessEvents((events) => {
        const nextEvents = [
          harnessEventItemFromEvent(event, nextState),
          ...events,
        ].slice(0, MAX_HARNESS_EVENT_ITEMS);
        setHarnessEventCount(Math.min(nextEvents.length, 99));
        return nextEvents;
      });
    });
  }, [applyStates, controller]);

  const ackHarnessEvent = useCallback((ack: PetAckEvent) => {
    setHarnessEvents((events) => {
      const nextEvents = events.filter((item) => !matchesAck(item.event, ack));
      if (nextEvents.length === events.length) return events;
      setHarnessEventCount(Math.min(nextEvents.length, 99));
      setLastHarnessEvent((last) => last && matchesAck(last, ack) ? null : last);
      if (nextEvents.length === 0) {
        setEventPanelOpen(false);
        window.openmaPet?.setEventPanelOpen(false);
      }
      return nextEvents;
    });
  }, []);

  useEffect(() => {
    return window.openmaPet?.onAckEvent((event) => {
      ackHarnessEvent(event);
    });
  }, [ackHarnessEvent]);

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
      void openNavigationUrl(state.navigationUrl);
    }
  };

  const toggleEventPanel = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextClickRef.current = false;
    setEventPanelOpen((open) => {
      const next = !open;
      window.openmaPet?.setEventPanelOpen(next);
      return next;
    });
  };

  const closeEventPanel = () => {
    setEventPanelOpen(false);
    window.openmaPet?.setEventPanelOpen(false);
  };

  const openEventTarget = (
    item: HarnessEventItem,
    event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextClickRef.current = false;
    if (item.navigationUrl) {
      void openNavigationUrl(item.navigationUrl).then((opened) => {
        if (opened) {
          window.openmaPet?.ackHarnessEvent(ackFromHarnessItem(item, "pet-card-opened"));
        }
      });
      closeEventPanel();
    }
  };

  const dismissEventTarget = (itemId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHarnessEvents((events) => {
      const nextEvents = events.filter((item) => item.id !== itemId);
      setHarnessEventCount(Math.min(nextEvents.length, 99));
      if (nextEvents.length === 0) setLastHarnessEvent(null);
      return nextEvents;
    });
  };

  const previewHover = () => {
    if (dragRef.current) return;
    applyStates(controller.dispatchEvent("pet.hovered", { label: "hi" }));
  };

  const startPetDrag = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !window.openmaPet) return;
    closeEventPanel();
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

  const movePetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
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

  const endPetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPetDrag();
  };

  return (
    <main className={`pet-stage ${SHOW_DEBUG_BOXES ? "debug-boxes" : ""}`}>
      <section className={`pet-card mood-${state.mood} edge-${edgeMode} ${eventPanelOpen ? "has-event-panel" : ""}`}>
        {eventPanelOpen ? (
          <div className="pet-event-panel" role="dialog" aria-label="Harness events">
            <button
              className="pet-event-panel-close"
              type="button"
              aria-label="Close events"
              onClick={(event) => {
                event.stopPropagation();
                closeEventPanel();
              }}
            >
              ×
            </button>
            {harnessEvents.length > 0 ? (
              harnessEvents.map((item) => (
                <article
                  key={item.id}
                  className={`pet-event-card priority-${item.priority}`}
                  role={item.navigationUrl ? "button" : "article"}
                  tabIndex={item.navigationUrl ? 0 : undefined}
                  onClick={(event) => openEventTarget(item, event)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openEventTarget(item, event);
                    }
                  }}
                >
                  <button
                    className="pet-event-card-dismiss"
                    type="button"
                    aria-label="Dismiss event"
                    onClick={(event) => dismissEventTarget(item.id, event)}
                  >
                    ×
                  </button>
                  <span className="pet-event-card-source">{item.event.harness}</span>
                  <strong className="pet-event-card-title">{item.label}</strong>
                  <span className="pet-event-card-meta">
                    {item.event.sessionId ?? item.event.threadId ?? item.event.event}
                  </span>
                </article>
              ))
            ) : (
              <div className="pet-event-empty">No recent events</div>
            )}
          </div>
        ) : null}
        <div
          className={`pet-shell surface-${edgeSurface} motion-${state.motion} edge-intensity-${atlas.intensity} ${isSidePeek ? "pet-shell-peek" : ""} ${isTopPeek ? "pet-shell-top" : ""} ${isBottomRest ? "pet-shell-bottom" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Mote pet"
          title={state.navigationUrl ? "Open related session" : "Mote"}
          onClick={openTarget}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openTarget();
            }
          }}
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
            <button
              className="pet-event-count"
              type="button"
              aria-label={
                state.navigationUrl
                  ? `Open latest harness event, ${harnessEventCount} total`
                  : `${harnessEventCount} harness events`
              }
              title={state.navigationUrl ? "Open latest event" : "Harness events"}
              onClick={toggleEventPanel}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {harnessEventCount}
            </button>
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
        </div>
      </section>
    </main>
  );
}

async function openNavigationUrl(url: string): Promise<boolean> {
  const result = await window.openmaPet?.openNavigationUrl(url);
  if (result && !result.ok) {
    console.warn("[pet-navigation]", { url, error: result.error });
    return false;
  }
  return result?.ok !== false;
}

function harnessEventItemFromEvent(event: PetHarnessEvent, state?: PetViewState): HarnessEventItem {
  const sessionId = event.threadId ?? event.sessionId ?? "no-session";
  return {
    id: `${event.harness}:${sessionId}:${event.turnId ?? event.event}:${Date.now()}`,
    event,
    label: event.label ?? labelForHarnessEvent(event),
    navigationUrl: state?.navigationUrl,
    priority: state?.priority ?? "normal",
    createdAt: Date.now(),
  };
}

function ackFromHarnessItem(item: HarnessEventItem, reason: string): PetAckEvent {
  return {
    harness: item.event.harness,
    sessionId: item.event.sessionId,
    threadId: item.event.threadId,
    turnId: item.event.turnId,
    reason,
  };
}

function matchesAck(event: PetHarnessEvent, ack: PetAckEvent): boolean {
  if (event.harness !== ack.harness) return false;
  if (ack.turnId && event.turnId !== ack.turnId) return false;
  const ackIds = [ack.sessionId, ack.threadId].filter(Boolean);
  const eventIds = [event.sessionId, event.threadId].filter(Boolean);
  if (ackIds.length === 0 || eventIds.length === 0) return false;
  return ackIds.some((ackId) => eventIds.includes(ackId));
}

function labelForHarnessEvent(event: PetHarnessEvent): string {
  switch (event.event) {
    case "task.completed":
    case "message.completed":
    case "turn.completed":
    case "Stop":
      return "完成";
    case "task.failed":
    case "error":
    case "StopFailure":
      return "失败";
    case "approval.requested":
    case "permission.requested":
    case "PermissionRequest":
      return "需要审批";
    case "waiting":
    case "input.required":
    case "Notification":
      return "需要你";
    default:
      return event.event;
  }
}
