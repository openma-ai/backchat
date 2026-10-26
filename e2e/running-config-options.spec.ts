import { expect, test } from './fixtures';
import { enableAgent, injectEvent, injectSession } from './helpers';

test('running session can change approvals, model and reasoning without ending its prompt', async ({ page, app, bridge }) => {
  const options = [
    { id: 'mode', name: 'Session mode', category: 'mode', type: 'select', currentValue: 'agent', options: [{value:'read-only',name:'Ask for approval'}, {value:'agent',name:'Approve for me'}] },
    { id:'model', name:'Model', category:'model', type:'select', currentValue:'model-a', options:[{value:'model-a',name:'Model A'}, {value:'model-b',name:'Model B'}] },
    { id:'effort', name:'Reasoning', category:'thought_level', type:'select', currentValue:'medium', options:[{value:'medium',name:'Medium'}, {value:'high',name:'High'}] },
  ];
  await bridge.setAgentSetupFixture({agents:[{id:'codex-acp',label:'Codex',command:'codex-acp',detected:true,available:true,installed:true}]});
  await enableAgent(page,'codex-acp');
  await app.evaluate(({ipcMain}) => { ipcMain.removeHandler('session:start'); ipcMain.handle('session:start',()=>({})); ipcMain.removeHandler('session:setConfigOption'); ipcMain.handle('session:setConfigOption',(_, value)=>{ (globalThis as any).__runningConfigCalls ??= []; (globalThis as any).__runningConfigCalls.push(value); }); });
  const id=await injectSession(page,{sessionId:'running-config',agentId:'codex-acp'});
  const config=()=>injectEvent(page,{type:'session.event',session_id:id,event:{sessionUpdate:'config_option_update',configOptions:options}});
  await config();
  await injectEvent(page,{type:'session.event',session_id:id,turn_id:'running-turn',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Working'}}});
  await injectEvent(page,{type:'session.queue_update',session_id:id,mode:'single',active_turn_id:'running-turn',queued:[]});
  const approvals=page.getByRole('button',{name:'Approve for me',exact:true});
  await expect(approvals).toBeEnabled();
  await approvals.click();
  await page.getByRole('menuitem',{name:/Ask for approval/}).click();
  await expect.poll(()=>app.evaluate(()=> (globalThis as any).__runningConfigCalls)).toContainEqual({session_id:id,config_id:'mode',value:'read-only'});
  options[0]!.currentValue='read-only'; await config();
  await expect(page.getByRole('button',{name:'Ask for approval',exact:true})).toBeEnabled();
  const run=page.locator('button[aria-label^="Run on "]').first();
  await expect(run).toBeEnabled();
  for (const [label,value,configId] of [['Model','Model B','model'],['Reasoning','High','effort']]) {
    await run.click();
    const submenu=page.getByRole('menuitem').filter({hasText:label === 'Reasoning' ? /Reasoning|Effort/ : /^Model/}).first();
    await submenu.click();
    const panel=page.getByTestId('composer-select-menu-panel');
    await expect(panel).toBeVisible();
    const command=panel.locator('[cmdk-root]');
    await command.focus();
    await command.press('ArrowDown');
    await command.press('Enter');
    await expect.poll(()=>app.evaluate(()=> (globalThis as any).__runningConfigCalls)).toContainEqual({session_id:id,config_id:configId,value:configId==='model'?'model-b':'high'});
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  await expect(page.locator('[data-turn-id="running-turn"]')).toHaveAttribute('data-session-turn-status','running');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
});
