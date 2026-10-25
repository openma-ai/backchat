import {expect,test} from './fixtures';

test('native red traffic light stays centered on sidebar icon rail at every zoom',async({page,app})=>{
 for(const zoom of [0.75,0.9,1,1.1,1.25,1.5,1.75,2]){
  await app.evaluate(({BrowserWindow},z)=>{const win=BrowserWindow.getAllWindows()[0]!;win.webContents.setZoomFactor(z);win.emit('focus');},zoom);
  const expected=await page.locator('.sidebar-host-chrome [data-sidebar-grid="icon"]').first().evaluate(el=>{const r=el.getBoundingClientRect();return r.left+r.width/2;});
  await expect.poll(async()=>Math.abs(await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0]!;return win.getWindowButtonPosition()!.x+6;})-expected*zoom)).toBeLessThanOrEqual(0.5);
 }
 const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getWindowButtonPosition()!.x);
 const toggle=page.getByRole('button',{name:'Collapse sidebar',exact:true});
 {
   await toggle.click();
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.emit('focus'));
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getWindowButtonPosition()!.x)).toBe(before);
 }
});
