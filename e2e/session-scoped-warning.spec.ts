import {expect,test} from './fixtures';
import {injectSession,injectEvent} from './helpers';
test('ownerless diagnostic text is a session notice not a phantom running answer',async({page,app})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 const id=await injectSession(page,{sessionId:'warning-not-turn'});
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:'done',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Completed answer'}}});
 await injectEvent(page,{type:'session.complete',session_id:id,turn_id:'done',stop_reason:'end_turn'});
 const warning="Warning: Codex couldn't save diagnostic logs to its local database.";
 const event={schema_version:'oma.event.v1',event_id:'warning',session_id:id,turn_id:'',occurred_at:new Date().toISOString(),source:{kind:'harness',harness:'codex-acp'},type:'agent.message_chunk',data:{text:warning,content:{type:'text',text:warning}}};
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:'',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:warning}},openma_event:event});
 await expect(page.getByText(warning,{exact:true})).toBeVisible();
 await expect(page.locator('[data-turn-id=""]')).toHaveCount(0);
 await expect(page.locator('[data-thinking-fallback]')).toHaveCount(0);
 await expect(page.locator('[data-turn-id="done"]')).not.toContainText(warning);
 await expect(page.locator('[data-turn-id="done"]')).toHaveAttribute('data-session-turn-status','complete');
});
