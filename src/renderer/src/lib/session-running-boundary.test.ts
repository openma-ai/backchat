import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";
import { createOpenMAEvent } from "@openma/common/session-events/openma";

function readyStore() {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "session", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/repo" });
  return store;
}
function level(store: SessionStore, type: "session.running" | "session.idle", turnId: string) {
  store.apply({ type: "session.event", session_id: "session", turn_id: turnId, event: {}, openma_event: createOpenMAEvent({ event_id: `${type}:${turnId}`, session_id: "session", turn_id: turnId, type, source: { kind: "harness", harness: "codex-acp" }, occurred_at: "2026-10-23T06:51:18.000Z", data: { thread_status: { type: type === "session.running" ? "active" : "idle" } } }) });
}

describe("session running follows authoritative prompt boundaries", () => {
  it("does not resurrect a settled prompt from a late provider running snapshot", () => {
    const store = readyStore();
    store.registerTurn("old", "session", "Request");
    store.apply({ type: "session.complete", session_id: "session", turn_id: "old", stop_reason: "end_turn" });
    level(store, "session.running", "old");
    expect(store.get("session")?.status).toBe("ready");
    expect(store.turnsFor("session")[0]?.status).toBe("complete");
  });
  it("does not clear a new active prompt with idle from an older prompt", () => {
    const store = readyStore();
    store.registerTurn("old", "session", "First");
    store.apply({ type: "session.complete", session_id: "session", turn_id: "old", stop_reason: "end_turn" });
    store.registerTurn("new", "session", "Next");
    level(store, "session.idle", "old");
    expect(store.get("session")?.activeTurnId).toBe("new");
    expect(store.get("session")?.status).toBe("running");
  });
  it("keeps an unresolved prompt running through provider idle until its response", () => {
    const store = readyStore();
    store.registerTurn("live", "session", "Request");
    level(store, "session.idle", "live");
    expect(store.get("session")?.status).toBe("running");
    store.apply({ type: "session.complete", session_id: "session", turn_id: "live", stop_reason: "end_turn" });
    expect(store.get("session")?.status).toBe("ready");
  });
});

it("does not resurrect an injected steer or its completed parent from a late queue snapshot", () => {
  const store = readyStore();
  store.registerTurn("parent", "session", "Work");
  const input = createOpenMAEvent({ event_id: "steer", session_id: "session", turn_id: "steer", source: { kind: "user" }, occurred_at: "2026-10-23T06:51:18.000Z", type: "user.message", data: { text: "Change", input_kind: "steering", outcome: "injected", active_turn_id: "parent" } });
  store.apply({ type: "session.steering", session_id: "session", turn_id: "steer", active_turn_id: "parent", text: "Change", requested_delivery: "llm_boundary", effective_delivery: "llm_boundary", outcome: "injected", openma_event: input });
  store.apply({ type: "session.complete", session_id: "session", turn_id: "parent", stop_reason: "end_turn" });
  store.apply({ type: "session.queue_update", session_id: "session", mode: "single", active_turn_id: "parent", steering_turn_ids: ["steer"], queued: [] });
  expect(store.get("session")?.status).toBe("ready");
  expect(store.get("session")?.activeTurnId).toBeUndefined();
  expect(store.turnsFor("session").map(turn => turn.status)).toEqual(["complete"]);
});

it("a stale completed-parent queue snapshot cannot settle a newer active prompt", () => {
  const store = readyStore();
  store.registerTurn("old", "session", "First");
  store.apply({ type: "session.complete", session_id: "session", turn_id: "old", stop_reason: "end_turn" });
  store.registerTurn("new", "session", "Second");
  store.apply({ type: "session.queue_update", session_id: "session", mode: "single", active_turn_id: "old", queued: [] });
  expect(store.get("session")?.activeTurnId).toBe("new");
  expect(store.turnsFor("session").find(turn => turn.id === "new")?.status).toBe("running");
});

it('keeps a session-scoped diagnostic warning out of transcript and does not invent a turn', () => {
  const warning = "Warning: Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics.\n\n";
  const store = readyStore();
  store.registerTurn('done', 'session', 'Request');
  store.apply({type:'session.complete',session_id:'session',turn_id:'done',stop_reason:'end_turn'});
  const event = createOpenMAEvent({event_id:'diagnostic',session_id:'session',turn_id:'',source:{kind:'harness',harness:'codex-acp'},occurred_at:'2026-10-23T12:30:38.075Z',type:'agent.message_chunk',data:{text:warning,content:{type:'text',text:warning}}});
  store.apply({type:'session.event',session_id:'session',turn_id:'',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:warning}},openma_event:event});
  expect(store.turnsFor('session').map(turn=>turn.id)).toEqual(['done']);
  expect(store.get('session')).toMatchObject({status:'ready',notice:{message:warning.trim()}});
  expect(store.turnsFor('session')[0]?.assistantText).not.toContain('Warning:');
  const replay=readyStore();
  replay.replayHistory('session',[{seq:1,type:'openma_event',data:JSON.stringify(event),ts:1}]);
  expect(replay.turnsFor('session')).toHaveLength(0);
  expect(replay.get('session')?.notice?.message).toBe(warning.trim());
});

it('releases old model auth gate only after a different model is confirmed',()=>{
 const store=readyStore();
 const update=(value:string)=>store.apply({type:'session.event',session_id:'session',turn_id:'',event:{sessionUpdate:'config_option_update',configOptions:[{id:'model',category:'model',name:'Model',type:'select',currentValue:value,options:[{value:'openai-codex/gpt',name:'GPT'},{value:'anthropic-proxy/opus',name:'Opus'}]}]}});
 update('openai-codex/gpt');
 store.apply({type:'session.error',session_id:'session',message:'Authentication required',code:'auth_required'});
 update('openai-codex/gpt');expect(store.get('session')?.authRequired).toBe(true);
 update('anthropic-proxy/opus');expect(store.get('session')?.authRequired).toBe(false);
 expect(store.get('session')?.auth?.status).toBe('unknown');
 expect(store.get('session')?.authRetryAllowed).toBe(true);
});

it('routes a late ownerless tool completion to its existing turn without reopening it',()=>{
 const store=readyStore();store.registerTurn('done','session','Request');
 store.apply({type:'session.event',session_id:'session',turn_id:'done',event:{sessionUpdate:'tool_call',toolCallId:'late-tool',status:'in_progress',title:'Command',kind:'execute'}});
 store.apply({type:'session.complete',session_id:'session',turn_id:'done',stop_reason:'end_turn'});
 store.apply({type:'session.event',session_id:'session',turn_id:'',event:{sessionUpdate:'tool_call_update',toolCallId:'late-tool',status:'completed'}});
 expect(store.turnsFor('session').map(t=>[t.id,t.status])).toEqual([['done','complete']]);
 expect(store.projectTurn(store.turnsFor('session')[0]!).tools[0]?.status).toBe('completed');
 store.apply({type:'session.event',session_id:'session',turn_id:'',event:{sessionUpdate:'tool_call_update',toolCallId:'unknown',status:'completed'}});
 expect(store.turnsFor('session')).toHaveLength(1);
});

it('replays late ownerless tool completion under the original completed turn',()=>{
 const store=readyStore();
 const canonical=(id:string,type:string,turn_id:string,data:Record<string,unknown>)=>createOpenMAEvent({event_id:id,session_id:'session',turn_id,type,source:{kind:'harness',harness:'codex-acp'},occurred_at:'2026-10-25T07:40:00.000Z',data});
 const events=[canonical('prompt','user.message','done',{text:'Request',input_kind:'prompt'}),canonical('tool','tool.started','done',{tool_call_id:'late',status:'in_progress',title:'Command',kind:'execute'}),canonical('end','turn.completed','done',{stop_reason:'end_turn'}),canonical('patch','tool.completed','',{tool_call_id:'late',status:'completed',outcome:'ok'})];
 store.replayHistory('session',events.map((event,index)=>({seq:index+1,type:'openma_event',data:JSON.stringify(event),ts:index+1})));
 expect(store.turnsFor('session').map(t=>[t.id,t.status])).toEqual([['done','complete']]);
 expect(store.projectTurn(store.turnsFor('session')[0]!).tools[0]?.status).toBe('completed');
});
