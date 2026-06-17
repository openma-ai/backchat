import { assign, createActor, setup, type ActorRefFrom } from "xstate";
import {
  computeAttachmentSnappedBounds,
  computeDetachedBounds,
  computeEdgeAttachment,
  resolveLatchedAttachment,
  type EdgeAttachment,
  type Rect,
} from "./edge-geometry";

export type DisplayGeometry = {
  bounds: Rect;
  workArea: Rect;
  dockBounds?: Rect;
};

export type PetWindowState =
  | { kind: "free" }
  | { kind: "dragging" }
  | { kind: "attached"; attachment: EdgeAttachment };

export type PetWindowCommand = {
  state: PetWindowState;
  attachment: EdgeAttachment;
  bounds: Rect | null;
};

type MachineContext = {
  attachment: EdgeAttachment;
};

type MachineEvent =
  | { type: "SYNC"; bounds: Rect; display: DisplayGeometry }
  | { type: "DRAG_START"; bounds: Rect; display: DisplayGeometry }
  | { type: "DRAG_END"; bounds: Rect; display: DisplayGeometry };

const NONE_ATTACHMENT: EdgeAttachment = { mode: "none", surface: "screen" };

const petWindowMachine = setup({
  types: {} as {
    context: MachineContext;
    events: MachineEvent;
  },
  guards: {
    hasComputedAttachment: ({ event }) =>
      computeDisplayEdgeAttachment(event.bounds, event.display).mode !== "none",
  },
  actions: {
    clearAttachment: assign({
      attachment: () => NONE_ATTACHMENT,
    }),
    assignComputedAttachment: assign({
      attachment: ({ event }) => computeDisplayEdgeAttachment(event.bounds, event.display),
    }),
    latchOrAssignComputedAttachment: assign({
      attachment: ({ context, event }) =>
        resolveLatchedAttachment(
          context.attachment,
          computeDisplayEdgeAttachment(event.bounds, event.display),
        ),
    }),
  },
}).createMachine({
  id: "petWindow",
  context: {
    attachment: NONE_ATTACHMENT,
  },
  initial: "free",
  states: {
    free: {
      on: {
        SYNC: [
          {
            guard: "hasComputedAttachment",
            target: "attached",
            actions: "assignComputedAttachment",
          },
          { actions: "clearAttachment" },
        ],
        DRAG_START: {
          target: "dragging",
          actions: "assignComputedAttachment",
        },
      },
    },
    attached: {
      on: {
        SYNC: {
          actions: "latchOrAssignComputedAttachment",
        },
        DRAG_START: {
          target: "dragging",
          actions: "clearAttachment",
        },
      },
    },
    dragging: {
      on: {
        SYNC: {},
        DRAG_END: [
          {
            guard: "hasComputedAttachment",
            target: "attached",
            actions: "assignComputedAttachment",
          },
          {
            target: "free",
            actions: "clearAttachment",
          },
        ],
      },
    },
  },
});

type PetWindowActor = ActorRefFrom<typeof petWindowMachine>;

export function createPetWindowStateMachine(initialState: PetWindowState = { kind: "free" }) {
  const actor = createActor(petWindowMachine).start();
  seedActor(actor, initialState);

  return {
    sync(bounds: Rect, display: DisplayGeometry): PetWindowCommand {
      actor.send({ type: "SYNC", bounds, display });
      return commandFromSnapshot(actor, bounds, display, "sync");
    },
    startDrag(bounds: Rect, display: DisplayGeometry): PetWindowCommand {
      const previousAttachment = stateFromSnapshot(actor).kind === "attached"
        ? actor.getSnapshot().context.attachment
        : computeDisplayEdgeAttachment(bounds, display);
      actor.send({ type: "DRAG_START", bounds, display });
      return {
        state: stateFromSnapshot(actor),
        attachment: NONE_ATTACHMENT,
        bounds: computeDetachedBounds(bounds, previousAttachment, display.bounds),
      };
    },
    finishDrag(bounds: Rect, display: DisplayGeometry): PetWindowCommand {
      actor.send({ type: "DRAG_END", bounds, display });
      return commandFromSnapshot(actor, bounds, display, "snap");
    },
    state(): PetWindowState {
      return stateFromSnapshot(actor);
    },
  };
}

export function syncPetWindowState(
  state: PetWindowState,
  bounds: Rect,
  display: DisplayGeometry,
): PetWindowCommand {
  return createPetWindowStateMachine(state).sync(bounds, display);
}

export function startPetWindowDrag(
  state: PetWindowState,
  bounds: Rect,
  display: DisplayGeometry,
): PetWindowCommand {
  return createPetWindowStateMachine(state).startDrag(bounds, display);
}

export function finishPetWindowDrag(bounds: Rect, display: DisplayGeometry): PetWindowCommand {
  return createPetWindowStateMachine({ kind: "dragging" }).finishDrag(bounds, display);
}

function commandFromSnapshot(
  actor: PetWindowActor,
  bounds: Rect,
  display: DisplayGeometry,
  reason: "sync" | "snap",
): PetWindowCommand {
  const state = stateFromSnapshot(actor);
  const attachment = state.kind === "attached" ? state.attachment : NONE_ATTACHMENT;
  if (state.kind === "dragging") {
    return { state, attachment: NONE_ATTACHMENT, bounds: null };
  }
  return {
    state,
    attachment,
    bounds: reason === "sync" && attachment.mode === "none"
      ? null
      : computeAttachmentSnappedBounds(bounds, attachment, display.workArea, display.bounds, display.dockBounds),
  };
}

function computeDisplayEdgeAttachment(bounds: Rect, display: DisplayGeometry): EdgeAttachment {
  return computeEdgeAttachment(bounds, display.workArea, display.bounds, display.dockBounds);
}

function stateFromSnapshot(actor: PetWindowActor): PetWindowState {
  const snapshot = actor.getSnapshot();
  if (snapshot.matches("dragging")) return { kind: "dragging" };
  if (snapshot.matches("attached")) return { kind: "attached", attachment: snapshot.context.attachment };
  return { kind: "free" };
}

function seedActor(actor: PetWindowActor, state: PetWindowState): void {
  if (state.kind === "free") return;
  if (state.kind === "dragging") {
    actor.send({
      type: "DRAG_START",
      bounds: { x: 99, y: 99, width: 1, height: 1 },
      display: { bounds: { x: 0, y: 0, width: 1, height: 1 }, workArea: { x: 0, y: 0, width: 1, height: 1 } },
    });
    return;
  }
  actor.send({
    type: "SYNC",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    display: { bounds: { x: 0, y: 0, width: 1, height: 1 }, workArea: { x: 0, y: 0, width: 1, height: 1 } },
  });
  actor.getSnapshot().context.attachment = state.attachment;
}
