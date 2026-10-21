import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture-key'));
  let workspace={project:{name:'Crop test',start:'2026-10-01',deadline:'2026-12-31'},people:[],stages:[{id:'rough',name:'Rough',weight:1}],cells:{},shots:[]};
  let cropSaves=0;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;let body;
    if(path==='/api/workspace'){
      if(request.method()==='POST'){workspace=request.postDataJSON();cropSaves++;body={ok:true};}else body=workspace;
    }else if(path==='/api/import/scan'){
      body={import_id:'crop-fixture',source:'fixture',panel_count:3,panels:[
        {number:'SH010',duration:4,confidence:1,bbox:{x:0,y:0,w:40,h:40}},
        {number:'SH020',duration:4,confidence:1,bbox:{x:40,y:0,w:40,h:40}},
        {number:'SH030',duration:4,confidence:1,bbox:{x:1000,y:0,w:40,h:40}}
      ]};
    }else if(path.endsWith('/review')){
      const payload=request.postDataJSON();assert.equal(payload.panels[0].thumbnail_b64,undefined,'Review request schema stays unchanged');body={ok:true};
    }else if(path.endsWith('/commit')){
      // Emulate a backend that commits metadata but omits generated thumbnails.
      workspace.shots=[{id:'new-shot',number:'SH020',duration:4,description:'',notes:'',dialogue:'',elements:[],thumbnail:''}];
      body={ok:true,added:['new-shot'],total_shots:1,workspace};
    }else throw new Error('Unexpected route '+path);
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:4182',{waitUntil:'networkidle'});await page.waitForSelector('#splash',{state:'detached'});
  const source=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,40,40);ctx.fillStyle='#0000ff';ctx.fillRect(40,0,40,40);return canvas.toDataURL('image/png').split(',')[1];});
  await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
  await page.locator('#file').setInputFiles({name:'two-panels.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
  await page.locator('#scanBtn').click();await page.waitForSelector('.step-3:not([hidden])');
  await page.waitForFunction(()=>[...document.querySelectorAll('.review-card .thumb img')].length===2&&[...document.querySelectorAll('.review-card .thumb img')].every(i=>i.naturalWidth===40));
  const pixels=await page.locator('.review-card .thumb img').evaluateAll(images=>images.map(image=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(20,20,1,1).data];}));
  assert.deepEqual(pixels,[[255,0,0,255],[0,0,255,255]]);console.log('PASS thumbnails contain the correct original panel pixels');
  assert.equal(await page.locator('.review-card').nth(2).locator('img').count(),0);console.log('PASS out-of-bounds boxes do not fabricate an image');
  // Exclude the first and invalid panels: the second panel must match the added shot.
  await page.locator('.review-card').nth(0).locator('[data-role=include]').uncheck();
  await page.locator('.review-card').nth(2).locator('[data-role=include]').uncheck();
  await page.locator('#commitBtn').click();await page.waitForSelector('.step-4:not([hidden])');
  assert.equal(cropSaves,1);assert.ok(workspace.shots[0].thumbnail);console.log('PASS included panel crop is saved using the existing workspace API');
  await page.getByRole('button',{name:'Shot list',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#shotTable .thumb img')?.naturalWidth===40);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#shotTable .thumb img')?.naturalWidth===40);
  const pixel=await page.locator('#shotTable .thumb img').evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(20,20,1,1).data];});
  assert.deepEqual(pixel,[0,0,255,255]);console.log('PASS correct crop survives import and cloud reload');
  assert.deepEqual(errors,[]);console.log('4 crop checks passed; every API request was mocked.');
}finally{await browser.close();}
