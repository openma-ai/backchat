import {expect,test} from './fixtures';
import {injectSession} from './helpers';

test('navigation and session ink is stronger than structural headings',async({page,app})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 await injectSession(page,{sessionId:'ink-idle',cwd:'/tmp/ink-project'});
 await injectSession(page,{sessionId:'ink-active',cwd:'/tmp/ink-project'});
 await page.mouse.move(900,600);
 const colors=await page.evaluate(()=>{
  const probe=document.createElement('span');document.body.append(probe);probe.style.color='var(--fg-muted)';const muted=getComputedStyle(probe).color;probe.remove();
  const color=(q:string)=>getComputedStyle(document.querySelector(q)!).color;
  return {muted,session:color('.sidebar-grid-row[data-session-id="ink-idle"]'),nav:color('.sidebar-new-chat-primary'),scheduled:color('a.sidebar-grid-row[href*="scheduled"]'),project:color('[data-sidebar-project]')};
 });
 expect(colors.session).toBe(colors.muted);
 expect(colors.nav).toBe(colors.muted);
 expect(colors.scheduled).toBe(colors.muted);
 expect(colors.project).not.toBe(colors.muted);
});
