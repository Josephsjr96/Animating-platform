import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture'));
 let workspace={project:{name:'Thumbnail editor',start:'2026-10-01',deadline:'2026-12-31'},people:[],stages:[],cells:{},shots:[{id:'s1',number:'C001',duration:4,description:'',notes:'',dialogue:'',elements:[],thumbnail:''}]},saves=0;
 await page.route('**/api/**',async route=>{
  assert.equal(new URL(route.request().url()).pathname,'/api/workspace');
  if(route.request().method()==='POST'){workspace=route.request().postDataJSON();saves++;await route.fulfill({json:{ok:true}});}
  else await route.fulfill({json:workspace});
 });
 await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:4182');
 const source=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=80;c.height=40;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,40,40);ctx.fillStyle='blue';ctx.fillRect(40,0,40,40);return c.toDataURL('image/png');
 });
 workspace.shots[0].thumbnail=source;
 await page.reload();
 const thumb=()=>page.getByRole('button',{name:'Edit thumbnail for C001',exact:true});
 const dialog=()=>page.locator('dialog.shot-thumbnail-editor');
 await thumb().click();
 await page.getByRole('button',{name:'Save thumbnail',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.shot-thumbnail-editor [type=submit]').disabled);
 const normal=await dialog().boundingBox(),normalCanvas=await dialog().locator('canvas').boundingBox();
 await page.getByRole('button',{name:'Enlarge window',exact:true}).click();
 const big=await dialog().boundingBox(),bigCanvas=await dialog().locator('canvas').boundingBox();
 assert.ok(big.width>normal.width);assert.ok(bigCanvas.width>normalCanvas.width);
 await page.getByLabel('Width (px)',{exact:true}).fill('40');
 await page.getByLabel('Left (px)',{exact:true}).fill('90');
 assert.equal(await page.getByRole('button',{name:'Save thumbnail',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(saves,0);assert.equal(workspace.shots[0].thumbnail,source);
 await thumb().focus();await page.keyboard.press('Enter');
 await page.getByLabel('Width (px)',{exact:true}).fill('40');await page.getByLabel('Left (px)',{exact:true}).fill('40');
 await page.getByRole('button',{name:'Save thumbnail',exact:true}).click();
 await dialog().waitFor({state:'detached'});assert.equal(saves,1);
 assert.equal(workspace.shots[0].thumbnail_source,source);
 assert.deepEqual(workspace.shots[0].thumbnail_crop,{x:40,y:0,w:40,h:40});
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#shotTable .thumb img')?.naturalWidth===40);
 const pixel=await page.locator('#shotTable .thumb img').evaluate(image=>{const c=document.createElement('canvas');c.width=c.height=40;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(20,20,1,1).data];});
 assert.deepEqual(pixel,[0,0,255,255]);
 await thumb().click();await page.waitForFunction(()=>document.querySelector('.shot-thumbnail-editor [aria-label="Left (px)"]')?.value==='40');
 await page.getByRole('button',{name:'Restore original',exact:true}).click();
 assert.equal(await page.getByLabel('Width (px)',{exact:true}).inputValue(),'80');
 // Drawing a fresh crop uses source pixels even after an earlier saved crop.
 const c=await dialog().locator('canvas').boundingBox();
 await page.mouse.move(c.x+c.width*.1,c.y+c.height*.1);await page.mouse.down();
 await page.mouse.move(c.x+c.width*.4,c.y+c.height*.9);await page.mouse.up();
 assert.equal(await page.getByLabel('Left (px)',{exact:true}).inputValue(),'8');
 assert.equal(await page.getByLabel('Width (px)',{exact:true}).inputValue(),'24');
 await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});assert.equal(saves,1);
 await page.setViewportSize({width:390,height:844});await thumb().click();await page.waitForFunction(()=>!document.querySelector('.shot-thumbnail-editor [type=submit]').disabled);
 await page.getByRole('button',{name:'Enlarge window',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.querySelector('.shot-thumbnail-editor').getBoundingClientRect().right<=innerWidth));
 await page.getByRole('button',{name:'Restore original',exact:true}).click();
 await page.getByRole('button',{name:'Save thumbnail',exact:true}).click();await dialog().waitFor({state:'detached'});
 assert.equal(workspace.shots[0].thumbnail_source,source);assert.equal(workspace.shots[0].thumbnail,source);assert.equal(saves,2);
 // Unreadable remote images offer replacement instead of failing silently.
 await page.route('https://thumbnail-source.test/**',route=>route.abort());
 await page.evaluate(()=>{state.shots[0].thumbnail='https://thumbnail-source.test/image.png';delete state.shots[0].thumbnail_source;render();});
 await thumb().click();
 await page.getByText('This image could not be opened for cropping. Use Replace image to upload a local copy.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Save thumbnail',exact:true}).isDisabled(),true);
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Replace image',exact:true}).click();
 await (await picker).setFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});
 await page.waitForFunction(()=>!state.shots[0].thumbnail_crop&&state.shots[0].thumbnail.startsWith('data:'));
 await page.waitForFunction(()=>document.querySelector('#backendStatus')?.textContent.includes('Saved to Cloudflare'));
 assert.equal(saves,3);assert.equal(workspace.shots[0].thumbnail_source,undefined);assert.equal(workspace.shots[0].thumbnail_crop,undefined);
 assert.deepEqual(errors,[]);
 console.log('PASS: thumbnail click/keyboard editor, larger window and preview, invalid bounds, cancel, correct crop pixels, cloud reload, source retention, drag selection, Escape, mobile bounds, restore and replacement after image failure');
}finally{await browser.close();}
