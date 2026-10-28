import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture'));
 let workspace={project:{name:'Border crop test',start:'2026-10-01',deadline:'2026-12-31'},people:[],stages:[{id:'rough',name:'Rough',weight:1}],cells:{},shots:[]};
 const frames=[{x:45,y:25,w:290,h:90},{x:45,y:135,w:290,h:90}];
 let scans=0,saves=0;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let body;
  if(path==='/api/workspace'){
   if(req.method()==='POST'){workspace=req.postDataJSON();saves++;body={ok:true};}else body=workspace;
  }else if(path==='/api/import/scan'){
   scans++;assert.ok(req.postDataBuffer().toString().includes(JSON.stringify({width:490,height:300,frames})));
   body={import_id:'border-crop-fixture',panels:frames.map((bbox,i)=>({bbox,bbox_source:'detected_border',number:'C00'+(i+1),duration:4,confidence:.8})),panel_count:2};
  }else if(path.endsWith('/review')){assert.equal(req.postDataJSON().panels.filter(p=>p.include).length,1);body={ok:true};}
  else if(path.endsWith('/commit')){workspace.shots=[{id:'new-shot',number:'C002',duration:4,description:'',notes:'',dialogue:'',elements:[],thumbnail:''}];body={ok:true,added:['new-shot'],total_shots:1,workspace};}
  else throw Error('Unexpected API route '+path);
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:4182',{waitUntil:'networkidle'});
 const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=490;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,490,300);for(const [y,color] of [[20,'#ffaaaa'],[130,'#aaaaff']]){ctx.fillStyle='black';ctx.fillRect(40,y,300,100);ctx.fillStyle=color;ctx.fillRect(45,y+5,290,90);}return c.toDataURL('image/png').split(',')[1];});
 await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
 await page.locator('.scan-queue summary').first().click();
 await page.getByLabel('Storyboard page queue',{exact:true}).setInputFiles({name:'bordered.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
 await page.getByRole('button',{name:'Scan queued pages',exact:true}).click();
 await page.getByRole('button',{name:'Review page →',exact:true}).click();
 await page.waitForSelector('.step-3:not([hidden])');assert.equal(scans,1);
 assert.equal(await page.getByText('Border-detected crop — verify',{exact:true}).count(),2);
 await page.getByLabel('Edit thumbnail for drawing 2',{exact:true}).click();
 await page.getByLabel('Width (px)',{exact:true}).fill('100');await page.getByLabel('Height (px)',{exact:true}).fill('50');
 await page.getByLabel('Left (px)',{exact:true}).fill('480');assert.equal(await page.getByRole('button',{name:'Save thumbnail',exact:true}).isDisabled(),true);
 await page.getByLabel('Left (px)',{exact:true}).fill('60');await page.getByLabel('Top (px)',{exact:true}).fill('145');
 await page.getByRole('button',{name:'Save thumbnail',exact:true}).click();
 const corrected={x:60,y:145,w:100,h:50};
 assert.deepEqual(await page.evaluate(()=>Wizard.state.panels[1].bbox),corrected);
 await page.getByLabel('Edit thumbnail for drawing 2',{exact:true}).click();
 await page.getByRole('button',{name:'Rotate right',exact:true}).click();await page.getByRole('button',{name:'Flip horizontal',exact:true}).click();
 await page.getByLabel('Brightness',{exact:true}).evaluate(input=>{input.value='120';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>document.querySelector('.thumbnail-edit-preview')?.naturalWidth===50);
 await page.getByRole('button',{name:'Save thumbnail',exact:true}).click();
 const edits=await page.evaluate(()=>Wizard.state.panels[1].thumbnail_edits);assert.equal(edits.rotation,90);assert.equal(edits.flipX,true);assert.equal(edits.brightness,120);
 await page.getByLabel('Edit thumbnail for drawing 2',{exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Flip horizontal',exact:true}).getAttribute('aria-pressed'),'true');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('dialog.crop-editor').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),true);
 if(process.env.THUMBNAIL_EDITOR_SCREENSHOT)await page.screenshot({path:process.env.THUMBNAIL_EDITOR_SCREENSHOT});
 await page.setViewportSize({width:1280,height:720});
 await page.getByRole('button',{name:'Restore original',exact:true}).click();assert.equal(await page.getByLabel('Width (px)',{exact:true}).inputValue(),'290');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>Wizard.state.panels[1].thumbnail_edits),edits);
 assert.deepEqual(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('nuvren-storyboard-review-v1')).pages)[0].panels[1].bbox),corrected);
 await page.waitForFunction(()=>document.querySelectorAll('.review-card .thumb img')[1]?.naturalWidth===50);
 // Cancel must leave the last accepted crop untouched.
 await page.getByLabel('Edit thumbnail for drawing 2',{exact:true}).click();await page.getByLabel('Width (px)',{exact:true}).fill('80');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>Wizard.state.panels[1].bbox),corrected);
 await page.locator('.review-card').first().locator('[data-role=include]').uncheck();
 await page.locator('#commitBtn').click();await page.waitForSelector('.step-4:not([hidden])');assert.equal(saves,1);
 await page.getByRole('button',{name:'Shot list',exact:true}).click();await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#shotTable .thumb img')?.naturalWidth===50);
 const pixel=await page.locator('#shotTable .thumb img').evaluate(image=>{const c=document.createElement('canvas');c.width=50;c.height=100;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(20,20,1,1).data];});
 assert.ok(pixel[0]>170&&pixel[1]>170&&pixel[2]===255);assert.deepEqual(errors,[]);
 const transforms=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,2,2);ctx.fillStyle='blue';ctx.fillRect(2,0,2,2);const image=await createImageBitmap(canvas);
  const sample=async edits=>{const url='data:image/png;base64,'+StoryboardGeometry.crop(image,{x:0,y:0,w:4,h:2},edits);const b=await createImageBitmap(await(await fetch(url)).blob());const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const x=c.getContext('2d');x.drawImage(b,0,0);const result={width:b.width,height:b.height,first:[...x.getImageData(0,0,1,1).data]};b.close();return result;};
  const values={flip:await sample({flipX:true}),rotate:await sample({rotation:90}),gray:await sample({saturation:0}),dim:await sample({brightness:50}),contrast:await sample({contrast:50})};image.close();return values;
 });
 assert.deepEqual(transforms.flip.first,[0,0,255,255]);assert.equal(transforms.rotate.width,2);assert.equal(transforms.rotate.height,4);
 assert.equal(transforms.gray.first[0],transforms.gray.first[1]);assert.equal(transforms.gray.first[1],transforms.gray.first[2]);
 assert.ok(transforms.dim.first[0]<255&&transforms.dim.first[0]>0);assert.ok(transforms.contrast.first[1]>0);
 console.log('PASS: original-pixel border detection, geometry upload, crop overlay, exact numeric correction, invalid-bound rejection, cancel, draft persistence, corrected thumbnail cloud save/reload; all APIs mocked');
}finally{await browser.close();}
