import {expect,test} from './fixtures';
import {injectSession} from './helpers';

test('project text and child icon share a rail; glyph stays inside its track',async({page,app,capture})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));ipcMain.removeHandler('workspaces:list');ipcMain.handle('workspaces:list',()=>[{id:'track-worktree',project_id:null,name:'Track branch',kind:'managed',branch:'track',roots:[{sourcePath:'/tmp/track-project',effectivePath:'/tmp/track-tree',worktreeIndex:0}],worktrees:[{repoRoot:'/tmp/track-project',path:'/tmp/track-tree',head:'abc',branch:'track'}],created_by_session_id:null,created_at:1,updated_at:1}]);});
 await page.reload();
 await injectSession(page,{sessionId:'track-codex',agentId:'codex-acp',cwd:'/tmp/track-project'});
 await injectSession(page,{sessionId:'track-pi',agentId:'pi-acp',cwd:'/tmp/track-project'});
 const project=page.locator('[data-sidebar-project]').filter({hasText:'track-project'}).first();
 const labelX=await project.locator('[data-sidebar-grid="label"]').evaluate(el=>el.getBoundingClientRect().left);
 for(const id of ['track-codex','track-pi']){
  const row=page.locator(`.sidebar-grid-row[data-session-id="${id}"]`);
  const box=await row.evaluate(el=>{
   const icon=el.querySelector('[data-sidebar-grid="icon"]')!;
   const glyph=icon.querySelector('svg,[role="img"]')!;
   const label=el.querySelector('[data-sidebar-grid="label"]')!;
   const a=icon.getBoundingClientRect(),b=glyph.getBoundingClientRect(),c=label.getBoundingClientRect();
   return {iconX:a.left,iconWidth:a.width,glyphX:b.left,glyphWidth:b.width,labelX:c.left};
  });

  expect(Math.abs(box.iconX-labelX)).toBeLessThan(0.75);
  expect(box.glyphWidth).toBeLessThanOrEqual(box.iconWidth);
  expect(box.glyphX+box.glyphWidth).toBeLessThan(box.labelX);
 }
 const workspace=page.locator('[data-sidebar-workspace="track-worktree"]');
 await expect(workspace).toBeVisible();
 const branchTextX=await workspace.locator('[data-sidebar-grid="label"] button > span:last-child').evaluate(el=>el.getBoundingClientRect().left);
 const sessionTextX=await page.locator('.sidebar-grid-row[data-session-id="track-codex"] [data-sidebar-grid="label"]').evaluate(el=>el.getBoundingClientRect().left);
 expect(Math.abs(branchTextX-sessionTextX)).toBeLessThan(0.75);
 await capture('sidebar-track-continuity.png');
});
