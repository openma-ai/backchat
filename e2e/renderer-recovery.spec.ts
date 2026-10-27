import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,test} from './fixtures';

test('a real renderer crash reloads the GUI without stopping or resending a running prompt',async({page,app,home})=>{
 const id=randomUUID();
 const result=await page.evaluate(async({id,cwd,node,agent})=>{
  await window.backchat.settingsPatch({agents:[{id:'codex-acp',enabled:true,command_override:node,args_override:[agent],env:[]}]});
  return window.backchat.sessionStart({session_id:id,agent_id:'codex-acp',cwd});
 },{id,cwd:home,node:process.execPath,agent:resolve('e2e/fixtures/fake-acp-agent.mjs')});
 expect(result.status).toBe('ready');
 await page.evaluate(id=>{void window.backchat.sessionPrompt({session_id:id,turn_id:'keep-running',text:'stall-until-cancelled-e2e'});},id);
 await expect.poll(()=>page.evaluate(id=>window.backchat.sessionRuntimeStatus({session_id:id}),id)).toMatchObject({busy:true});
 const mainPid=app.process().pid;
 await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0]!.webContents;(globalThis as any).__recoveryEvents=[];wc.on('render-process-gone',(_,d)=>(globalThis as any).__recoveryEvents.push(d));wc.on('did-finish-load',()=>(globalThis as any).__recoveryEvents.push('loaded'));});
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer();});
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>({events:(globalThis as any).__recoveryEvents,url:BrowserWindow.getAllWindows()[0]?.webContents.getURL()})),{timeout:20_000}).toMatchObject({events:expect.arrayContaining(['loaded'])});
 await expect.poll(()=>app.evaluate(async({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript('!!document.querySelector("[data-testid=new-chat-button]")')),{timeout:20_000}).toBe(true);
 expect(app.process().pid).toBe(mainPid);
 await expect.poll(()=>app.evaluate(async({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(`window.backchat.sessionRuntimeStatus({session_id:${JSON.stringify(id)}})`),id)).toMatchObject({busy:true});
 await app.evaluate(async({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(`window.backchat.sessionCancel({session_id:${JSON.stringify(id)},turn_id:'keep-running'})`),id);
});
