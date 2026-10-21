import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const raw='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const formats=[['raw base64',raw],['complete data URL','data:image/png;base64,'+raw],['image URL','https://thumbnail-fixture.invalid/panel.png']];
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture-key'));
  await page.route('https://thumbnail-fixture.invalid/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from(raw,'base64')}));
  let image=raw;
  const workspace=()=>({project:{name:'Thumbnail test',start:'2026-10-01',deadline:'2026-12-31'},people:[],stages:[{id:'rough',name:'Rough',weight:1}],cells:{},shots:[{id:'s1',number:'SH010',duration:4,description:'',notes:'',dialogue:'',elements:[],thumbnail:image}]});
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    assert.equal(route.request().method()==='GET'||path==='/api/import/scan',true,'Test must not save to production');
    const body=path==='/api/workspace'?workspace():{import_id:'fixture',panel_count:1,source:'fixture',panels:[{number:'SH010',duration:4,confidence:1,thumbnail_b64:image}]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  for(const [label,value] of formats){
    image=value;
    await page.goto('http://127.0.0.1:4182',{waitUntil:'networkidle'});
    await page.waitForSelector('#splash',{state:'detached'});
    await page.waitForFunction(()=>{const image=document.querySelector('#shotTable .thumb img');return image?.complete&&image.naturalWidth>0;});
    console.log('PASS shot-list image decodes: '+label);
    await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
    await page.locator('#file').setInputFiles({name:'storyboard.png',mimeType:'image/png',buffer:Buffer.from(raw,'base64')});
    await page.locator('#scanBtn').click();
    await page.waitForSelector('.step-3:not([hidden])');
    await page.waitForFunction(()=>{const image=document.querySelector('.review-card .thumb img');return image?.complete&&image.naturalWidth>0;});
    console.log('PASS original scan-review image decodes: '+label);
  }
  await page.evaluate(raw=>{currentTab='shotlist';state.shots[0].thumbnail='';state.shots[0].thumbnail_b64=raw;render();},raw);
  await page.waitForFunction(()=>document.querySelector('#shotTable .thumb img')?.naturalWidth>0);
  console.log('PASS thumbnail_b64 field compatibility');
  await page.evaluate(()=>{state.shots[0].thumbnail='';state.shots[0].thumbnail_b64='';render();});
  assert.equal(await page.locator('#shotTable .thumb img').count(),0);
  console.log('PASS missing image data remains an upload placeholder');
  assert.deepEqual(errors,[]);console.log('8 thumbnail checks passed; all API traffic mocked.');
}finally{await browser.close();}
