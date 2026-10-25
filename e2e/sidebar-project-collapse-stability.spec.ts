import { expect,test } from './fixtures';
import {injectSession} from './helpers';
test('project collapse reaches zero without a second layout step when children unmount',async({page,app})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addStyleTag({content:'.animated-collapse { transition-duration: 220ms, 220ms, 0s !important; transition-delay: 0s, 0s, 220ms !important; }'});
 await injectSession(page,{sessionId:'collapse-stability',cwd:'/tmp/collapse-project'});
 const project=page.locator('[data-sidebar-project]').filter({hasText:'collapse-project'}).first();
 const toggle=project.locator('[data-sidebar-grid="label"] > button').first();
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 const collapse=project.locator('xpath=..').locator('[data-slot="animated-collapse"]').first();
 await expect(collapse).toHaveAttribute('data-state','open');
 await expect.poll(()=>collapse.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(10);
 await collapse.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
 // Sample the full close through child unmount to detect a terminal step.
 const samples=await collapse.evaluate(async el=>{
   const sample=()=>({height:el.getBoundingClientRect().height,inner:el.firstElementChild!.getBoundingClientRect().height,margin:parseFloat(getComputedStyle(el.firstElementChild!).marginTop),parentHeight:el.parentElement!.getBoundingClientRect().height,hasChildren:!!el.firstElementChild!.childElementCount});
   const values:any[]=[];
   const done=new Promise<void>(resolve=>{let n=0;const tick=()=>{values.push(sample());if(++n<50)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
   const trigger=el.parentElement!.querySelector('[data-sidebar-grid="label"] > button') as HTMLElement;trigger.click();await done;return values;
 });
 expect(samples.at(-1)!.height).toBeLessThanOrEqual(0.1);
 const positive=samples.map(s=>s.height).filter(h=>h>0.1);
 // A margin escaping the clip shell disappears abruptly only at child unmount.
 expect(samples.every(s=>s.margin===0)).toBe(true);
 expect(positive.length).toBeGreaterThan(0);
 const settled=samples.filter(s=>s.height<=0.1);
 expect(settled.length).toBeGreaterThan(2);
 expect(Math.max(...settled.map(s=>s.parentHeight))-Math.min(...settled.map(s=>s.parentHeight))).toBeLessThanOrEqual(0.1);
 expect(samples.at(-1)!.hasChildren).toBe(false);
});
