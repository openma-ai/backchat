import {expect,test} from './fixtures';
import {injectEvent,injectSession} from './helpers';
test('injected user message stays visible outside collapsed process without reordering',async({page,app})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 const id=await injectSession(page,{sessionId:'steer-collapse'});
 const send=(event:Record<string,unknown>)=>injectEvent(page,{type:'session.event',session_id:id,turn_id:'parent',event});
 await send({sessionUpdate:'tool_call',toolCallId:'before',title:'Before input',kind:'read',status:'completed'});
 await injectEvent(page,{type:'session.queue_update',session_id:id,mode:'single',active_turn_id:'parent',queued:[]});
 const event={schema_version:'oma.event.v1',event_id:'input',session_id:id,turn_id:'input',occurred_at:new Date().toISOString(),source:{kind:'user'},type:'user.message',data:{text:'User input must stay visible',input_kind:'steering',outcome:'injected',active_turn_id:'parent'}};
 await injectEvent(page,{type:'session.steering',session_id:id,turn_id:'input',active_turn_id:'parent',outcome:'injected',text:'User input must stay visible',requested_delivery:'llm_boundary',effective_delivery:'llm_boundary',openma_event:event});
 const liveTurn=page.locator('[data-turn-id="parent"]');
 const liveInput=liveTurn.getByText('User input must stay visible',{exact:true});
 const liveFallback=liveTurn.locator('[data-thinking-fallback]');
 await expect(liveFallback).toHaveCount(1);
 expect(await liveFallback.evaluate(el=>!!el.closest('[data-collapsible-event-count]'))).toBe(false);
 expect((await liveFallback.boundingBox())!.y).toBeGreaterThan((await liveInput.boundingBox())!.y);
 await send({sessionUpdate:'tool_call',toolCallId:'after',title:'After input',kind:'read',status:'completed'});
 await expect(liveTurn.locator('[data-chat-reasoning-trigger]')).toHaveCount(1);
 await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Final answer'}});
 await injectEvent(page,{type:'session.complete',session_id:id,turn_id:'parent',stop_reason:'end_turn'});
 const turn=page.locator('[data-turn-id="parent"]');
 await expect(turn.locator('[data-chat-reasoning-trigger]')).toHaveCount(1);
 const message=turn.getByText('User input must stay visible',{exact:true});
 expect(await message.evaluate(el=>!!el.closest('[data-session-process-state]'))).toBe(false);
 for(const trigger of await turn.locator('[data-chat-reasoning-trigger]').all()){if(await trigger.getAttribute('aria-expanded')==='true')await trigger.click();}
 for(const section of await turn.locator('[data-session-process-state]').all()) await expect(section).toHaveAttribute('data-state','closed');
 await turn.locator('[data-chat-reasoning-trigger]').click();
 for(const section of await turn.locator('[data-session-process-state]').all()) await expect(section).toHaveAttribute('data-state','open');
 await expect(message).toBeVisible();
 await turn.locator('[data-chat-reasoning-trigger]').click();
 await expect(message).toBeVisible();
 await expect(page.locator('[data-turn-id="input"]')).toHaveCount(0);
 const order=await turn.evaluate(el=>Array.from(el.querySelectorAll('[data-session-process-state], [data-session-turn-prompt]')).map(e=>e.hasAttribute('data-session-process-state')?'process':'input'));
 expect(order).toEqual(['process','input','process']);
});

test('injected annotation-only input renders a reference instead of an internal placeholder',async({page,app})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 const id=await injectSession(page,{sessionId:'steer-annotation'});
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:'parent',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Before'}}});
 const event={schema_version:'oma.event.v1',event_id:'annotation-input',session_id:id,turn_id:'input',occurred_at:new Date().toISOString(),source:{kind:'user'},type:'user.message',data:{text:'[1 annotation]',input_kind:'steering',outcome:'injected',active_turn_id:'parent',annotations:[{id:'quote',source_session_id:id,source_turn_id:'parent',text:'Original quoted words',comment:'Why does this happen?'}]}};
 await injectEvent(page,{type:'session.steering',session_id:id,turn_id:'input',active_turn_id:'parent',text:'[1 annotation]',outcome:'injected',requested_delivery:'llm_boundary',effective_delivery:'llm_boundary',openma_event:event});
 await expect(page.getByText('[1 annotation]',{exact:true})).toHaveCount(0);
 const reference=page.locator('[data-session-turn-prompt] button').filter({hasText:/annotation|批注/i}).first();
 await expect(reference).toBeVisible();await reference.click();
 await expect(page.getByText('Original quoted words',{exact:true})).toBeVisible();
 await expect(page.getByText('Why does this happen?',{exact:true})).toBeVisible();
});
