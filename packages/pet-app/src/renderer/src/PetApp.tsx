import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStandalonePetController, type PetViewState } from "./pet-controller";
import type { PetHarnessEvent } from "./pet-harness";
import { dragMotionForDelta } from "./drag-motion";
import {
  EDGE_INTERACTION_SETTLE_MS,
  edgeInteractionClass,
  edgeIntensityForInteraction,
  nextEdgeInteraction,
  shouldAutoSettleEdgeInteraction,
  type EdgeInteraction,
} from "./edge-interaction";
import { shouldAnimateSprite, shouldAutoSettleMotion } from "./motion-playback";
import { isWorkMotion, presentationForState, runningFallbackAfterTransient } from "./pet-presentation";
import { visualLayerForEdgeMode } from "./pet-render-model";
import { cssSizeVars } from "./pet-size-model";
import bottomRestStrip from "./assets/mote-bottom-peek-strip.png";
import edgePeekLeftStrip from "./assets/mote-edge-peek-left-strip.png";
import edgePeekRightStrip from "./assets/mote-edge-peek-right-strip.png";
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
const SHOW_DEBUG_BOXES = false;

type HarnessEventItem = {
  id: string;
  event: PetHarnessEvent;
  label: string;
  navigationUrl?: string;
  sessionId?: string;
  turnId?: string;
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
  const [edgeInteraction, setEdgeInteraction] = useState<EdgeInteraction>("idle");
  const [dragMotion, setDragMotion] = useState<PetViewState["motion"] | null>(null);
  const [lastHarnessEvent, setLastHarnessEvent] = useState<PetHarnessEvent | null>(null);
  const [harnessEventCount, setHarnessEventCount] = useState(0);
  const [harnessEvents, setHarnessEvents] = useState<HarnessEventItem[]>([]);
  const [eventPanelOpen, setEventPanelOpen] = useState(false);
  const [eventPanelLayout, setEventPanelLayout] = useState<PetEventPanelLayout | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    startedWindowDrag: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const isSidePeek = edgeMode === "left" || edgeMode === "right";
  const isTopPeek = edgeMode === "top";
  const isBottomRest = edgeMode === "bottom";
  const atlas = presentationForState(
    isTopPeek ? { ...state, motion: "jumping" } : state,
    dragMotion,
  );
  const edgeIntensity = edgeIntensityForInteraction(edgeInteraction);
  const edgeInteractionStateClass = edgeInteractionClass(edgeInteraction);
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
    if (!isSidePeek || !shouldAutoSettleEdgeInteraction(edgeInteraction)) return;
    const timeout = window.setTimeout(() => {
      setEdgeInteraction((current) => nextEdgeInteraction(current, "settle"));
    }, EDGE_INTERACTION_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [edgeInteraction, isSidePeek]);

  useEffect(() => {
    if (isSidePeek) return;
    setEdgeInteraction((current) => nextEdgeInteraction(current, "detach"));
  }, [isSidePeek]);

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
        setEdgeInteraction((current) => nextEdgeInteraction(current, "attach"));
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
      const nextEvents = events.filter((item) => !matchesAck(item, ack));
      if (nextEvents.length === events.length) return events;
      setHarnessEventCount(Math.min(nextEvents.length, 99));
      setLastHarnessEvent((last) => last && matchesAck(last, ack) ? null : last);
      if (nextEvents.length === 0) {
        setEventPanelOpen(false);
        setEventPanelLayout(null);
        void window.openmaPet?.setEventPanelOpen(false);
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
    if (drag.startedWindowDrag) {
      window.openmaPet?.endWindowDrag();
    }
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
    if (isSidePeek) {
      setEdgeInteraction((current) => nextEdgeInteraction(current, "click"));
      return;
    }
    applyStates(controller.dispatchEvent("pet.clicked", { label: "hi" }));
    if (state.navigationUrl) {
      void openNavigationUrl(state.navigationUrl);
    }
  };

  const toggleEventPanel = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextClickRef.current = false;
    const next = !eventPanelOpen;
    if (!next) {
      setEventPanelOpen(false);
      setEventPanelLayout(null);
      void window.openmaPet?.setEventPanelOpen(false);
      return;
    }
    void window.openmaPet?.setEventPanelOpen(true).then((layout) => {
      if (!layout) return;
      setEventPanelLayout(layout);
      setEventPanelOpen(true);
    });
  };

  const closeEventPanel = () => {
    setEventPanelOpen(false);
    setEventPanelLayout(null);
    void window.openmaPet?.setEventPanelOpen(false);
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
          const ack = ackFromHarnessItem(item, "pet-card-opened");
          ackHarnessEvent(ack);
          window.openmaPet?.ackHarnessEvent(ack);
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
    if (isSidePeek) {
      setEdgeInteraction((current) => nextEdgeInteraction(current, "hover"));
      return;
    }
    applyStates(controller.dispatchEvent("pet.hovered", { label: "hi" }));
  };

  const endPreviewHover = () => {
    if (!isSidePeek) return;
    setEdgeInteraction((current) => current === "hover" ? nextEdgeInteraction(current, "settle") : current);
  };

  const startPetDrag = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !window.openmaPet) return;
    closeEventPanel();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = await window.openmaPet.getWindowBounds();
    setDragMotion(null);
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      offsetX: event.screenX - bounds.x,
      offsetY: event.screenY - bounds.y,
      moved: false,
      startedWindowDrag: false,
    };
  };

  const movePetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !window.openmaPet) return;
    const distance = Math.abs(event.screenX - drag.startScreenX) + Math.abs(event.screenY - drag.startScreenY);
    if (!drag.startedWindowDrag && distance <= 3) return;
    if (!drag.startedWindowDrag) {
      drag.moved = true;
      drag.startedWindowDrag = true;
      void window.openmaPet.startWindowDrag().then((bounds) => {
        const current = dragRef.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.offsetX = event.screenX - bounds.x;
        current.offsetY = event.screenY - bounds.y;
        window.openmaPet?.moveWindowTo({
          x: event.screenX - current.offsetX,
          y: event.screenY - current.offsetY,
        });
      });
      return;
    }
    const next = {
      x: event.screenX - drag.offsetX,
      y: event.screenY - drag.offsetY,
    };
    drag.moved = true;
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
      <section
        className={`pet-card mood-${state.mood} edge-${edgeMode} ${eventPanelOpen ? "has-event-panel" : ""}`}
        style={eventPanelLayout
          ? {
            "--event-pet-left": `${eventPanelLayout.pet.left}px`,
            "--event-pet-top": `${eventPanelLayout.pet.top}px`,
            "--event-panel-left": `${eventPanelLayout.panel.left}px`,
            "--event-panel-top": `${eventPanelLayout.panel.top}px`,
            "--event-panel-width": `${eventPanelLayout.panel.width}px`,
            "--event-panel-height": `${eventPanelLayout.panel.height}px`,
          } as React.CSSProperties
          : undefined}
      >
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
                  <div className="pet-event-card-copy">
                    <strong className="pet-event-card-title">{item.label}</strong>
                    <span className="pet-event-card-meta">{eventSummary(item)}</span>
                  </div>
                  <button
                    className="pet-event-card-dismiss"
                    type="button"
                    aria-label="Dismiss event"
                    onClick={(event) => dismissEventTarget(item.id, event)}
                  />
                </article>
              ))
            ) : (
              <div className="pet-event-empty">No recent events</div>
            )}
          </div>
        ) : null}
        <div
          className={`pet-shell surface-${edgeSurface} motion-${state.motion} edge-intensity-${isSidePeek ? edgeIntensity : atlas.intensity} ${isSidePeek ? `pet-shell-peek ${edgeInteractionStateClass}` : ""} ${isTopPeek ? "pet-shell-top" : ""} ${isBottomRest ? "pet-shell-bottom" : ""}`}
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
          onPointerLeave={endPreviewHover}
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
            "--peek-left-url": `url(${edgePeekLeftStrip})`,
            "--peek-right-url": `url(${edgePeekRightStrip})`,
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
  const sessionId = state?.sessionId ?? event.threadId ?? event.sessionId ?? "no-session";
  const turnId = state?.turnId ?? event.turnId;
  return {
    id: `${event.harness}:${sessionId}:${turnId ?? event.event}:${Date.now()}`,
    event,
    label: event.label ?? labelForHarnessEvent(event),
    navigationUrl: state?.navigationUrl,
    sessionId,
    turnId,
    priority: state?.priority ?? "normal",
    createdAt: Date.now(),
  };
}

function ackFromHarnessItem(item: HarnessEventItem, reason: string): PetAckEvent {
  return {
    harness: item.event.harness,
    sessionId: item.event.sessionId ?? item.sessionId,
    threadId: item.event.threadId ?? item.sessionId,
    turnId: item.event.turnId ?? item.turnId,
    reason,
  };
}

function matchesAck(item: HarnessEventItem | PetHarnessEvent, ack: PetAckEvent): boolean {
  const isItem = isHarnessEventItem(item);
  const event = isItem ? item.event : item;
  const itemSessionId = isItem ? item.sessionId : undefined;
  const itemTurnId = isItem ? item.turnId : undefined;
  if (event.harness !== ack.harness) return false;
  if (ack.turnId && (event.turnId ?? itemTurnId) !== ack.turnId) return false;
  const ackIds = [ack.sessionId, ack.threadId].filter(Boolean);
  const eventIds = [event.sessionId, event.threadId, itemSessionId].filter(Boolean);
  if (ackIds.length === 0 || eventIds.length === 0) return false;
  return ackIds.some((ackId) => eventIds.includes(ackId));
}

function isHarnessEventItem(value: HarnessEventItem | PetHarnessEvent): value is HarnessEventItem {
  return "createdAt" in value;
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

function eventSummary(item: HarnessEventItem): string {
  if (item.event.payload && typeof item.event.payload === "object") {
    const record = item.event.payload as Record<string, unknown>;
    const summary = record["summary"] ?? record["message"] ?? record["prompt"] ?? record["cwd"];
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return item.event.threadId ?? item.event.sessionId ?? item.event.event;
}
