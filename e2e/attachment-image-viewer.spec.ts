import {expect,test} from './fixtures';
import {injectSession,injectEvent} from './helpers';
test('draft and sent image attachments have usable previews and keyboard-close viewer',async({page,app,composer,capture})=>{
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('session:start');ipcMain.handle('session:start',()=>({}));});
 const id=await injectSession(page,{sessionId:'image-viewer'});
 const data=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.alloc(320*180*4,160),{width:320,height:180}).toPNG().toString('base64'));
 const file={id:'image',name:'screenshot.png',path:'/tmp/screenshot.png',uri:'file:///tmp/screenshot.png',kind:'file' as const,mimeType:'image/png',data};
 await composer.setPickedFiles([file]);await page.getByLabel('Attach files').click();
 const draft=page.locator('[data-attachment-image="composer"]');await expect(draft).toBeVisible();
 const size=await draft.boundingBox();expect(size!.width).toBeGreaterThanOrEqual(120);expect(size!.height).toBeGreaterThanOrEqual(90);
 await draft.click();await expect(page.locator('[data-attachment-image-viewer] img')).toBeVisible();await page.keyboard.press('Escape');await expect(draft).toBeFocused();
 const original={schema_version:'oma.event.v1',event_id:'image-input',session_id:id,turn_id:'input',occurred_at:new Date().toISOString(),source:{kind:'user'},type:'user.message',data:{text:'Image review',input_kind:'steering',outcome:'injected',active_turn_id:'parent',attachments:[file,{...file,id:"second",name:"second.png"}]}};
 await injectEvent(page,{type:'session.event',session_id:id,turn_id:'parent',event:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Working'}}});
 await injectEvent(page,{type:'session.steering',session_id:id,turn_id:'input',active_turn_id:'parent',text:'Image review',outcome:'injected',requested_delivery:'llm_boundary',effective_delivery:'llm_boundary',openma_event:original});
 const images=page.locator('[data-attachment-image="message"]');
 await expect(images).toHaveCount(2);
 const [firstBox,secondBox]=await Promise.all([images.nth(0).boundingBox(),images.nth(1).boundingBox()]);
 expect(Math.abs(firstBox!.y-secondBox!.y)).toBeLessThan(1);
 expect(firstBox!.width).toBeLessThanOrEqual(160);
 await capture("sent-images-row.png");
 const sent=images.first();await expect(sent).toBeVisible();await sent.click();
 const viewer=page.locator('[data-attachment-image-viewer]');await expect(viewer).toBeVisible();await expect(viewer.getByRole('heading')).toHaveText(file.name);
 await capture('attachment-image-viewer.png');await page.keyboard.press('Escape');await expect(sent).toBeFocused();
 // Injected acceptance clears the draft; opening the viewer never submits.
 await expect(page.locator('[data-turn-id="input"]')).toHaveCount(0);
});
