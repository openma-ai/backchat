import { describe, expect, it } from "vitest";
import { isRestartableAgentInterruption } from "./agent-interruption";
import { SessionStore } from "./session-store";
import { createOpenMAEvent } from "@openma/common/session-events/openma";

const details = {code:1001,message:"arbitrary",data:{exitCode:0,signal:null,restartable:true}};
describe("typed agent process interruption", () => {
  it("uses Codex process-exit code and restartability, never exit code or wording alone", () => {
    expect(isRestartableAgentInterruption("codex-acp", details)).toBe(true);
    expect(isRestartableAgentInterruption("pi-acp", details)).toBe(false);
    expect(isRestartableAgentInterruption("codex-acp", {...details,code:-32603})).toBe(false);
    expect(isRestartableAgentInterruption("codex-acp", {...details,data:{restartable:false}})).toBe(false);
  });
  it("settles live and replay as interrupted without leaving an error gate or replaying a prompt", () => {
    const event = createOpenMAEvent({event_id:"exit",type:"session.error",session_id:"s",turn_id:"t",source:{kind:"harness",harness:"codex-acp"},occurred_at:"2026-10-25T14:00:10Z",data:{message:"arbitrary",error_details:details}});
    const live = new SessionStore();
    live.apply({type:"session.ready",session_id:"s",agent_id:"codex-acp",cwd:"/repo",acp_session_id:"native"});
    live.registerTurn("t","s","Work");
    live.apply({type:"session.error",session_id:"s",turn_id:"t",message:"arbitrary",error_details:details,openma_event:event});
    expect(live.turnsFor("s")[0]).toMatchObject({status:"cancelled",stopReason:"interrupted",errorMessage:undefined});
    expect(live.get("s")).toMatchObject({status:"ready",lastError:undefined});
    const replay = new SessionStore();
    replay.apply({type:"session.ready",session_id:"s",agent_id:"codex-acp",cwd:"/repo",acp_session_id:"native"});
    const prompt = createOpenMAEvent({event_id:"input",type:"user.message",session_id:"s",turn_id:"t",source:{kind:"user"},occurred_at:"2026-10-25T13:40:00Z",data:{text:"Work",input_kind:"prompt"}});
    replay.replayHistory("s", [prompt,event].map((value,index)=>({seq:index+1,ts:index+1,type:"openma_event",data:JSON.stringify(value)})));
    expect(replay.turnsFor("s")[0]).toMatchObject({status:"cancelled",stopReason:"interrupted",errorMessage:undefined});
  });
});
