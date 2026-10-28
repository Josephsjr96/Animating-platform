import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture'));
 let reviewCalls=0,commitCalls=0;
 const workspace={project:{name:'Seven frames',start:'2026-10-01',deadline:'2026-12-31'},people:[],stages:[],cells:{},shots:[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let body;
  if(path==='/api/workspace')body=req.method()==='POST'?{ok:true}:workspace;
  else if(path==='/api/import/scan'){
   const request=new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postDataBuffer()});
   const geometry=JSON.parse((await request.formData()).get('geometry'));
   assert.equal(geometry.frames.length,7);
   body={import_id:'fixture-seven',metadata_status:'unavailable',warning:'Frame borders were detected, but the model could not read their metadata. Review every crop and enter cut numbers and durations before importing.',panels:geometry.frames.map(bbox=>({bbox,bbox_source:'detected_border',number:'',duration:null,confidence:0})),panel_count:7};
  }else if(path.endsWith('/review')){
   reviewCalls++;const panels=req.postDataJSON().panels;assert.equal(panels.length,7);assert.ok(panels.every(p=>p.number&&p.duration>0));body={ok:true};
  }else if(path.endsWith('/commit')){commitCalls++;body={ok:true,added:[],total_shots:7,workspace};}
  else throw Error('Unexpected API '+path);
  await route.fulfill({json:body});
 });
 await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:4182');
 const source=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=490;c.height=510;
  const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,490,510);
  for(let i=0;i<7;i++){ctx.fillStyle='black';ctx.fillRect(45,10+i*70,271,71);ctx.fillStyle='white';ctx.fillRect(50,15+i*70,261,61);}
  return c.toDataURL('image/png').split(',')[1];
 });
 await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
 await page.locator('#file').setInputFiles({name:'seven.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
 await page.locator('#scanBtn').click();
 await page.waitForSelector('.step-3:not([hidden])');
 assert.equal(await page.locator('.review-card').count(),7);
 assert.match(await page.locator('#scanWarning').innerText(),/model could not read/);
 for(let i=0;i<6;i++){
  await page.getByLabel(`Shot number for drawing ${i+1}`,{exact:true}).fill('C00'+(i+1));
  await page.getByLabel(`Scanned seconds for drawing ${i+1}`,{exact:true}).fill('2.5');
 }
 await page.locator('#commitBtn').click();
 assert.match(await page.locator('#reviewValidation').innerText(),/Check drawings: 7\./);
 assert.equal(reviewCalls,0);assert.equal(commitCalls,0);
 await page.getByLabel('Shot number for drawing 7',{exact:true}).fill('C007');
 await page.getByLabel('Scanned seconds for drawing 7',{exact:true}).fill('2.5');
 await page.locator('#commitBtn').click();
 await page.waitForSelector('.step-4:not([hidden])');assert.equal(reviewCalls,1);assert.equal(commitCalls,1);
 console.log('PASS: seven detected frames survive metadata failure, warning visible, seventh drawing requires review, all seven imported once with reviewed timing');
}finally{await browser.close();}
