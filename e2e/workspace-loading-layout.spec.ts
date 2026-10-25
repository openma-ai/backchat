import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from './fixtures';

test('workspace pending indicator keeps the same single-line footer geometry', async ({page,app,home})=>{
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('workspaces:list');ipcMain.handle('workspaces:list',()=>new Promise(()=>{}));});
  const repo=join(home,'pending-repo');await mkdir(repo,{recursive:true});execFileSync('git',['init',repo]);
  await page.evaluate(async path=>{await window.backchat.projectSave({project_id:'pending',name:'Pending project',source_folders:[path],primary_folder:path});},repo);
  await page.reload();await page.getByTestId('new-chat-button').click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole('option',{name:'Pending project',exact:true}).click();
  const loading=page.locator('[data-composer-footer-control="workspace-loading"]');
  await expect(loading).toBeVisible();
  const geometry=await loading.evaluate(el=>{const icon=el.querySelector('svg')!.getBoundingClientRect();const text=el.querySelector('[data-loading-label]')?.getBoundingClientRect() ?? el.lastElementChild!.getBoundingClientRect();const project=document.querySelector('[data-composer-footer-control="project"]')!.getBoundingClientRect();const box=el.getBoundingClientRect();return {display:getComputedStyle(el).display,nowrap:getComputedStyle(el).whiteSpace,centerDelta:Math.abs(icon.y+icon.height/2-text.y-text.height/2),heightDelta:Math.abs(box.height-project.height)};});
  expect(['flex','inline-flex']).toContain(geometry.display);expect(geometry.nowrap).toBe('nowrap');expect(geometry.centerDelta).toBeLessThanOrEqual(1);expect(geometry.heightDelta).toBeLessThanOrEqual(1);
});
