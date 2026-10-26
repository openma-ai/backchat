import {expect,test} from './fixtures';
import {enableAgent,injectSession,injectEvent} from './helpers';
test('confirmed Pi provider change releases stale Codex auth gate without claiming login succeeded',async({page,app,bridge})=>{
 await bridge.setAgentSetupFixture({agents:[{id:'pi-acp',label:'Pi',command:'pi-acp',detected:true,available:true,installed:true}]});await enableAgent(page,'pi-acp');
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({status:'ready'}));ipcMain.removeHandler('session:prompt');ipcMain.handle('session:prompt',(_,p)=>{(globalThis as any).__retryPrompt=p;});});
 const id=await injectSession(page,{sessionId:'pi-recovery',agentId:'pi-acp'});
 const config=(value:string)=>injectEvent(page,{type:'session.event',session_id:id,turn_id:'',event:{sessionUpdate:'config_option_update',configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:value,options:[{value:'openai-codex/gpt-6.1-sol',name:'GPT'},{value:'anthropic-proxy/claude-opus-5-5',name:'Opus 5.5'}]}]}});
 await config('openai-codex/gpt-6.1-sol');
 await injectEvent(page,{type:'session.error',session_id:id,message:'Authentication required: OAuth refresh failed for openai-codex',code:'auth_required'});
 await config('anthropic-proxy/claude-opus-5-5');
 const input=page.getByRole('textbox');await input.fill('Retry with selected Opus');
 const send=page.getByRole('button',{name:'Send (Enter)',exact:true});await expect(send).toBeEnabled();await send.click();
 await expect.poll(()=>app.evaluate(()=>(globalThis as any).__retryPrompt?.text)).toBe('Retry with selected Opus');
});
