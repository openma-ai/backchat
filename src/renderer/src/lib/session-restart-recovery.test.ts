import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";

describe("history runtime reconciliation", () => {
  it("interrupts persisted unfinished work when the main process confirms no running prompt", () => {
    const store = new SessionStore();
    store.apply({type:"session.ready",session_id:"s",agent_id:"codex-acp",acp_session_id:"native",cwd:"/repo"});
    store.registerTurn("old", "s", "Unfinished");
    store.apply({type:"session.queue_update",session_id:"s",mode:"single",active_turn_id:"old",queued:[]});
    store.reconcileHistoryRuntime("s", ["old"], false);
    expect(store.turnsFor("s")[0]).toMatchObject({status:"cancelled",stopReason:"interrupted"});
    expect(store.get("s")).toMatchObject({status:"ready",activeTurnId:undefined});
  });
  it("does not keep an orphan alive just because a different prompt is busy", () => {
    const store = new SessionStore();
    store.apply({type:"session.ready",session_id:"s",agent_id:"codex-acp",acp_session_id:"native",cwd:"/repo"});
    store.registerTurn("old", "s", "Orphan");
    store.registerTurn("new", "s", "Live");
    store.reconcileHistoryRuntime("s", ["old", "new"], true, ["new"]);
    expect(store.turnsFor("s").find(t=>t.id==="old")?.stopReason).toBe("interrupted");
    expect(store.turnsFor("s").find(t=>t.id==="new")?.status).not.toBe("cancelled");
  });
  it("keeps work that survived a renderer reload and does not cancel a new send racing history", () => {
    const store = new SessionStore();
    store.apply({type:"session.ready",session_id:"s",agent_id:"codex-acp",acp_session_id:"native",cwd:"/repo"});
    store.registerTurn("old", "s", "Unfinished");
    store.reconcileHistoryRuntime("s", ["old"], true);
    expect(store.turnsFor("s")[0]?.status).toBe("running");
    store.registerTurn("new", "s", "New send");
    store.apply({type:"session.queue_update",session_id:"s",mode:"single",active_turn_id:"new",queued:[]});
    store.reconcileHistoryRuntime("s", ["old"], false);
    expect(store.turnsFor("s").find(t=>t.id==="new")?.status).toBe("running");
    expect(store.get("s")?.activeTurnId).toBe("new");
  });
});
