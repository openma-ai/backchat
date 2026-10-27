import {expect,test} from './fixtures';
import {injectEvent,injectSession} from './helpers';

test('prompt DOM remains stable through first output and completion',async({page,app,capture})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({status:'ready'}));});
 const id=await injectSession(page,{sessionId:'scroll-continuity'});
 const turnId='stable-turn';
 await injectEvent(page,{type:'session.steering',session_id:id,turn_id:turnId,outcome:'startedNewTurn',text:'Keep this message stable',openma_event:{schema_version:'oma.event.v1',event_id:'sent',session_id:id,turn_id:turnId,occurred_at:new Date().toISOString(),source:{kind:'user'},type:'user.message',data:{text:'Keep this message stable',input_kind:'steering',outcome:'startedNewTurn'}}});
 const prompt=page.locator(`[data-turn-id="${turnId}"] [data-session-turn-prompt]`);
 await expect(prompt).toBeVisible();
 await prompt.evaluate(el=>{(window as any).__sentPromptNode=el;});
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:turnId,event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Response started'}}});
 expect(await prompt.evaluate(el=>el===(window as any).__sentPromptNode)).toBe(true);
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:turnId,event:{sessionUpdate:'tool_call',toolCallId:'read',title:'Read',kind:'read',status:'completed'}});
 await injectEvent(page,{type:'session.complete',session_id:id,turn_id:turnId,stop_reason:'end_turn'});
 expect(await prompt.evaluate(el=>el===(window as any).__sentPromptNode)).toBe(true);
 await expect(page.locator(`[data-turn-id="${turnId}"] [data-chat-reasoning-trigger]`).first()).toHaveAttribute('aria-expanded','false');
 await capture('stable-message-completed.png');
});
